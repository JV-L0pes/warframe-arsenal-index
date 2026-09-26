"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

const STORED_EVENT = "arsenal-stored-change";

function subscribe(onChange: () => void) {
  const handler = () => onChange();
  window.addEventListener("storage", handler);
  window.addEventListener(STORED_EVENT, handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(STORED_EVENT, handler);
  };
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function useStoredState<T>(key: string, fallback: T) {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );

  const value = useMemo<T>(() => {
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }, [raw, fallback]);

  const setValue = useCallback(
    (next: T | ((current: T) => T)) => {
      let current = fallback;
      const currentRaw = readRaw(key);
      if (currentRaw !== null) {
        try {
          current = JSON.parse(currentRaw) as T;
        } catch {
          /* keep fallback */
        }
      }
      const resolved =
        typeof next === "function" ? (next as (c: T) => T)(current) : next;
      try {
        localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        /* ignore quota / private mode */
      }
      window.dispatchEvent(new Event(STORED_EVENT));
    },
    [key, fallback],
  );

  return [value, setValue] as const;
}
