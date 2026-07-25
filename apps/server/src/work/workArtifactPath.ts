// FILE: workArtifactPath.ts
// Purpose: Resolve a task-relative Work artifact through the backend-authoritative
//          thread workspace, including managed task folders and symlink confinement.

import type { ProjectId, ProjectKind, ThreadId } from "@synara/contracts";

import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils";
import { resolveAuthorizedInputPath, WorkToolValidationError } from "./documentTools";

export async function resolveWorkArtifactPath(input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly projectKind: ProjectKind;
  readonly projectWorkspaceRoot: string;
  readonly envMode: "local" | "worktree";
  readonly worktreePath: string | null;
  readonly requestedPath: string;
}): Promise<string> {
  const workspaceRoot = resolveThreadWorkspaceCwd({
    thread: {
      id: input.threadId,
      projectId: input.projectId,
      envMode: input.envMode,
      worktreePath: input.worktreePath,
    },
    projects: [
      {
        id: input.projectId,
        kind: input.projectKind,
        workspaceRoot: input.projectWorkspaceRoot,
      },
    ],
  });
  if (!workspaceRoot) {
    throw new WorkToolValidationError("This task does not have an authorized Work folder.");
  }
  return resolveAuthorizedInputPath(workspaceRoot, input.requestedPath);
}
