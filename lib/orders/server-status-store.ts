import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { OrderStatus, StatusEntry, StatusMap } from "./types";
import { getEventBus } from "@/lib/realtime/event-bus";
import type { TenantId } from "@/lib/tenants";

/**
 * Server-authoritative store for order statuses (pending / ready / done…).
 *
 * Lives in-memory in the single Node.js server process and is mirrored to a
 * plain JSON file per tenant on the persistent volume (same `$DATA_DIR`
 * that holds the encrypted Square tokens). No database — the map is tiny
 * (one cafe's daily order volume) and the file survives container
 * restarts/redeploys.
 *
 * Every mutation publishes to the tenant's realtime event bus, so all
 * connected tablets see status changes over the existing SSE stream.
 */

const LEGACY_FILENAME = "order-statuses.json";

function getDataDir(): string {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), ".data");
}

function getStoragePath(tenant: TenantId): string {
  return path.join(getDataDir(), `order-statuses-${tenant}.json`);
}

declare global {

  var __kdsStatusStores: Map<TenantId, StatusStore> | undefined;
}

class StatusStore {
  private map: StatusMap = {};
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly tenant: TenantId) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(getStoragePath(this.tenant), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        this.map = parsed as StatusMap;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        await this.migrateLegacy();
      } else {
        console.error("[status-store] load failed:", err);
      }
    }
    this.loaded = true;
  }

  /** Adopt the pre-multi-tenant single status file for Margate. */
  private async migrateLegacy(): Promise<void> {
    if (this.tenant !== "margate") return;
    const legacyPath = path.join(getDataDir(), LEGACY_FILENAME);
    try {
      const raw = await fs.readFile(legacyPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        this.map = parsed as StatusMap;
      }
      await fs.mkdir(getDataDir(), { recursive: true });
      await fs.writeFile(getStoragePath(this.tenant), raw, "utf8");
      await fs.unlink(legacyPath);
      console.log("[status-store] migrated legacy order-statuses.json → margate");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[status-store] legacy migration failed:", err);
      }
    }
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
        const filePath = getStoragePath(this.tenant);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, serialized, "utf8");
      })
      .catch((err) => {
        console.error("[status-store] persist failed:", err);
      });
  }
}

function store(tenant: TenantId): StatusStore {
  if (!globalThis.__kdsStatusStores) {
    globalThis.__kdsStatusStores = new Map();
  }
  let s = globalThis.__kdsStatusStores.get(tenant);
  if (!s) {
    s = new StatusStore(tenant);
    globalThis.__kdsStatusStores.set(tenant, s);
  }
  return s;
}

export async function getStatusMap(tenant: TenantId): Promise<StatusMap> {
  const s = store(tenant);
  await s.load();
  return s.all();
}

export async function setOrderStatus(
  tenant: TenantId,
  orderId: string,
  status: OrderStatus,
): Promise<StatusEntry> {
  const s = store(tenant);
  await s.load();
  const entry = s.set(orderId, status);
  getEventBus(tenant).publish({
    type: "status",
    orderId,
    status,
    updatedAt: entry.updatedAt,
  });
  return entry;
}

export async function clearAllStatuses(tenant: TenantId): Promise<void> {
  const s = store(tenant);
  await s.load();
  s.clear();
  getEventBus(tenant).publish({
    type: "status-reset",
    at: new Date().toISOString(),
  });
}

/**
 * Drop statuses for orders that are no longer active. Called by the poller on
 * every tick so the JSON file self-prunes to today's live orders. No broadcast
 * needed — clients drop these locally when the order leaves the orders feed.
 */
export async function pruneStatuses(
  tenant: TenantId,
  activeOrderIds: Set<string>,
): Promise<void> {
  const s = store(tenant);
  await s.load();
  const toRemove: string[] = [];
  for (const id of Object.keys(s.all())) {
    if (!activeOrderIds.has(id)) toRemove.push(id);
  }
  if (toRemove.length) s.removeMany(toRemove);
}
