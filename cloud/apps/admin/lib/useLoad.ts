"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { errorMessage } from "./i18n/errors";

/** Minimal load/refresh hook for admin pages: data, error, reload. */
export function useLoad<T>(loader: () => Promise<T>, deps: readonly unknown[] = []) {
  const { locale } = useI18n();
  const [data, setData] = useState<T | null>(null);
  const [failure, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  // Callers pass fresh closures every render; keep the latest one in a ref and
  // re-run only when the (primitive) deps change, keyed by their JSON form.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const key = JSON.stringify(deps);
  const sequence = useRef(0);
  const reload = useCallback(() => {
    const request = ++sequence.current;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((value) => {
        if (request === sequence.current) setData(value);
      })
      .catch((error) => {
        if (request === sequence.current) setError(error);
      })
      .finally(() => {
        if (request === sequence.current) setLoading(false);
      });
  }, []);
  useEffect(() => {
    reload();
    return () => {
      sequence.current++;
    };
  }, [reload, key]);
  return { data, error: failure ? errorMessage(failure, locale) : null, loading, reload, setData };
}

/** Prompt for the mandatory reason before a mutation. */
export function askReason(action: string): string | null {
  const reason = window.prompt(`Reason for: ${action}`);
  return reason?.trim() ? reason.trim() : null;
}
