"use client";

import { useSyncExternalStore } from "react";
import type { OrderStatus, StatusEntry, StatusMap } from "./types";

const STORAGE_KEY = "rb.orderStatuses.v1";
const EVENT_NAME = "rb:status-change";
const EMPTY_MAP: StatusMap = Object.freeze({}) as StatusMap;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

let cachedMap: StatusMap = EMPTY_MAP;
let cachedRaw = "";

function readFromStorage(): StatusMap {
  if (!isBrowser()) return EMPTY_MAP;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? "";
    if (raw === cachedRaw) return cachedMap;
    cachedRaw = raw;
    if (!raw) {
      cachedMap = EMPTY_MAP;
      return cachedMap;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      cachedMap = EMPTY_MAP;
      return cachedMap;
    }
    cachedMap = parsed as StatusMap;
    return cachedMap;
  } catch {
    cachedMap = EMPTY_MAP;
    return cachedMap;
  }
}

function writeToStorage(map: StatusMap) {
  if (!isBrowser()) return;
  const serialized = JSON.stringify(map);
  window.localStorage.setItem(STORAGE_KEY, serialized);
  cachedRaw = serialized;
  cachedMap = map;
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

function subscribe(callback: () => void): () => void {
  if (!isBrowser()) return () => {};
  window.addEventListener(EVENT_NAME, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT_NAME, callback);
    window.removeEventListener("storage", callback);
  };
}

export function setOrderStatus(orderId: string, status: OrderStatus) {
  const current = readFromStorage();
  const entry: StatusEntry = {
    status,
    updatedAt: new Date().toISOString(),
  };
  writeToStorage({ ...current, [orderId]: entry });
}

export function clearAllStatuses() {
  writeToStorage({});
}

export function pruneStatuses(activeOrderIds: Set<string>) {
  const current = readFromStorage();
  let changed = false;
  const next: StatusMap = {};
  for (const [id, entry] of Object.entries(current)) {
    if (activeOrderIds.has(id)) {
      next[id] = entry;
    } else {
      changed = true;
    }
  }
  if (changed) writeToStorage(next);
}

export function useStatusMap(): StatusMap {
  return useSyncExternalStore(subscribe, readFromStorage, () => EMPTY_MAP);
}
