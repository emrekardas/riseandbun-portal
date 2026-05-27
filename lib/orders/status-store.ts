"use client";

import { useSyncExternalStore } from "react";
import type { OrderStatus, StatusMap } from "./types";

/**
 * Client-side mirror of the server-authoritative order status map.
 *
 * The map is no longer stored in localStorage (that made each device an
 * island). It now lives in memory, fed by the SSE stream via the
 * `applyStatus*` functions below, so every tablet shares one truth.
 *
 * User actions (`setOrderStatus`, `clearAllStatuses`) optimistically update
 * the local view for instant feedback and POST to the server, which then
 * broadcasts the change back over SSE to reconcile all devices (including
 * this one) with the authoritative timestamp.
 */

const EMPTY_MAP: StatusMap = Object.freeze({}) as StatusMap;

let currentMap: StatusMap = EMPTY_MAP;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function getSnapshot(): StatusMap {
  return currentMap;
}

export function useStatusMap(): StatusMap {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_MAP);
}

// ---------------------------------------------------------------------------
// Fed by the SSE stream (see lib/orders/use-orders.ts)
// ---------------------------------------------------------------------------

export function applyStatusSnapshot(map: StatusMap | undefined): void {
  currentMap = map && typeof map === "object" ? map : EMPTY_MAP;
  emit();
}

export function applyStatusEvent(
  orderId: string,
  status: OrderStatus,
  updatedAt: string,
): void {
  currentMap = { ...currentMap, [orderId]: { status, updatedAt } };
  emit();
}

export function applyStatusReset(): void {
  currentMap = EMPTY_MAP;
  emit();
}

// ---------------------------------------------------------------------------
// User actions → server (broadcast back over SSE)
// ---------------------------------------------------------------------------

export function setOrderStatus(
  orderId: string,
  status: OrderStatus,
  createdAt?: string,
): void {
  // Optimistic local update for instant feedback; the SSE echo reconciles.
  applyStatusEvent(orderId, status, new Date().toISOString());
  // `createdAt` lets the server compute prep time for daily stats without
  // depending on a warm orders cache (avoids a cold-start race).
  void fetch("/api/orders/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, status, createdAt }),
    cache: "no-store",
  }).catch(() => {
    // Network blip — the next SSE snapshot will resync the true state.
  });
}

export function clearAllStatuses(): void {
  applyStatusReset();
  void fetch("/api/orders/status", {
    method: "DELETE",
    cache: "no-store",
  }).catch(() => {});
}

/**
 * Local-only cleanup of the client view for orders that left the feed. The
 * server prunes authoritatively on every poll, so this never touches the API.
 */
export function pruneStatuses(activeOrderIds: Set<string>): void {
  let changed = false;
  const next: StatusMap = {};
  for (const [id, entry] of Object.entries(currentMap)) {
    if (activeOrderIds.has(id)) {
      next[id] = entry;
    } else {
      changed = true;
    }
  }
  if (changed) {
    currentMap = next;
    emit();
  }
}
