"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  enrichOwnedSnapshot,
  OWNED_STORAGE_KEY,
  parseInventoryFile,
} from "@/lib/inventory";
import type { OwnedSnapshot } from "@/lib/types";

const OWNED_EVENT = "arsenal-owned-change";

let cacheKey: string | null | undefined = undefined;
let cacheValue: OwnedSnapshot | null = null;

function readOwned(fallback: OwnedSnapshot | null): OwnedSnapshot | null {
  try {
    const raw = localStorage.getItem(OWNED_STORAGE_KEY);
    if (raw === cacheKey) return cacheValue ?? fallback;
    cacheKey = raw;
    if (!raw) {
      cacheValue = null;
      return fallback;
    }
    const result = parseInventoryFile(JSON.parse(raw) as unknown);
    cacheValue = result.ok ? enrichOwnedSnapshot(result.owned) : null;
    return cacheValue ?? fallback;
  } catch {
    cacheKey = undefined;
    cacheValue = null;
    return fallback;
  }
}

function subscribe(onChange: () => void) {
  const handler = () => {
    cacheKey = undefined;
    onChange();
  };
  window.addEventListener("storage", handler);
  window.addEventListener(OWNED_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(OWNED_EVENT, handler);
  };
}

export function useOwnedInventory(initialOwned: OwnedSnapshot | null) {
  const owned = useSyncExternalStore(
    subscribe,
    () => readOwned(initialOwned),
    () => initialOwned,
  );

  const persistOwned = useCallback((next: OwnedSnapshot | null) => {
    try {
      if (next) localStorage.setItem(OWNED_STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(OWNED_STORAGE_KEY);
    } catch {
      /* ignore quota / private mode */
    }
    cacheKey = undefined;
    cacheValue = next;
    window.dispatchEvent(new Event(OWNED_EVENT));
  }, []);

  return { owned, persistOwned };
}
