import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectId, ThreadId } from "@synara/contracts";
import { useComposerDraftStore } from "../composerDraftStore";
import type { Thread } from "../types";
import { useThreadHandoff } from "./useThreadHandoff";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  snapshot: vi.fn(),
  navigate: vi.fn(),
  sync: vi.fn(),
  availability: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../nativeApi", () => ({
  readNativeApi: () => ({
    orchestration: {
      dispatchCommand: mocks.dispatch,
      getShellSnapshot: mocks.snapshot,
    },
  }),
}));
vi.mock("../store", () => ({
  useStore: (selector: (state: unknown) => unknown) =>
    selector({
      projects: [{ id: "project", defaultModelSelection: null }],
      syncServerShellSnapshot: mocks.sync,
    }),
}));
vi.mock("./useProviderStatusesForLocalConfig", () => ({
  useProviderStatusesForLocalConfig: () => [],
}));
vi.mock("./useProviderStatusRefresh", () => ({ useRefreshProviderStatusesNow: () => vi.fn() }));
vi.mock("../lib/providerAvailability", () => ({
  resolveProviderSendAvailabilityWithRefresh: mocks.availability,
}));

const source = {
  id: ThreadId.makeUnsafe("source"),
  projectId: ProjectId.makeUnsafe("project"),
  title: "Task",
  modelSelection: { provider: "codex", model: "gpt-5.5" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  envMode: "local",
  branch: null,
  worktreePath: null,
  handoff: null,
  session: null,
  activities: [],
  messages: [
    {
      id: "message",
      role: "user",
      text: "Original context",
      streaming: false,
      source: "native",
      createdAt: "2026-09-08T00:00:00.000Z",
    },
  ],
} as unknown as Thread;
const selection = { provider: "claudeAgent", model: "claude-sonnet-4-6" } as const;

function readHook() {
  const result: { current?: ReturnType<typeof useThreadHandoff> } = {};
  function Probe() {
    result.current = useThreadHandoff();
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return result.current!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatch.mockResolvedValue(undefined);
  mocks.snapshot.mockResolvedValue({});
  mocks.navigate.mockResolvedValue(undefined);
  mocks.availability.mockResolvedValue({ usable: true });
  useComposerDraftStore.setState({ draftsByThreadId: {} });
  useComposerDraftStore.getState().setPrompt(source.id, "Follow up @claude");
});

describe("Agent mode handoff", () => {
  it.each(["claudeAgent", "codex", "cursor", "grok"] as const)(
    "starts %s handoffs with the provider's unrestricted permission mode",
    async (provider) => {
      const origin = provider === "codex" ? { ...source, modelSelection: selection } : source;
      await readHook().createThreadHandoff(origin, provider);
      expect(mocks.dispatch.mock.calls[0]?.[0]).toMatchObject({
        runtimeMode: provider === "claudeAgent" ? "bypass-permissions" : "full-access",
      });
    },
  );
  it("uses the selected model and transfers the cleaned draft without altering the source", async () => {
    const id = await readHook().createThreadHandoff(source, "claudeAgent", {
      modelSelection: selection,
      prompt: "Follow up",
    });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: "thread.handoff.create",
      modelSelection: selection,
      sourceThreadId: source.id,
      expectedSourceUpdatedAt: source.createdAt,
    });
    expect(useComposerDraftStore.getState().draftsByThreadId[id]?.prompt).toBe("Follow up");
    expect(useComposerDraftStore.getState().draftsByThreadId[source.id]?.prompt).toBe(
      "Follow up @claude",
    );
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/$threadId", params: { threadId: id } });
  });

  it("retries an uncertain response using the same idempotent command", async () => {
    const hook = readHook();
    mocks.snapshot.mockRejectedValueOnce(new Error("connection lost"));
    await expect(
      hook.createThreadHandoff(source, "claudeAgent", { modelSelection: selection }),
    ).rejects.toThrow("connection lost");
    await readHook().createThreadHandoff(source, "claudeAgent", { modelSelection: selection });
    expect(mocks.dispatch.mock.calls[1]?.[0]).toEqual(mocks.dispatch.mock.calls[0]?.[0]);
  });

  it("leaves the source intact when the target provider is unavailable", async () => {
    mocks.availability.mockResolvedValue({ usable: false, unavailableReason: "Sign in to Claude" });
    await expect(readHook().createThreadHandoff(source, "claudeAgent")).rejects.toThrow(
      "Sign in to Claude",
    );
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(useComposerDraftStore.getState().draftsByThreadId[source.id]?.prompt).toBe(
      "Follow up @claude",
    );
  });

  it("blocks overlapping requests and releases the lock after failure", async () => {
    let reject!: (error: Error) => void;
    mocks.availability.mockReturnValueOnce(
      new Promise((_, rejectPromise) => {
        reject = rejectPromise;
      }),
    );
    const hook = readHook();
    const first = hook.createThreadHandoff(source, "claudeAgent");
    await expect(readHook().createThreadHandoff(source, "claudeAgent")).rejects.toThrow(
      "already being created",
    );
    reject(new Error("offline"));
    await expect(first).rejects.toThrow("offline");
    await expect(hook.createThreadHandoff(source, "claudeAgent")).resolves.toBeTruthy();
  });
});
