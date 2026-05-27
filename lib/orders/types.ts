export type OrderStatus = "pending" | "in_progress" | "ready" | "completed";

export type StatusEntry = {
  status: OrderStatus;
  updatedAt: string;
};

export type StatusMap = Record<string, StatusEntry>;

/**
 * Aggregated daily service metrics broadcast to every tablet. Derived from
 * the server-side counter in `stats-store.ts`; `null` values mean "no data
 * yet today" (nothing served).
 */
export type PublicStats = {
  served: number;
  late: number;
  onTimePct: number | null;
  avgPrepMs: number | null;
};
