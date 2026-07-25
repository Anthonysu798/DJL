// FILE: WorkIndexRouteView.tsx
// Purpose: Restores the latest DJL Work task or creates a managed task when the Work route opens.
// Layer: Web UI

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppSettings } from "../../appSettings";
import { resolveRestorableThreadRoute } from "../../chatRouteRestore";
import { useComposerDraftStore } from "../../composerDraftStore";
import { useHandleNewStudioChat } from "../../hooks/useHandleNewStudioChat";
import { useSyncServerWorkspacePathsFromConfig } from "../../hooks/useSyncServerWorkspacePathsFromConfig";
import { collectStudioProjectIds, findStudioDraftThreadId } from "../../lib/studioProjects";
import { EMPTY_THREAD_IDS, useStore } from "../../store";
import { useWorkspaceStore } from "../../workspaceStore";
import { RestoreOrCreateChatRoute, type RestoreRouteResolver } from "../RestoreOrCreateChatRoute";
import { sortThreadsForSidebar } from "../Sidebar.logic";
import { readSidebarUiState } from "../Sidebar.uiState";
import { SplashScreen } from "../SplashScreen";

const WORKSPACE_PATHS_TIMEOUT_MS = 10_000;

export function WorkIndexRouteView() {
  const { t } = useTranslation("work");
  useSyncServerWorkspacePathsFromConfig();
  const { settings: appSettings } = useAppSettings();
  const { handleNewStudioChat } = useHandleNewStudioChat();
  const threadIds = useStore((state) => state.threadIds ?? EMPTY_THREAD_IDS);
  const projects = useStore((state) => state.projects);
  const sidebarThreadSummaryById = useStore((state) => state.sidebarThreadSummaryById);
  const draftThreadsByThreadId = useComposerDraftStore((state) => state.draftThreadsByThreadId);
  const projectDraftThreadIdByProjectId = useComposerDraftStore(
    (state) => state.projectDraftThreadIdByProjectId,
  );
  const homeDir = useWorkspaceStore((state) => state.homeDir);
  const chatWorkspaceRoot = useWorkspaceStore((state) => state.chatWorkspaceRoot);
  const studioWorkspaceRoot = useWorkspaceStore((state) => state.studioWorkspaceRoot);

  // Internal Studio identifiers remain intact for storage and RPC compatibility. Work is the
  // user-facing surface over the same managed container.
  const workProjectIds = useMemo(
    () => collectStudioProjectIds(projects, { homeDir, chatWorkspaceRoot, studioWorkspaceRoot }),
    [chatWorkspaceRoot, homeDir, projects, studioWorkspaceRoot],
  );
  const workDraftThreadId = useMemo(
    () =>
      findStudioDraftThreadId({
        studioProjectIds: workProjectIds,
        projectDraftThreadIdByProjectId,
        draftThreadsByThreadId,
      }),
    [draftThreadsByThreadId, projectDraftThreadIdByProjectId, workProjectIds],
  );
  const workTaskSummaries = useMemo(
    () =>
      threadIds.flatMap((threadId) => {
        const summary = sidebarThreadSummaryById[threadId];
        return summary &&
          (summary.archivedAt ?? null) === null &&
          workProjectIds.has(summary.projectId)
          ? [summary]
          : [];
      }),
    [sidebarThreadSummaryById, threadIds, workProjectIds],
  );
  const latestWorkTaskId = useMemo(
    () =>
      sortThreadsForSidebar(workTaskSummaries, appSettings.sidebarThreadSortOrder)[0]?.id ?? null,
    [appSettings.sidebarThreadSortOrder, workTaskSummaries],
  );

  const resolveRestoreRoute = useCallback<RestoreRouteResolver>(
    ({ availableSplitViewIds }) => {
      const availableThreadIds = new Set<string>(workTaskSummaries.map((thread) => thread.id));
      if (workDraftThreadId) {
        availableThreadIds.add(workDraftThreadId);
      }
      const rememberedRoute = resolveRestorableThreadRoute({
        lastThreadRoute: readSidebarUiState().lastThreadRoute,
        availableThreadIds,
        availableSplitViewIds,
      });
      if (rememberedRoute) {
        return rememberedRoute;
      }
      if (workDraftThreadId || !latestWorkTaskId) {
        return null;
      }
      return { threadId: latestWorkTaskId };
    },
    [latestWorkTaskId, workDraftThreadId, workTaskSummaries],
  );

  // Reuse an existing managed draft instead of creating duplicates on every visit.
  const createFreshTask = useCallback(() => handleNewStudioChat(), [handleNewStudioChat]);
  const navigate = useNavigate();
  const workSectionVisible = appSettings.showStudioSection;
  useEffect(() => {
    if (!workSectionVisible) {
      void navigate({ to: "/", replace: true });
    }
  }, [navigate, workSectionVisible]);

  const [pathsWaitTimedOut, setPathsWaitTimedOut] = useState(false);
  useEffect(() => {
    if (studioWorkspaceRoot || pathsWaitTimedOut) {
      return;
    }
    const timer = window.setTimeout(() => setPathsWaitTimedOut(true), WORKSPACE_PATHS_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [pathsWaitTimedOut, studioWorkspaceRoot]);

  if (!workSectionVisible) {
    return <SplashScreen />;
  }

  if (!studioWorkspaceRoot) {
    return (
      <SplashScreen
        errorMessage={pathsWaitTimedOut ? t("route.loadTimeout") : null}
        onRetry={pathsWaitTimedOut ? () => setPathsWaitTimedOut(false) : null}
      />
    );
  }

  return (
    <RestoreOrCreateChatRoute
      resolveRestoreRoute={resolveRestoreRoute}
      createFreshChat={createFreshTask}
    />
  );
}
