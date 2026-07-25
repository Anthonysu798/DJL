export interface ManagedBrowserAnnotationRuntime {
  initialize(): Promise<void>;
  dispose(): Promise<void>;
}

export async function transitionAnnotationMode(input: {
  enabled: boolean;
  setDesired: (enabled: boolean) => void;
  command: () => Promise<void>;
  invalidate: () => Promise<void>;
}): Promise<void> {
  input.setDesired(input.enabled);
  if (input.enabled) {
    try {
      await input.command();
    } catch (error) {
      input.setDesired(false);
      await input.invalidate().catch(() => undefined);
      throw error;
    }
    return;
  }

  let commandOutcome: { ok: true } | { ok: false; error: unknown };
  try {
    await input.command();
    commandOutcome = { ok: true };
  } catch (error) {
    commandOutcome = { ok: false, error };
  }
  try {
    await input.invalidate();
  } catch (error) {
    if (commandOutcome.ok) throw error;
  }
  if (!commandOutcome.ok) throw commandOutcome.error;
}

export async function reconcileAnnotationRuntimeAfterNavigationBoundary(input: {
  isEnabled: () => boolean;
  invalidate: () => Promise<void>;
  onReady: () => void;
}): Promise<void> {
  if (!input.isEnabled()) return;
  await input.invalidate();
  if (input.isEnabled()) input.onReady();
}

export function createAnnotationNavigationReconciler(input: {
  isEnabled: () => boolean;
  invalidate: () => Promise<void>;
  onReady: () => void;
  onError: (error: unknown) => void;
}): (navigationRevision: number) => void {
  let activeRevision: number | null = null;
  let pendingRevision: number | null = null;
  let completedRevision: number | null = null;

  const run = (navigationRevision: number) => {
    activeRevision = navigationRevision;
    void reconcileAnnotationRuntimeAfterNavigationBoundary(input)
      .catch(input.onError)
      .finally(() => {
        completedRevision = navigationRevision;
        activeRevision = null;
        const nextRevision = pendingRevision;
        pendingRevision = null;
        if (nextRevision !== null && nextRevision !== completedRevision) run(nextRevision);
      });
  };

  return (navigationRevision) => {
    if (navigationRevision === activeRevision || navigationRevision === pendingRevision) return;
    if (activeRevision !== null) {
      pendingRevision = navigationRevision;
      return;
    }
    if (navigationRevision !== completedRevision) run(navigationRevision);
  };
}

export function handleAnnotationInPageNavigation(input: {
  isMainFrame: boolean;
  reconcile: () => void;
  syncState: () => void;
}): void {
  if (input.isMainFrame) input.reconcile();
  input.syncState();
}

interface RuntimeEntry<Runtime> {
  runtime: Runtime;
  initialization: Promise<void>;
  ready: Promise<Runtime>;
  invalidated: boolean;
}

/** Prevents isolated-world runtime initialization and disposal from overlapping for one tab. */
export class BrowserAnnotationRuntimePool<
  Runtime extends ManagedBrowserAnnotationRuntime = ManagedBrowserAnnotationRuntime,
> {
  private readonly entries = new Map<string, RuntimeEntry<Runtime>>();
  private readonly pendingDisposals = new Map<string, Promise<void>>();

  get(key: string): Runtime | undefined {
    return this.entries.get(key)?.runtime;
  }

  async ensure(key: string, create: () => Runtime): Promise<Runtime> {
    await this.pendingDisposals.get(key)?.catch(() => undefined);
    const existing = this.entries.get(key);
    if (existing) return existing.ready;

    const runtime = create();
    const entry = {} as RuntimeEntry<Runtime>;
    entry.runtime = runtime;
    entry.invalidated = false;
    entry.initialization = Promise.resolve().then(() => runtime.initialize());
    entry.ready = entry.initialization.then(
      () => {
        if (entry.invalidated || this.entries.get(key) !== entry) {
          throw new Error("Browser annotation runtime was invalidated during initialization.");
        }
        return runtime;
      },
      async (error: unknown) => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        await this.beginDisposal(key, runtime);
        throw error;
      },
    );
    this.entries.set(key, entry);
    return entry.ready;
  }

  invalidate(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return this.pendingDisposals.get(key) ?? Promise.resolve();
    this.entries.delete(key);
    entry.invalidated = true;
    return this.beginDisposal(key, entry.runtime, entry.initialization);
  }

  private beginDisposal(
    key: string,
    runtime: Runtime,
    after: Promise<unknown> = Promise.resolve(),
  ): Promise<void> {
    const previous = this.pendingDisposals.get(key);
    const disposal = Promise.all([
      previous?.catch(() => undefined) ?? Promise.resolve(),
      after.catch(() => undefined),
    ])
      .then(() => runtime.dispose())
      .finally(() => {
        if (this.pendingDisposals.get(key) === disposal) this.pendingDisposals.delete(key);
      });
    this.pendingDisposals.set(key, disposal);
    return disposal;
  }
}
