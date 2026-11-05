"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { getScopedShopSession, scopedShopConfig, type ScopedShopSession } from "@/lib/scoped-shop";

export function ScopedShopAdmission({ children }: { children: ReactNode }) {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  if (
    scopedShopConfig.mode !== "test" ||
    (origin !== null && origin !== scopedShopConfig.webOrigin)
  )
    return (
      <p role="alert" className="p-8">
        本地独立测试商城未启用。
      </p>
    );
  if (origin === null)
    return (
      <p role="status" className="p-8">
        正在确认本地测试商城…
      </p>
    );
  return <>{children}</>;
}

type Snapshot = {
  readonly data:
    | (Omit<ScopedShopSession, "user"> & {
        readonly user: ScopedShopSession["user"] & { readonly name: string };
      })
    | null;
  readonly error: { readonly status: number } | null;
  readonly isPending: false;
  readonly isRefetching: false;
};
const empty: Snapshot = { data: null, error: null, isPending: false, isRefetching: false };

export function useScopedShopSession() {
  const state = useRef<Snapshot>(empty);
  const [, render] = useState(0);
  const flight = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
  const read = useCallback(() => state.current, []);
  const refetch = useCallback(() => {
    if (flight.current) return flight.current.promise;
    const controller = new AbortController();
    const publish = (value: Snapshot) => {
      if (controller.signal.aborted) return;
      state.current = value;
      render((count) => count + 1);
    };
    const promise = getScopedShopSession(controller.signal)
      .then((session) =>
        publish({
          ...empty,
          data: session
            ? { ...session, user: { ...session.user, name: session.user.email } }
            : null,
        }),
      )
      .catch((error: unknown) =>
        publish({ ...empty, error: { status: error instanceof ApiError ? error.status : 503 } }),
      )
      .finally(() => {
        if (flight.current?.controller === controller) flight.current = null;
      });
    flight.current = { controller, promise };
    return promise;
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      flight.current?.controller.abort();
      flight.current = null;
    };
  }, [refetch]);

  return { read, refetch };
}
