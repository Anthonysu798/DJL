import { useEffect } from "react";
import { useSelectedLocale } from "../i18n/intl";
import { useTheme } from "../hooks/useTheme";
import { useStore } from "../store";
import { getStartupSession } from "./session";

/** Persist a small read-only shell snapshot; never walk full histories on input. */
export function useStartupSnapshot(): void {
  const locale = useSelectedLocale();
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    const session = getStartupSession();
    if (!session) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const state = useStore.getState();
      if (!state.threadsHydrated) return;
      const projects = state.projects
        .slice(0, 64)
        .filter((project) => project.kind === "project")
        .slice(0, 32)
        .map((project) => ({ id: project.id, title: project.name }));
      const threads = (state.threadIds ?? [])
        .slice(0, 80)
        .flatMap((id) => {
          const thread = state.sidebarThreadSummaryById[id];
          return thread && !thread.archivedAt ? [{ id, title: thread.title }] : [];
        })
        .slice(0, 40);
      const width =
        document.querySelector("[data-sidebar=sidebar]")?.getBoundingClientRect().width ?? 260;
      session.storage.writeSnapshot({
        version: 1,
        savedAt: Date.now(),
        locale,
        theme: resolvedTheme === "dark" ? "dark" : "light",
        sidebarWidth: width,
        projects,
        threads,
        model: session.draft.model,
      });
    };
    const schedule = () => {
      if (timer === undefined) timer = setTimeout(save, 1000);
    };
    const unsubscribe = useStore.subscribe((next, previous) => {
      if (
        next.projects !== previous.projects ||
        next.threadIds !== previous.threadIds ||
        next.sidebarThreadSummaryById !== previous.sidebarThreadSummaryById ||
        next.threadsHydrated !== previous.threadsHydrated
      )
        schedule();
    });
    let modelKey = JSON.stringify(session.draft.model);
    const unsubscribeModel = session.subscribe(() => {
      const next = JSON.stringify(session.draft.model);
      if (next !== modelKey) {
        modelKey = next;
        schedule();
      }
    });
    schedule();
    window.addEventListener("pagehide", save);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
      unsubscribeModel();
      window.removeEventListener("pagehide", save);
    };
  }, [locale, resolvedTheme]);
}
