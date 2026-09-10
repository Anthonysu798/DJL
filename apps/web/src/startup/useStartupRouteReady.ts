import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { getStartupSession } from "./session";

export function useStartupRouteReady(): void {
  const path = useRouterState({
    select: (state) =>
      state.status === "idle" ? (state.resolvedLocation?.pathname ?? null) : null,
  });
  useEffect(() => {
    const session = getStartupSession();
    if (!session?.previewActive || !path) return;
    const normalized = path.replace(/\/$/, "") || "/";
    if (["/", "/work", "/studio"].includes(normalized)) return;
    const ownRoute = `/${session.draft.threadId ?? session.draft.id}`;
    if (!session.navigationTarget && normalized === ownRoute) return;
    // A deleted cached route may resolve to a fallback. Native menu navigation
    // can also change routes without going through the temporary sidebar.
    if (!session.navigationTarget) session.navigate(normalized);
    const frame = requestAnimationFrame(() => session.finishPreview());
    return () => cancelAnimationFrame(frame);
  }, [path]);
}
