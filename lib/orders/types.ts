export type OrderStatus = "pending" | "in_progress" | "ready" | "completed";

export type StatusEntry = {
  status: OrderStatus;
  updatedAt: string;
};

export type StatusMap = Record<string, StatusEntry>;
