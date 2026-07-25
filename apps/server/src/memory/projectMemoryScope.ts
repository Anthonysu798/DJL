// FILE: projectMemoryScope.ts
// Purpose: Stable, privacy-preserving memory scope for managed and folder-backed Work tasks.

import { createHash } from "node:crypto";

import { ProjectId } from "@synara/contracts";

export interface ProjectMemoryScope {
  readonly projectId: ProjectId;
  readonly title: string;
  readonly kind: "managed" | "workspace";
}

function normalizedWorkspaceIdentity(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
  // Windows roots are case-insensitive. Canonical server paths on POSIX retain
  // case so two distinct case-sensitive folders do not share memory.
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export function resolveProjectMemoryScope(input: {
  readonly containerProjectId: ProjectId;
  readonly containerTitle: string;
  readonly workspaceRoot: string | null | undefined;
}): ProjectMemoryScope {
  const workspaceIdentity = input.workspaceRoot
    ? normalizedWorkspaceIdentity(input.workspaceRoot)
    : "";
  if (!workspaceIdentity) {
    return {
      projectId: input.containerProjectId,
      title: input.containerTitle,
      kind: "managed",
    };
  }
  const digest = createHash("sha256")
    .update(`djl-work-memory\0${workspaceIdentity}`)
    .digest("hex")
    .slice(0, 40);
  const folderName = workspaceIdentity.split("/").findLast(Boolean) ?? "Work project";
  return {
    projectId: ProjectId.makeUnsafe(`work-location-${digest}`),
    title: folderName,
    kind: "workspace",
  };
}
