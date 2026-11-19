import type { ComputerActivitySemanticSummary, ThreadId } from "@synara/contracts";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "../appSettings";
import { useComposerDraftStore } from "../composerDraftStore";
import { createHistorySuggestionDraftController } from "../lib/historySuggestionDraft";
import { findStudioContainerProject } from "../lib/studioProjects";
import { useStore } from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import { useWorkspaceStore } from "../workspaceStore";

const controllers = new WeakMap<
  object,
  ReturnType<typeof createHistorySuggestionDraftController>
>();

export function useHistorySuggestionDraft() {
  const router = useRouter();
  const navigate = useNavigate();
  const { t } = useTranslation("settings");
  const { settings } = useAppSettings();
  const homeDir = useWorkspaceStore((state) => state.homeDir);
  const chatWorkspaceRoot = useWorkspaceStore((state) => state.chatWorkspaceRoot);
  const studioWorkspaceRoot = useWorkspaceStore((state) => state.studioWorkspaceRoot);
  const projects = useStore((state) => state.projects);
  const paths = { homeDir, chatWorkspaceRoot, studioWorkspaceRoot };
  const project = findStudioContainerProject(projects, paths);
  const existingDraftId = useComposerDraftStore((state) =>
    project ? (state.getDraftThreadByProjectId(project.id, "chat")?.threadId ?? null) : null,
  );
  let controller = controllers.get(router);
  if (!controller) {
    controller = createHistorySuggestionDraftController({
      pathname: () => router.state.location.pathname,
      subscribe: (listener) =>
        router.subscribe("onBeforeNavigate", (event) => listener(event.toLocation.pathname)),
      open: async (threadId: ThreadId) => {
        useTerminalStateStore.getState().openChatThreadPage(threadId);
        await navigate({ to: "/$threadId", params: { threadId }, search: {} });
      },
    });
    controllers.set(router, controller);
  }
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const review = useCallback(
    (summary: ComputerActivitySemanticSummary) =>
      controller.review({
        summary,
        paths: { homeDir, chatWorkspaceRoot, studioWorkspaceRoot },
        defaultProvider: settings.defaultProvider,
        title: t("computerUse.suggestionDraft.title"),
        opening: t("computerUse.suggestionDraft.prompt"),
      }),
    [controller, homeDir, chatWorkspaceRoot, studioWorkspaceRoot, settings.defaultProvider, t],
  );
  const resumeExistingDraft = useCallback(async () => {
    const currentProject = findStudioContainerProject(useStore.getState().projects, {
      homeDir,
      chatWorkspaceRoot,
      studioWorkspaceRoot,
    });
    const draft = currentProject
      ? useComposerDraftStore.getState().getDraftThreadByProjectId(currentProject.id, "chat")
      : null;
    if (!draft) return;
    useTerminalStateStore.getState().openChatThreadPage(draft.threadId);
    await navigate({ to: "/$threadId", params: { threadId: draft.threadId }, search: {} });
  }, [chatWorkspaceRoot, homeDir, navigate, studioWorkspaceRoot]);
  return {
    ...state,
    review,
    recover: controller.recover,
    ...(existingDraftId ? { resumeExistingDraft } : {}),
  };
}
