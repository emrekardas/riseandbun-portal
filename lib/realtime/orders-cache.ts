import "server-only";
import { getTodayOrders, type SquareOrder } from "@/lib/square/orders";
import { SquareNotConnectedError } from "@/lib/square/client";
import { markFoodLineItems, orderHasNonFoodItem } from "@/lib/square/food-items";
import { isMockMode } from "@/lib/mock/config";
import { getMockOrders } from "@/lib/mock/orders-store";
import { getStatusMap, pruneStatuses } from "@/lib/orders/server-status-store";
import { getPublicStats } from "@/lib/orders/stats-store";
import { ensureDailyResetScheduled } from "@/lib/orders/daily-reset";
import { getEventBus } from "./event-bus";
import type { TenantId } from "@/lib/tenants";

/**
 * In-memory cache of a tenant's today's orders, unfiltered — whatever Square
 * returns is what the KDS shows (except pure-food orders, see below). The
 * cache is refreshed by a single background poller that runs in the Node.js
 * server process. Each tenant gets its own cache + poller.
 *
 * SSE clients consume from this cache + the event bus:
 *   1. On connect → receive a `snapshot` event with the full cache
 *   2. On poller diff → receive `upsert` / `remove` events
 *
 * This means we only hit Square once per POLL_INTERVAL_MS regardless of
 * how many tablets are connected — the broadcast is in-memory.
 */

const POLL_INTERVAL_MS = 2_000;
const PING_INTERVAL_MS = 25_000; // SSE keep-alive (most proxies idle-timeout at 30-60s)

declare global {

  var __kdsCaches: Map<TenantId, OrdersCache> | undefined;
}

function orderFingerprint(order: SquareOrder): string {
  // Detect meaningful changes. Square bumps `version` on any update.
  return [
    order.id,
    order.version ?? 0,
    order.updated_at ?? "",
    order.state ?? "",
    (order.line_items ?? []).length,
  ].join("|");
}

export type CacheStatus = {
  ready: boolean;
  lastFetchedAt: string | null;
  lastError: string | null;
  pollerRunning: boolean;
  size: number;
};

class OrdersCache {
  private orders = new Map<string, SquareOrder>();
  private fingerprints = new Map<string, string>();
  private lastFetchedAt: string | null = null;
  private lastError: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private inflight: Promise<void> | null = null;
  private ready = false;
  private warnedNotConnected = false;

  constructor(private readonly tenant: TenantId) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);
    this.pingTimer = setInterval(() => {
      getEventBus(this.tenant).publish({
        type: "ping",
        at: new Date().toISOString(),
      });
    }, PING_INTERVAL_MS);
    if (typeof this.timer.unref === "function") this.timer.unref();
    if (typeof this.pingTimer.unref === "function") this.pingTimer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.timer = null;
    this.pingTimer = null;
  }

  status(): CacheStatus {
    return {
      ready: this.ready,
      lastFetchedAt: this.lastFetchedAt,
      lastError: this.lastError,
      pollerRunning: this.timer !== null,
      size: this.orders.size,
    };
  }

  snapshot(): SquareOrder[] {
    return Array.from(this.orders.values());
  }

  /**
   * Force a refresh outside the regular poll cycle (e.g. when a webhook
   * fires and we want to reflect the change instantly).
   */
  async refreshNow(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = this.runFetch().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async runFetch(): Promise<void> {
    try {
      // Pure-food orders never reach the bar — but only when every line
      // item is *confirmed* food via the live catalog (safe default: show).
      const fresh = isMockMode()
        ? getMockOrders()
        : (await markFoodLineItems(this.tenant, await getTodayOrders(this.tenant)))
            .filter(orderHasNonFoodItem);

      const bus = getEventBus(this.tenant);
      const seen = new Set<string>();
      const upserts: SquareOrder[] = [];

      for (const order of fresh) {
        seen.add(order.id);
        const fp = orderFingerprint(order);
        const prev = this.fingerprints.get(order.id);
        if (prev !== fp) {
          this.orders.set(order.id, order);
          this.fingerprints.set(order.id, fp);
          upserts.push(order);
        }
      }

      const removed: string[] = [];
      for (const id of this.orders.keys()) {
        if (!seen.has(id)) removed.push(id);
      }
      for (const id of removed) {
        this.orders.delete(id);
        this.fingerprints.delete(id);
      }

      // Keep the status file pruned to currently-active orders so it never
      // grows unbounded (belt-and-suspenders alongside the 18:00 reset).
      await pruneStatuses(this.tenant, seen);

      this.lastFetchedAt = new Date().toISOString();
      this.lastError = null;
      const wasReady = this.ready;
      this.ready = true;

      if (!wasReady) {
        bus.publish({
          type: "snapshot",
          orders: this.snapshot(),
          statuses: await getStatusMap(this.tenant),
          stats: await getPublicStats(this.tenant),
          at: this.lastFetchedAt,
        });
      } else {
        for (const order of upserts) {
          bus.publish({
            type: "upsert",
            order,
            at: this.lastFetchedAt,
          });
        }
        for (const id of removed) {
          bus.publish({
            type: "remove",
            orderId: id,
            at: this.lastFetchedAt,
          });
        }
      }
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : "Unknown poller error";

      if (error instanceof SquareNotConnectedError) {
        if (!this.warnedNotConnected) {
          console.warn(
            `[orders-cache] ${this.tenant}: Square not connected — poller idling.`,
          );
          this.warnedNotConnected = true;
        }
        return;
      }

      this.warnedNotConnected = false;
      console.error(`[orders-cache] ${this.tenant} poll failed:`, this.lastError);
    }
  }
}

export function getOrdersCache(tenant: TenantId): OrdersCache {
  if (!globalThis.__kdsCaches) {
    globalThis.__kdsCaches = new Map();
  }
  let cache = globalThis.__kdsCaches.get(tenant);
  if (!cache) {
    cache = new OrdersCache(tenant);
    globalThis.__kdsCaches.set(tenant, cache);
  }
  return cache;
}

/**
 * Boot the cache lazily on first access. Safe to call from any request.
 */
export function ensureCacheStarted(tenant: TenantId): OrdersCache {
  const cache = getOrdersCache(tenant);
  cache.start();
  ensureDailyResetScheduled();
  return cache;
}

/** Refresh every tenant that currently has a running cache (used by the
 *  shared Square webhook, which doesn't know which merchant fired). */
export function refreshAllTenantCaches(): void {
  for (const cache of globalThis.__kdsCaches?.values() ?? []) {
    void cache.refreshNow();
  }
}
