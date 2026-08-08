import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PublicStats } from "./types";
import { LATE_MIN } from "./metrics";
import { getEventBus } from "@/lib/realtime/event-bus";
import type { TenantId } from "@/lib/tenants";

/**
 * Server-authoritative daily service stats (drinks served, late count, prep
 * time). Same no-DB pattern as the status store: a tiny JSON file per tenant
 * on the persistent volume, mirrored in memory, broadcast over SSE.
 *
 * Counters are keyed to a London calendar day and roll over automatically
 * (belt-and-suspenders alongside the 18:00 reset). `servedIds` makes
 * `recordServed` idempotent so "undo → re-ready" never double-counts.
 */

const LEGACY_FILENAME = "stats.json";
const LATE_MS = LATE_MIN * 60_000;

type DailyStats = {
  date: string; // YYYY-MM-DD, Europe/London
  servedIds: Record<string, true>;
  served: number;
  late: number;
  totalPrepMs: number;
};

function getDataDir(): string {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), ".data");
}

function getStoragePath(tenant: TenantId): string {
  return path.join(getDataDir(), `stats-${tenant}.json`);
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

  var __kdsStatsStores: Map<TenantId, StatsStore> | undefined;
}

class StatsStore {
  private data: DailyStats = emptyStats();
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly tenant: TenantId) {}

  async load(): Promise<void> {
    if (!this.loaded) {
      try {
        const raw = await fs.readFile(getStoragePath(this.tenant), "utf8");
        const parsed = JSON.parse(raw) as DailyStats;
        if (parsed && typeof parsed === "object" && parsed.date) {
          this.data = { ...emptyStats(), ...parsed };
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          await this.migrateLegacy();
        } else {
          console.error("[stats-store] load failed:", err);
        }
      }
      this.loaded = true;
    }
    this.rollover();
  }

  /** Adopt the pre-multi-tenant single stats file for Margate. */
  private async migrateLegacy(): Promise<void> {
    if (this.tenant !== "margate") return;
    const legacyPath = path.join(getDataDir(), LEGACY_FILENAME);
    try {
      const raw = await fs.readFile(legacyPath, "utf8");
      const parsed = JSON.parse(raw) as DailyStats;
      if (parsed && typeof parsed === "object" && parsed.date) {
        this.data = { ...emptyStats(), ...parsed };
      }
      await fs.mkdir(getDataDir(), { recursive: true });
      await fs.writeFile(getStoragePath(this.tenant), raw, "utf8");
      await fs.unlink(legacyPath);
      console.log("[stats-store] migrated legacy stats.json → margate");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[stats-store] legacy migration failed:", err);
      }
    }
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
    getEventBus(this.tenant).publish({
      type: "stats",
      stats: toPublic(this.data),
      at: new Date().toISOString(),
    });
  }

  private persist(): void {
    const serialized = JSON.stringify(this.data);
    this.writeQueue = this.writeQueue
      .then(async () => {
        const filePath = getStoragePath(this.tenant);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, serialized, "utf8");
      })
      .catch((err) => {
        console.error("[stats-store] persist failed:", err);
      });
  }
}

function store(tenant: TenantId): StatsStore {
  if (!globalThis.__kdsStatsStores) {
    globalThis.__kdsStatsStores = new Map();
  }
  let s = globalThis.__kdsStatsStores.get(tenant);
  if (!s) {
    s = new StatsStore(tenant);
    globalThis.__kdsStatsStores.set(tenant, s);
  }
  return s;
}

export async function recordServed(
  tenant: TenantId,
  orderId: string,
  prepMs: number,
): Promise<void> {
  const s = store(tenant);
  await s.load();
  s.recordServed(orderId, prepMs);
}

export async function getPublicStats(tenant: TenantId): Promise<PublicStats> {
  const s = store(tenant);
  await s.load();
  return s.publicStats();
}

export async function clearStats(tenant: TenantId): Promise<void> {
  const s = store(tenant);
  await s.load();
  s.clear();
}
