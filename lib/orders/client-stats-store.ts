"use client";

import { useSyncExternalStore } from "react";
import type { PublicStats } from "./types";

/**
 * Client mirror of the server's daily stats, fed by the SSE stream
 * (see use-orders.ts). Read-only on the client — there are no user actions
 * that mutate stats directly; they update as a side effect of marking orders
 * ready.
 */

let current: PublicStats | null = null;
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

function getSnapshot(): PublicStats | null {
  return current;
}

export function applyStats(stats: PublicStats | undefined): void {
  current = stats ?? null;
  emit();
}

export function useStats(): PublicStats | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
