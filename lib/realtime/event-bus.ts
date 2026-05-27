import "server-only";
import { EventEmitter } from "node:events";
import type { SquareOrder } from "@/lib/square/orders";
import type { OrderStatus, PublicStats, StatusMap } from "@/lib/orders/types";

/**
 * Realtime event bus for KDS updates.
 *
 * Stays in-memory. Survives across requests within a single Node.js
 * process (Next.js server). When the container restarts, all subscribers
 * are torn down and reconnect via EventSource auto-reconnect.
 */

export type OrderEvent =
  | {
      type: "snapshot";
      orders: SquareOrder[];
      statuses: StatusMap;
      stats: PublicStats;
      at: string;
    }
  | { type: "upsert"; order: SquareOrder; at: string }
  | { type: "remove"; orderId: string; at: string }
  | { type: "status"; orderId: string; status: OrderStatus; updatedAt: string }
  | { type: "status-reset"; at: string }
  | { type: "stats"; stats: PublicStats; at: string }
  | { type: "ping"; at: string };

type Listener = (event: OrderEvent) => void;

declare global {
   
  var __kdsEventBus: KdsEventBus | undefined;
}

class KdsEventBus {
  private emitter = new EventEmitter();

  constructor() {
    // EventEmitter defaults to 10 listeners; KDS can have many tablets.
    this.emitter.setMaxListeners(100);
  }

  publish(event: OrderEvent): void {
    this.emitter.emit("event", event);
  }

  subscribe(listener: Listener): () => void {
    this.emitter.on("event", listener);
    return () => {
      this.emitter.off("event", listener);
    };
  }

  subscriberCount(): number {
    return this.emitter.listenerCount("event");
  }
}

export function getEventBus(): KdsEventBus {
  if (!globalThis.__kdsEventBus) {
    globalThis.__kdsEventBus = new KdsEventBus();
  }
  return globalThis.__kdsEventBus;
}
