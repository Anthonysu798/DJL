import { describe, expect, it, vi } from "vitest";
import { ProjectId } from "@synara/contracts";

import {
  startContainerChat,
  startFreshChatForActiveSurface,
  type StartContainerChatResult,
} from "./startContainerChat";

const paths = {
  homeDir: "/Users/tester",
  chatWorkspaceRoot: "/Users/tester/Documents/Synara/Chats",
  studioWorkspaceRoot: "/Users/tester/Documents/Synara/Studio",
};

function successfulHandler() {
  return vi.fn(async (): Promise<StartContainerChatResult> => ({ ok: true }));
}

describe("startContainerChat", () => {
  it("keeps the localized preparation summary when ensuring the project fails unexpectedly", async () => {
    const rawDetail = "project.create failed with status 409";

    await expect(
      startContainerChat({
        ensureProjectId: async () => {
          throw new Error(rawDetail);
        },
        handleNewThread: vi.fn(),
        errorLabel: "Unable to prepare a new Work task.",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        summary: "Unable to prepare a new Work task.",
        detail: rawDetail,
      },
    });
  });

  it("keeps the localized preparation summary when starting the thread fails unexpectedly", async () => {
    const rawDetail = "thread.start rejected: provider unavailable";

    await expect(
      startContainerChat({
        ensureProjectId: async () => ProjectId.makeUnsafe("project-studio"),
        handleNewThread: async () => {
          throw new Error(rawDetail);
        },
        errorLabel: "Unable to prepare a new Work task.",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        summary: "Unable to prepare a new Work task.",
        detail: rawDetail,
      },
    });
  });
});

describe("startFreshChatForActiveSurface", () => {
  it("keeps the global New chat action in Studio", async () => {
    const handleNewChat = successfulHandler();
    const handleNewStudioChat = successfulHandler();

    await startFreshChatForActiveSurface({
      activeProject: {
        kind: "studio",
        cwd: "/Users/tester/Documents/Synara/Studio",
      },
      isStudioRoute: false,
      paths,
      handleNewChat,
      handleNewStudioChat,
    });

    expect(handleNewStudioChat).toHaveBeenCalledOnce();
    expect(handleNewStudioChat).toHaveBeenCalledWith({ fresh: true });
    expect(handleNewChat).not.toHaveBeenCalled();
  });

  it("keeps the global New chat action on the Studio landing route", async () => {
    const handleNewChat = successfulHandler();
    const handleNewStudioChat = successfulHandler();

    await startFreshChatForActiveSurface({
      activeProject: null,
      isStudioRoute: true,
      paths,
      handleNewChat,
      handleNewStudioChat,
    });

    expect(handleNewStudioChat).toHaveBeenCalledOnce();
    expect(handleNewChat).not.toHaveBeenCalled();
  });

  it("keeps the global New chat action in Projects for ordinary or missing projects", async () => {
    for (const activeProject of [
      { kind: "project" as const, cwd: "/Users/tester/Developer/app" },
      null,
    ]) {
      const handleNewChat = successfulHandler();
      const handleNewStudioChat = successfulHandler();

      await startFreshChatForActiveSurface({
        activeProject,
        isStudioRoute: false,
        paths,
        handleNewChat,
        handleNewStudioChat,
      });

      expect(handleNewChat).toHaveBeenCalledOnce();
      expect(handleNewChat).toHaveBeenCalledWith({ fresh: true });
      expect(handleNewStudioChat).not.toHaveBeenCalled();
    }
  });
});
