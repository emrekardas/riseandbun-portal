import type { SquareOrder } from "@/lib/square/orders";
import type { OrderStatus, StatusMap } from "./types";

/**
 * Pure, shared metric helpers used by both the board (late badges) and the
 * header service bar. No I/O, no "server-only"/"use client" — safe on both
 * sides of the wire.
 */

// Elapsed-time thresholds for a single drink order (minutes since created).
export const WARN_MIN = 2; // amber
export const LATE_MIN = 4; // red / counts as "late" in daily stats

// Service pressure = how many drinks are piled up waiting to be made.
// Purely volume-based. Age of the oldest order is a *separate* signal,
// surfaced in its own "Oldest" metric — mixing the two made a single stale
// order falsely read as "Slammed".
const BUSY_WAITING = 5;
const SLAMMED_WAITING = 10;

export type ServiceLevel = "smooth" | "busy" | "slammed";

export type ServiceSnapshot = {
  level: ServiceLevel;
  activeCount: number; // everything not completed (matches the board)
  waitingCount: number; // pending + in_progress (not yet made)
  oldestMin: number; // age of the oldest unmade order, in whole minutes
};

function statusOf(statuses: StatusMap, id: string): OrderStatus {
  return statuses[id]?.status ?? "pending";
}

export function deriveService(
  orders: SquareOrder[],
  statuses: StatusMap,
  now: number,
): ServiceSnapshot {
  let activeCount = 0;
  let waitingCount = 0;
  let oldestMs = 0;

  for (const order of orders) {
    const status = statusOf(statuses, order.id);
    if (status === "completed") continue;
    activeCount += 1;
    if (status === "pending" || status === "in_progress") {
      waitingCount += 1;
      if (order.created_at) {
        oldestMs = Math.max(oldestMs, now - new Date(order.created_at).getTime());
      }
    }
  }

  const oldestMin = Math.floor(oldestMs / 60_000);

  let level: ServiceLevel = "smooth";
  if (waitingCount >= SLAMMED_WAITING) {
    level = "slammed";
  } else if (waitingCount >= BUSY_WAITING) {
    level = "busy";
  }

  return { level, activeCount, waitingCount, oldestMin };
}

export const SERVICE_LABELS: Record<ServiceLevel, string> = {
  smooth: "Smooth",
  busy: "Busy",
  slammed: "Slammed",
};

/** "3m 20s" / "45s" / "—" */
export function formatPrep(ms: number | null): string {
  if (ms == null) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

/** "6m" / "1h 4m" */
export function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}
