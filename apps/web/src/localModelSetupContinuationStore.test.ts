import { describe, expect, it, vi } from "vitest";

import {
  canAutoResumeLocalModelSetup,
  createLocalModelSetupContinuationStore,
  fingerprintLocalModelSetupDraft,
} from "./localModelSetupContinuationStore";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("local model setup continuation store", () => {
  it("persists an explicitly authorized setup and restores it after reload", () => {
    const storage = memoryStorage();
    const first = createLocalModelSetupContinuationStore({ storage, now: () => 100 });
    first.begin({
      threadId: "thread-1",
      jobId: "job-1",
      expectedModelSlug: "ollama/granite4.1:3b",
      draftFingerprint: "draft-a",
    });

    const restored = createLocalModelSetupContinuationStore({ storage, now: () => 200 });
    expect(restored.getSnapshot()).toMatchObject({
      threadId: "thread-1",
      jobId: "job-1",
      state: "waiting",
    });
  });

  it("only marks and claims the exact authorized job, thread, and model", () => {
    const store = createLocalModelSetupContinuationStore({ storage: memoryStorage() });
    store.begin({
      threadId: "thread-1",
      jobId: "job-1",
      expectedModelSlug: "ollama/granite4.1:3b",
      draftFingerprint: "draft-a",
    });

    expect(store.markReady("other-job")).toBe(false);
    expect(store.markReady("job-1", "ollama/qwen-fallback")).toBe(true);
    expect(store.getSnapshot()?.expectedModelSlug).toBe("ollama/qwen-fallback");
    expect(
      store.claimDispatch({
        threadId: "thread-2",
        expectedModelSlug: "ollama/qwen-fallback",
        draftFingerprint: "draft-a",
      }),
    ).toBeNull();
    expect(
      store.claimDispatch({
        threadId: "thread-1",
        expectedModelSlug: "ollama/qwen-fallback",
        draftFingerprint: "draft-a",
      }),
    ).toMatchObject({ jobId: "job-1" });
    expect(
      store.claimDispatch({
        threadId: "thread-1",
        expectedModelSlug: "ollama/qwen-fallback",
        draftFingerprint: "draft-a",
      }),
    ).toBeNull();
  });

  it("resets a failed dispatch and completes only once", () => {
    const store = createLocalModelSetupContinuationStore({ storage: memoryStorage() });
    store.begin({
      threadId: "thread-1",
      jobId: "job-1",
      expectedModelSlug: "ollama/granite4.1:3b",
      draftFingerprint: "draft-a",
    });
    store.markReady("job-1");
    store.claimDispatch({
      threadId: "thread-1",
      expectedModelSlug: "ollama/granite4.1:3b",
      draftFingerprint: "draft-a",
    });

    expect(store.resetDispatch("job-1")).toBe(true);
    expect(store.complete("job-1")).toBe(true);
    expect(store.complete("job-1")).toBe(false);
  });

  it("drops malformed and expired persisted continuations", () => {
    const storage = memoryStorage();
    storage.setItem("djl.local-model-setup-continuation.v1", "not-json");
    expect(createLocalModelSetupContinuationStore({ storage }).getSnapshot()).toBeNull();

    storage.setItem(
      "djl.local-model-setup-continuation.v1",
      JSON.stringify({
        threadId: "thread-1",
        jobId: "job-1",
        expectedModelSlug: "ollama/granite4.1:3b",
        draftFingerprint: "draft-a",
        state: "waiting",
        createdAt: 1,
      }),
    );
    const now = vi.fn(() => 24 * 60 * 60 * 1_000 + 2);
    expect(createLocalModelSetupContinuationStore({ storage, now }).getSnapshot()).toBeNull();
  });

  it("only resumes when the exact thread and ready model can be sent", () => {
    const continuation = {
      threadId: "thread-1",
      jobId: "job-1",
      expectedModelSlug: "ollama/model-a",
      draftFingerprint: "draft-a",
      state: "ready" as const,
      createdAt: 1,
    };
    const readyInput = {
      continuation,
      threadId: "thread-1",
      selectedProvider: "opencode",
      selectedModel: "ollama/model-a",
      availableOpenCodeModelSlugs: ["ollama/model-a"],
      draftFingerprint: "draft-a",
      hasSendableContent: true,
      busy: false,
    };

    expect(canAutoResumeLocalModelSetup(readyInput)).toBe(true);
    expect(canAutoResumeLocalModelSetup({ ...readyInput, threadId: "thread-2" })).toBe(false);
    expect(canAutoResumeLocalModelSetup({ ...readyInput, selectedModel: "ollama/model-b" })).toBe(
      false,
    );
    expect(canAutoResumeLocalModelSetup({ ...readyInput, busy: true })).toBe(false);
    expect(canAutoResumeLocalModelSetup({ ...readyInput, hasSendableContent: false })).toBe(false);
    expect(canAutoResumeLocalModelSetup({ ...readyInput, draftFingerprint: "changed-draft" })).toBe(
      false,
    );
  });

  it("cancels a waiting or ready continuation as soon as its draft changes", () => {
    const store = createLocalModelSetupContinuationStore({ storage: memoryStorage() });
    store.begin({
      threadId: "thread-1",
      jobId: "job-1",
      expectedModelSlug: "ollama/model-a",
      draftFingerprint: "draft-a",
    });

    expect(store.cancelIfDraftChanged({ threadId: "thread-2", draftFingerprint: "draft-b" })).toBe(
      false,
    );
    expect(store.cancelIfDraftChanged({ threadId: "thread-1", draftFingerprint: "draft-a" })).toBe(
      false,
    );
    expect(store.cancelIfDraftChanged({ threadId: "thread-1", draftFingerprint: "draft-b" })).toBe(
      true,
    );
    expect(store.getSnapshot()).toBeNull();
  });

  it("fingerprints the exact draft without persisting its text", () => {
    const first = fingerprintLocalModelSetupDraft("write a report");
    expect(first).toBe(fingerprintLocalModelSetupDraft("write a report"));
    expect(first).not.toBe(fingerprintLocalModelSetupDraft("write another report"));
    expect(first).not.toContain("write a report");
  });
});
