import { useSyncExternalStore } from "react";

const STORAGE_KEY = "djl.local-model-setup-continuation.v1";
const MAX_CONTINUATION_AGE_MS = 24 * 60 * 60 * 1_000;

export type LocalModelSetupContinuationState = "waiting" | "ready" | "dispatching";

export type LocalModelSetupContinuation = {
  readonly threadId: string;
  readonly jobId: string;
  readonly expectedModelSlug: string;
  readonly draftFingerprint: string;
  readonly state: LocalModelSetupContinuationState;
  readonly createdAt: number;
};

export function fingerprintLocalModelSetupDraft(serializedDraft: string): string {
  let primary = 0x811c9dc5;
  let secondary = 0x9e3779b9;
  for (let index = 0; index < serializedDraft.length; index += 1) {
    const codeUnit = serializedDraft.charCodeAt(index);
    primary = Math.imul(primary ^ codeUnit, 0x01000193) >>> 0;
    secondary = Math.imul(secondary ^ codeUnit, 0x85ebca6b) >>> 0;
  }
  return `${serializedDraft.length}:${primary.toString(36)}:${secondary.toString(36)}`;
}

export function canAutoResumeLocalModelSetup(input: {
  readonly continuation: LocalModelSetupContinuation | null;
  readonly threadId: string;
  readonly selectedProvider: string;
  readonly selectedModel: string;
  readonly availableOpenCodeModelSlugs: ReadonlyArray<string>;
  readonly draftFingerprint: string;
  readonly hasSendableContent: boolean;
  readonly busy: boolean;
}): boolean {
  const continuation = input.continuation;
  return Boolean(
    continuation?.state === "ready" &&
    continuation.threadId === input.threadId &&
    continuation.draftFingerprint === input.draftFingerprint &&
    input.hasSendableContent &&
    !input.busy &&
    input.selectedProvider === "opencode" &&
    input.selectedModel === continuation.expectedModelSlug &&
    input.availableOpenCodeModelSlugs.includes(continuation.expectedModelSlug),
  );
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isContinuation(value: unknown): value is LocalModelSetupContinuation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.threadId === "string" &&
    candidate.threadId.length > 0 &&
    typeof candidate.jobId === "string" &&
    candidate.jobId.length > 0 &&
    typeof candidate.expectedModelSlug === "string" &&
    candidate.expectedModelSlug.length > 0 &&
    typeof candidate.draftFingerprint === "string" &&
    candidate.draftFingerprint.length > 0 &&
    (candidate.state === "waiting" ||
      candidate.state === "ready" ||
      candidate.state === "dispatching") &&
    typeof candidate.createdAt === "number" &&
    Number.isFinite(candidate.createdAt)
  );
}

export function createLocalModelSetupContinuationStore(
  options: {
    readonly storage?: StorageLike | null;
    readonly now?: () => number;
  } = {},
) {
  const storage = options.storage ?? null;
  const now = options.now ?? Date.now;
  const listeners = new Set<() => void>();
  let hydrated = false;
  let current: LocalModelSetupContinuation | null = null;

  const persist = () => {
    if (!storage) return;
    if (current) {
      storage.setItem(STORAGE_KEY, JSON.stringify(current));
    } else {
      storage.removeItem(STORAGE_KEY);
    }
  };

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const hydrate = () => {
    if (hydrated) return;
    hydrated = true;
    if (!storage) return;
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as unknown;
      if (isContinuation(parsed) && now() - parsed.createdAt <= MAX_CONTINUATION_AGE_MS) {
        current = parsed;
        return;
      }
    } catch {
      // Invalid persisted setup state is discarded below.
    }
    storage.removeItem(STORAGE_KEY);
  };

  const set = (next: LocalModelSetupContinuation | null) => {
    hydrate();
    current = next;
    persist();
    emit();
  };

  return {
    getSnapshot(): LocalModelSetupContinuation | null {
      hydrate();
      return current;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    begin(input: {
      readonly threadId: string;
      readonly jobId: string;
      readonly expectedModelSlug: string;
      readonly draftFingerprint: string;
    }) {
      set({ ...input, state: "waiting", createdAt: now() });
    },
    markReady(jobId: string, expectedModelSlug?: string): boolean {
      hydrate();
      if (!current || current.jobId !== jobId) return false;
      const nextExpectedModelSlug = expectedModelSlug?.trim() || current.expectedModelSlug;
      if (current.state !== "ready" || current.expectedModelSlug !== nextExpectedModelSlug) {
        set({
          ...current,
          expectedModelSlug: nextExpectedModelSlug,
          state: "ready",
        });
      }
      return true;
    },
    claimDispatch(input: {
      readonly threadId: string;
      readonly expectedModelSlug: string;
      readonly draftFingerprint: string;
    }) {
      hydrate();
      if (
        !current ||
        current.state !== "ready" ||
        current.threadId !== input.threadId ||
        current.expectedModelSlug !== input.expectedModelSlug ||
        current.draftFingerprint !== input.draftFingerprint
      ) {
        return null;
      }
      const claimed = current;
      set({ ...current, state: "dispatching" });
      return claimed;
    },
    cancelIfDraftChanged(input: { readonly threadId: string; readonly draftFingerprint: string }) {
      hydrate();
      if (
        !current ||
        current.threadId !== input.threadId ||
        current.state === "dispatching" ||
        current.draftFingerprint === input.draftFingerprint
      ) {
        return false;
      }
      set(null);
      return true;
    },
    resetDispatch(jobId: string): boolean {
      hydrate();
      if (!current || current.jobId !== jobId || current.state !== "dispatching") return false;
      set({ ...current, state: "ready" });
      return true;
    },
    complete(jobId: string): boolean {
      hydrate();
      if (!current || current.jobId !== jobId) return false;
      set(null);
      return true;
    },
    clear() {
      set(null);
    },
  };
}

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const localModelSetupContinuationStore = createLocalModelSetupContinuationStore({
  storage: browserStorage(),
});

export function useLocalModelSetupContinuation(): LocalModelSetupContinuation | null {
  return useSyncExternalStore(
    localModelSetupContinuationStore.subscribe,
    localModelSetupContinuationStore.getSnapshot,
    () => null,
  );
}
