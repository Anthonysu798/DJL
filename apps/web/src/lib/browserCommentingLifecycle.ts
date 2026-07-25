export type BrowserCommentingCommand = (tabId: string, enabled: boolean) => Promise<void>;

export function resolveBrowserCommentingRuntimeTarget(
  commenting: boolean,
  activeTabId: string | null,
  attachedWebviewTabId: string | null,
): { enabled: boolean; tabId: string | null } {
  const tabId = activeTabId === attachedWebviewTabId ? activeTabId : null;
  return { enabled: commenting && tabId !== null, tabId };
}

/** Serializes native annotation transitions so the latest requested state is applied last. */
export class BrowserCommentingLifecycle {
  private queue: Promise<void> = Promise.resolve();
  private appliedTabId: string | null = null;

  constructor(private readonly command: BrowserCommentingCommand) {}

  get activeTabId(): string | null {
    return this.appliedTabId;
  }

  reconcile(
    enabled: boolean,
    tabId: string | null,
    liveTabIds: ReadonlySet<string>,
  ): Promise<void> {
    const transition = this.queue
      .catch(() => undefined)
      .then(async () => {
        const previousTabId = this.appliedTabId;
        if (previousTabId && (!enabled || previousTabId !== tabId)) {
          if (liveTabIds.has(previousTabId)) await this.command(previousTabId, false);
          if (this.appliedTabId === previousTabId) this.appliedTabId = null;
        }
        if (enabled && tabId) {
          await this.command(tabId, true);
          this.appliedTabId = tabId;
        }
      });
    this.queue = transition;
    return transition;
  }
}
