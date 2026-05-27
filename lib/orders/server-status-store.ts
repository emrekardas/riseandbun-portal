import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { OrderStatus, StatusEntry, StatusMap } from "./types";
import { getEventBus } from "@/lib/realtime/event-bus";

/**
 * Server-authoritative store for order statuses (pending / ready / done…).
 *
 * Lives in-memory in the single Node.js server process and is mirrored to a
 * plain JSON file on the persistent volume (same `$DATA_DIR` that holds the
 * encrypted Square token). No database — the map is tiny (one cafe's daily
 * order volume) and the file survives container restarts/redeploys.
 *
 * Every mutation publishes to the realtime event bus, so all connected
 * tablets see status changes over the existing SSE stream. This is what makes
 * "Mark ready" on one device reflect on every other device.
 */

const FILENAME = "order-statuses.json";

function getStoragePath(): string {
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), ".data");
  return path.join(dataDir, FILENAME);
}

declare global {

  var __kdsStatusStore: StatusStore | undefined;
}

class StatusStore {
  private map: StatusMap = {};
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(getStoragePath(), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        this.map = parsed as StatusMap;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[status-store] load failed:", err);
      }
    }
    this.loaded = true;
  }

  all(): StatusMap {
    return this.map;
  }

  set(orderId: string, status: OrderStatus): StatusEntry {
    const entry: StatusEntry = {
      status,
      updatedAt: new Date().toISOString(),
    };
    this.map[orderId] = entry;
    this.persist();
    return entry;
  }

  removeMany(orderIds: Iterable<string>): boolean {
    let changed = false;
    for (const id of orderIds) {
      if (id in this.map) {
        delete this.map[id];
        changed = true;
      }
    }
    if (changed) this.persist();
    return changed;
  }

  clear(): void {
    this.map = {};
    this.persist();
  }

  /** Fire-and-forget, serialized writes so we never interleave file writes. */
  private persist(): void {
    const serialized = JSON.stringify(this.map);
    this.writeQueue = this.writeQueue
      .then(async () => {
        const filePath = getStoragePath();
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, serialized, "utf8");
      })
      .catch((err) => {
        console.error("[status-store] persist failed:", err);
      });
  }
}

function store(): StatusStore {
  if (!globalThis.__kdsStatusStore) {
    globalThis.__kdsStatusStore = new StatusStore();
  }
  return globalThis.__kdsStatusStore;
}

export async function getStatusMap(): Promise<StatusMap> {
  const s = store();
  await s.load();
  return s.all();
}

export async function setOrderStatus(
  orderId: string,
  status: OrderStatus,
): Promise<StatusEntry> {
  const s = store();
  await s.load();
  const entry = s.set(orderId, status);
  getEventBus().publish({
    type: "status",
    orderId,
    status,
    updatedAt: entry.updatedAt,
  });
  return entry;
}

export async function clearAllStatuses(): Promise<void> {
  const s = store();
  await s.load();
  s.clear();
  getEventBus().publish({ type: "status-reset", at: new Date().toISOString() });
}

/**
 * Drop statuses for orders that are no longer active. Called by the poller on
 * every tick so the JSON file self-prunes to today's live orders. No broadcast
 * needed — clients drop these locally when the order leaves the orders feed.
 */
export async function pruneStatuses(
  activeOrderIds: Set<string>,
): Promise<void> {
  const s = store();
  await s.load();
  const toRemove: string[] = [];
  for (const id of Object.keys(s.all())) {
    if (!activeOrderIds.has(id)) toRemove.push(id);
  }
  if (toRemove.length) s.removeMany(toRemove);
}
