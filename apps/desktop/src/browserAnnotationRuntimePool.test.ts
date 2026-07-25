import { describe, expect, it, vi } from "vitest";

import {
  BrowserAnnotationRuntimePool,
  createAnnotationNavigationReconciler,
  handleAnnotationInPageNavigation,
  reconcileAnnotationRuntimeAfterNavigationBoundary,
  transitionAnnotationMode,
  type ManagedBrowserAnnotationRuntime,
} from "./browserAnnotationRuntimePool";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("BrowserAnnotationRuntimePool", () => {
  it("waits for invalidated runtime disposal before immediate replacement", async () => {
    const disposing = deferred();
    const first = {
      initialize: vi.fn(async () => undefined),
      dispose: vi.fn(() => disposing.promise),
    };
    const second = {
      initialize: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const pool = new BrowserAnnotationRuntimePool<typeof first>();
    await pool.ensure("thread:tab", () => first);
    const invalidation = pool.invalidate("thread:tab");
    const replacement = pool.ensure("thread:tab", () => second);
    await Promise.resolve();
    expect(second.initialize).not.toHaveBeenCalled();
    disposing.resolve();
    await invalidation;
    await expect(replacement).resolves.toBe(second);
    expect(second.initialize).toHaveBeenCalledOnce();
  });

  it("shares an in-flight initialization and rejects every concurrent caller on failure", async () => {
    const initializing = deferred();
    const runtime = {
      initialize: vi.fn(async () => {
        await initializing.promise;
        throw new Error("init failed");
      }),
      dispose: vi.fn(async () => undefined),
    };
    const create = vi.fn(() => runtime);
    const pool = new BrowserAnnotationRuntimePool<ManagedBrowserAnnotationRuntime>();
    const first = pool.ensure("thread:tab", create);
    const second = pool.ensure("thread:tab", create);
    let secondSettled = false;
    void second.then(
      () => {
        secondSettled = true;
      },
      () => {
        secondSettled = true;
      },
    );
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    expect(create).toHaveBeenCalledOnce();
    initializing.resolve();
    await expect(first).rejects.toThrow("init failed");
    await expect(second).rejects.toThrow("init failed");
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("invalidates ownership during initialization before disposing or resolving", async () => {
    const initializing = deferred();
    const calls: string[] = [];
    const runtime = {
      initialize: vi.fn(async () => {
        calls.push("initialize");
        await initializing.promise;
        calls.push("initialized");
      }),
      dispose: vi.fn(async () => void calls.push("dispose")),
    };
    const pool = new BrowserAnnotationRuntimePool<ManagedBrowserAnnotationRuntime>();
    const ensure = pool.ensure("thread:tab", () => runtime);
    await vi.waitFor(() => expect(calls).toEqual(["initialize"]));
    const invalidation = pool.invalidate("thread:tab");
    expect(calls).toEqual(["initialize"]);
    initializing.resolve();
    await expect(ensure).rejects.toThrow("invalidated");
    await invalidation;
    expect(calls).toEqual(["initialize", "initialized", "dispose"]);
  });

  it("removes a poisoned runtime and permits initialization retry", async () => {
    const failed = {
      initialize: vi.fn(async () => {
        throw new Error("init failed");
      }),
      dispose: vi.fn(async () => undefined),
    };
    const retry = {
      initialize: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const pool = new BrowserAnnotationRuntimePool<ManagedBrowserAnnotationRuntime>();
    await expect(pool.ensure("thread:tab", () => failed)).rejects.toThrow("init failed");
    await expect(pool.ensure("thread:tab", () => retry)).resolves.toBe(retry);
    expect(failed.dispose).toHaveBeenCalledOnce();
  });
});

describe("transitionAnnotationMode", () => {
  it("rolls back desired enable state and invalidates after an enable failure", async () => {
    const states: boolean[] = [];
    const invalidate = vi.fn(async () => undefined);
    await expect(
      transitionAnnotationMode({
        enabled: true,
        setDesired: (enabled) => void states.push(enabled),
        command: async () => {
          throw new Error("enable failed");
        },
        invalidate,
      }),
    ).rejects.toThrow("enable failed");
    expect(states).toEqual([true, false]);
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it("always invalidates after a disable command failure without masking it", async () => {
    const invalidate = vi.fn(async () => {
      throw new Error("dispose failed");
    });
    await expect(
      transitionAnnotationMode({
        enabled: false,
        setDesired: vi.fn(),
        command: async () => {
          throw new Error("disable failed");
        },
        invalidate,
      }),
    ).rejects.toThrow("disable failed");
    expect(invalidate).toHaveBeenCalledOnce();
  });
});

describe("browser annotation navigation reconciliation", () => {
  it("signals readiness only after the transient runtime is disposed", async () => {
    const disposing = deferred();
    const calls: string[] = [];
    let enabled = true;
    const reconciliation = reconcileAnnotationRuntimeAfterNavigationBoundary({
      isEnabled: () => enabled,
      invalidate: async () => {
        calls.push("invalidate");
        await disposing.promise;
        calls.push("disposed");
      },
      onReady: () => void calls.push("ready"),
    });
    await vi.waitFor(() => expect(calls).toEqual(["invalidate"]));
    disposing.resolve();
    await reconciliation;
    expect(calls).toEqual(["invalidate", "disposed", "ready"]);
  });

  it("does not re-enable when commenting turns off during disposal", async () => {
    const disposing = deferred();
    let enabled = true;
    const onReady = vi.fn();
    const reconciliation = reconcileAnnotationRuntimeAfterNavigationBoundary({
      isEnabled: () => enabled,
      invalidate: () => disposing.promise,
      onReady,
    });
    enabled = false;
    disposing.resolve();
    await reconciliation;
    expect(onReady).not.toHaveBeenCalled();
  });

  it("reconciles a main-document in-page navigation without a later document-ready event", async () => {
    const calls: string[] = [];
    const onError = vi.fn();
    const reconcileNavigation = createAnnotationNavigationReconciler({
      isEnabled: () => true,
      invalidate: async () => void calls.push("invalidate"),
      onReady: () => void calls.push("ready"),
      onError,
    });

    reconcileNavigation(1);

    await vi.waitFor(() => expect(calls).toEqual(["invalidate", "ready"]));
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports navigation reconciliation failures instead of leaving an unhandled rejection", async () => {
    const failure = new Error("dispose failed");
    const onError = vi.fn();
    const reconcileNavigation = createAnnotationNavigationReconciler({
      isEnabled: () => true,
      invalidate: () => Promise.reject(failure),
      onReady: vi.fn(),
      onError,
    });

    reconcileNavigation(1);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
  });

  it("coalesces an overlapping navigation burst but permits a later navigation", async () => {
    const firstDisposal = deferred();
    const onReady = vi.fn();
    const invalidate = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstDisposal.promise)
      .mockResolvedValue(undefined);
    const reconcileNavigation = createAnnotationNavigationReconciler({
      isEnabled: () => true,
      invalidate,
      onReady,
      onError: vi.fn(),
    });

    reconcileNavigation(1);
    reconcileNavigation(1);
    reconcileNavigation(1);
    expect(invalidate).toHaveBeenCalledOnce();
    firstDisposal.resolve();
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      reconcileNavigation(2);
      expect(invalidate).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(2));
  });

  it("queues a distinct navigation that arrives while the prior reconciliation is pending", async () => {
    const firstDisposal = deferred();
    const onReady = vi.fn();
    const invalidate = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstDisposal.promise)
      .mockResolvedValue(undefined);
    const reconcileNavigation = createAnnotationNavigationReconciler({
      isEnabled: () => true,
      invalidate,
      onReady,
      onError: vi.fn(),
    });

    reconcileNavigation(1);
    reconcileNavigation(1);
    reconcileNavigation(2);
    expect(invalidate).toHaveBeenCalledOnce();
    firstDisposal.resolve();

    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(2));
  });

  it("reconciles only main-frame in-page navigation while syncing every navigation state", () => {
    const reconcile = vi.fn();
    const syncState = vi.fn();

    handleAnnotationInPageNavigation({ isMainFrame: false, reconcile, syncState });
    expect(reconcile).not.toHaveBeenCalled();
    expect(syncState).toHaveBeenCalledOnce();

    handleAnnotationInPageNavigation({ isMainFrame: true, reconcile, syncState });
    expect(reconcile).toHaveBeenCalledOnce();
    expect(syncState).toHaveBeenCalledTimes(2);
  });
});
