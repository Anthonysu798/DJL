// FILE: startContainerChat.ts
// Purpose: Shared "ensure the hidden container project, then open a thread inside it" flow
//          used by both the home-chat and Studio new-chat hooks.
// Layer: Web orchestration helper
// Exports: Container-chat startup plus segment-aware fresh-chat dispatch.

import type { ProjectId } from "@synara/contracts";
import type { Project } from "../types";
import { isStudioContainerProject } from "./studioProjects";
import type { ServerWorkspacePaths } from "./serverWorkspacePaths";
import type { NewThreadOptions } from "./threadBootstrap";
import { ContainerChatFailureError, type ContainerChatFailure } from "./containerChatFailure";

export type StartContainerChatResult = { ok: true } | { ok: false; error: ContainerChatFailure };

type StartFreshContainerChat = (options: { fresh: true }) => Promise<StartContainerChatResult>;

/**
 * Starts a fresh chat in the surface that owns the active project. Thread routes are shared by
 * Projects and Studio, so callers cannot infer the surface from the URL alone.
 */
export function startFreshChatForActiveSurface(input: {
  readonly activeProject: Pick<Project, "cwd" | "kind"> | null;
  readonly isStudioRoute: boolean;
  readonly paths: ServerWorkspacePaths;
  readonly handleNewChat: StartFreshContainerChat;
  readonly handleNewStudioChat: StartFreshContainerChat;
}): Promise<StartContainerChatResult> {
  const handler =
    input.isStudioRoute || isStudioContainerProject(input.activeProject, input.paths)
      ? input.handleNewStudioChat
      : input.handleNewChat;
  return handler({ fresh: true });
}

/**
 * Resolves (creating if needed) the backing container project, then starts a thread inside it.
 * Both home chats and Studio chats share this exact flow; only the container resolver and the
 * user-facing failure label vary.
 */
export async function startContainerChat(input: {
  readonly ensureProjectId: () => Promise<ProjectId | null>;
  readonly handleNewThread: (projectId: ProjectId, options?: NewThreadOptions) => Promise<unknown>;
  readonly fresh?: boolean | undefined;
  readonly errorLabel: string;
}): Promise<StartContainerChatResult> {
  try {
    const projectId = await input.ensureProjectId();
    if (!projectId) {
      return { ok: false, error: { summary: input.errorLabel, detail: null } };
    }
    const threadOptions: NewThreadOptions | undefined =
      input.fresh === true ? { fresh: true, envMode: "local", worktreePath: null } : undefined;
    await input.handleNewThread(projectId, threadOptions);
    return { ok: true };
  } catch (error) {
    if (error instanceof ContainerChatFailureError) {
      return { ok: false, error: error.failure };
    }
    return {
      ok: false,
      error: {
        summary: input.errorLabel,
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
