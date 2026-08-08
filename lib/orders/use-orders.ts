"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SquareOrder } from "@/lib/square/orders";
import type { OrderStatus, PublicStats, StatusMap } from "./types";
import {
  applyStatusEvent,
  applyStatusReset,
  applyStatusSnapshot,
} from "./status-store";
import { applyStats } from "./client-stats-store";
import { tenantBase } from "@/lib/tenant-client";

const FALLBACK_POLL_MS = 10_000;

type OrdersResponse = {
  orders: SquareOrder[];
  fetchedAt: string;
};

type StreamEvent =
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

type State = {
  orders: SquareOrder[];
  fetchedAt: string | null;
  loading: boolean;
  error: string | null;
  notConnected: boolean;
  live: boolean;
};

const initialState: State = {
  orders: [],
  fetchedAt: null,
  loading: true,
  error: null,
  notConnected: false,
  live: false,
};

function applyEvent(prev: SquareOrder[], event: StreamEvent): SquareOrder[] {
  if (event.type === "snapshot") return event.orders;
  if (event.type === "upsert") {
    const next = prev.filter((o) => o.id !== event.order.id);
    next.push(event.order);
    return next;
  }
  if (event.type === "remove") {
    return prev.filter((o) => o.id !== event.orderId);
  }
  return prev;
}

export function useOrders() {
  const [state, setState] = useState<State>(initialState);
  const aliveRef = useRef(true);
  const sourceRef = useRef<EventSource | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);

  const fetchOnce = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${tenantBase()}/api/orders`, {
        cache: "no-store",
      });
      if (res.status === 401) {
        window.location.href = "/";
        return;
      }
      if (res.status === 409) {
        if (!aliveRef.current) return;
        setState({
          orders: [],
          fetchedAt: null,
          loading: false,
          error: null,
          notConnected: true,
          live: false,
        });
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API error (${res.status}): ${text}`);
      }
      const data = (await res.json()) as OrdersResponse;
      if (!aliveRef.current) return;
      setState((prev) => ({
        ...prev,
        orders: data.orders ?? [],
        fetchedAt: data.fetchedAt,
        loading: false,
        error: null,
        notConnected: false,
      }));
    } catch (error) {
      if (!aliveRef.current) return;
      const message =
        error instanceof Error ? error.message : "Unknown error";
      setState((prev) => ({
        ...prev,
        loading: false,
        error: message,
        notConnected: false,
      }));
    }
  }, []);

  const startFallbackPolling = useCallback(() => {
    if (fallbackTimerRef.current !== null) return;
    void fetchOnce();
    fallbackTimerRef.current = window.setInterval(() => {
      void fetchOnce();
    }, FALLBACK_POLL_MS);
  }, [fetchOnce]);

  const stopFallbackPolling = useCallback(() => {
    if (fallbackTimerRef.current !== null) {
      window.clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  const connectSse = useCallback(() => {
    if (sourceRef.current) return;
    const source = new EventSource(`${tenantBase()}/api/orders/stream`);
    sourceRef.current = source;

    source.onmessage = (msg) => {
      if (!aliveRef.current) return;
      try {
        const event = JSON.parse(msg.data) as StreamEvent;
        if (event.type === "ping") return;

        // Route status changes to the shared status store (cross-device sync).
        if (event.type === "status") {
          applyStatusEvent(event.orderId, event.status, event.updatedAt);
          return;
        }
        if (event.type === "status-reset") {
          applyStatusReset();
          return;
        }
        if (event.type === "stats") {
          applyStats(event.stats);
          return;
        }
        if (event.type === "snapshot") {
          applyStatusSnapshot(event.statuses);
          applyStats(event.stats);
        }

        setState((prev) => ({
          ...prev,
          orders: applyEvent(prev.orders, event),
          fetchedAt: event.at,
          loading: false,
          error: null,
          notConnected: false,
          live: true,
        }));
      } catch {
        // ignore malformed payloads
      }
    };

    source.onopen = () => {
      if (!aliveRef.current) return;
      stopFallbackPolling();
      setState((prev) => ({ ...prev, live: true, error: null }));
    };

    source.onerror = () => {
      if (!aliveRef.current) return;
      // EventSource will auto-retry; until it does, fall back to polling
      // so the UI never goes stale.
      setState((prev) => ({ ...prev, live: false }));
      startFallbackPolling();
    };
  }, [startFallbackPolling, stopFallbackPolling]);

  useEffect(() => {
    aliveRef.current = true;
     
    void fetchOnce();
    connectSse();

    const onMockChange = () => {
      void fetchOnce();
    };
    window.addEventListener("mock:orders-changed", onMockChange);

    return () => {
      aliveRef.current = false;
      window.removeEventListener("mock:orders-changed", onMockChange);
      sourceRef.current?.close();
      sourceRef.current = null;
      stopFallbackPolling();
    };
  }, [fetchOnce, connectSse, stopFallbackPolling]);

  return { ...state, refresh: fetchOnce };
}
