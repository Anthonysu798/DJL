"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Minimal load/refresh hook for admin pages: data, error, reload. */
export function useLoad<T>(loader: () => Promise<T>, deps: readonly unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Callers pass fresh closures every render; keep the latest one in a ref and
  // re-run only when the (primitive) deps change, keyed by their JSON form.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const key = JSON.stringify(deps);
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    reload();
  }, [reload, key]);
  return { data, error, loading, reload, setData };
}

/** Prompt for the mandatory reason before a mutation. */
export function askReason(action: string): string | null {
  const reason = window.prompt(`Reason for: ${action}`);
  return reason?.trim() ? reason.trim() : null;
}
