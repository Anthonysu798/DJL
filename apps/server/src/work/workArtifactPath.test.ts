import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ProjectId, ThreadId } from "@synara/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { resolveThreadWorkspaceCwd } from "../checkpointing/Utils";
import { resolveWorkArtifactPath } from "./workArtifactPath";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("resolveWorkArtifactPath", () => {
  it("resolves a managed Work deliverable from the thread-specific task root", async () => {
    const studioRoot = mkdtempSync(path.join(tmpdir(), "djl-work-artifact-"));
    roots.push(studioRoot);
    const threadId = ThreadId.makeUnsafe("thread-managed-1");
    const projectId = ProjectId.makeUnsafe("project-studio-1");
    const taskRoot = resolveThreadWorkspaceCwd({
      thread: { id: threadId, projectId, envMode: "local", worktreePath: null },
      projects: [{ id: projectId, kind: "studio", workspaceRoot: studioRoot }],
    });
    expect(taskRoot).toBeDefined();
    const deliverable = path.join(taskRoot!, "Deliverables", "report-v1.pdf");
    mkdirSync(path.dirname(deliverable), { recursive: true });
    writeFileSync(deliverable, "pdf fixture");

    await expect(
      resolveWorkArtifactPath({
        threadId,
        projectId,
        projectKind: "studio",
        projectWorkspaceRoot: studioRoot,
        envMode: "local",
        worktreePath: null,
        requestedPath: "Deliverables/report-v1.pdf",
      }),
    ).resolves.toBe(realpathSync(deliverable));
  });

  it("rejects a relative artifact path that escapes the task root", async () => {
    const studioRoot = mkdtempSync(path.join(tmpdir(), "djl-work-artifact-"));
    roots.push(studioRoot);
    const threadId = ThreadId.makeUnsafe("thread-managed-2");
    const projectId = ProjectId.makeUnsafe("project-studio-2");
    const taskRoot = resolveThreadWorkspaceCwd({
      thread: { id: threadId, projectId, envMode: "local", worktreePath: null },
      projects: [{ id: projectId, kind: "studio", workspaceRoot: studioRoot }],
    });
    mkdirSync(taskRoot!, { recursive: true });

    await expect(
      resolveWorkArtifactPath({
        threadId,
        projectId,
        projectKind: "studio",
        projectWorkspaceRoot: studioRoot,
        envMode: "local",
        worktreePath: null,
        requestedPath: "../../outside.pdf",
      }),
    ).rejects.toThrow(/outside this task/i);
  });
});
