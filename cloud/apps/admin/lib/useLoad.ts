"use client";
import { useCallback, useEffect, useState } from "react";

/** Minimal load/refresh hook for admin pages: data, error, reload. */
export function useLoad<T>(loader: () => Promise<T>, deps: readonly unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    loader()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

/** Prompt for the mandatory reason before a mutation. */
export function askReason(action: string): string | null {
  const reason = window.prompt(`Reason for: ${action}`);
  return reason?.trim() ? reason.trim() : null;
}
