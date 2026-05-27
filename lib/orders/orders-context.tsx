"use client";

import { createContext, useContext } from "react";
import { useOrders } from "./use-orders";

/**
 * Shares a single `useOrders()` subscription (one SSE connection) across the
 * header service bar and the board. Without this, each component that needs
 * orders would open its own EventSource — doubling connections per tablet.
 */

type OrdersValue = ReturnType<typeof useOrders>;

const OrdersContext = createContext<OrdersValue | null>(null);

export function OrdersProvider({ children }: { children: React.ReactNode }) {
  const value = useOrders();
  return (
    <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>
  );
}

export function useOrdersContext(): OrdersValue {
  const value = useContext(OrdersContext);
  if (!value) {
    throw new Error("useOrdersContext must be used within an OrdersProvider");
  }
  return value;
}
