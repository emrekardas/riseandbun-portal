import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PublicStats } from "./types";
import { LATE_MIN } from "./metrics";
import { getEventBus } from "@/lib/realtime/event-bus";

/**
 * Server-authoritative daily service stats (drinks served, late count, prep
 * time). Same no-DB pattern as the status store: a tiny JSON file on the
 * persistent volume, mirrored in memory, broadcast over SSE.
 *
 * Counters are keyed to a London calendar day and roll over automatically
 * (belt-and-suspenders alongside the 18:00 reset). `servedIds` makes
 * `recordServed` idempotent so "undo → re-ready" never double-counts.
 */

const FILENAME = "stats.json";
const LATE_MS = LATE_MIN * 60_000;

type DailyStats = {
  date: string; // YYYY-MM-DD, Europe/London
  servedIds: Record<string, true>;
  served: number;
  late: number;
  totalPrepMs: number;
};

function getStoragePath(): string {
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), ".data");
  return path.join(dataDir, FILENAME);
}

function londonDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

function emptyStats(): DailyStats {
  return {
    date: londonDate(),
    servedIds: {},
    served: 0,
    late: 0,
    totalPrepMs: 0,
  };
}

function toPublic(s: DailyStats): PublicStats {
  return {
    served: s.served,
    late: s.late,
    onTimePct:
      s.served > 0
        ? Math.round(((s.served - s.late) / s.served) * 100)
        : null,
    avgPrepMs: s.served > 0 ? Math.round(s.totalPrepMs / s.served) : null,
  };
}

declare global {

  var __kdsStatsStore: StatsStore | undefined;
}

class StatsStore {
  private data: DailyStats = emptyStats();
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  async load(): Promise<void> {
    if (!this.loaded) {
      try {
        const raw = await fs.readFile(getStoragePath(), "utf8");
        const parsed = JSON.parse(raw) as DailyStats;
        if (parsed && typeof parsed === "object" && parsed.date) {
          this.data = { ...emptyStats(), ...parsed };
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error("[stats-store] load failed:", err);
        }
      }
      this.loaded = true;
    }
    this.rollover();
  }

  /** Reset counters when the London day changes. */
  private rollover(): void {
    if (this.data.date !== londonDate()) {
      this.data = emptyStats();
      this.persist();
    }
  }

  recordServed(orderId: string, prepMs: number): void {
    if (this.data.servedIds[orderId]) return; // already counted today
    this.data.servedIds[orderId] = true;
    this.data.served += 1;
    this.data.totalPrepMs += Math.max(0, prepMs);
    if (prepMs > LATE_MS) this.data.late += 1;
    this.persist();
    this.broadcast();
  }

  clear(): void {
    this.data = emptyStats();
    this.persist();
    this.broadcast();
  }

  publicStats(): PublicStats {
    return toPublic(this.data);
  }

  private broadcast(): void {
    getEventBus().publish({
      type: "stats",
      stats: toPublic(this.data),
      at: new Date().toISOString(),
    });
  }

  private persist(): void {
    const serialized = JSON.stringify(this.data);
    this.writeQueue = this.writeQueue
      .then(async () => {
        const filePath = getStoragePath();
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, serialized, "utf8");
      })
      .catch((err) => {
        console.error("[stats-store] persist failed:", err);
      });
  }
}

function store(): StatsStore {
  if (!globalThis.__kdsStatsStore) {
    globalThis.__kdsStatsStore = new StatsStore();
  }
  return globalThis.__kdsStatsStore;
}

export async function recordServed(
  orderId: string,
  prepMs: number,
): Promise<void> {
  const s = store();
  await s.load();
  s.recordServed(orderId, prepMs);
}

export async function getPublicStats(): Promise<PublicStats> {
  const s = store();
  await s.load();
  return s.publicStats();
}

export async function clearStats(): Promise<void> {
  const s = store();
  await s.load();
  s.clear();
}
