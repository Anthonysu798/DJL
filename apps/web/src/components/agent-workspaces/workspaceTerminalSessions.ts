import type { TerminalEvent, TerminalOpenInput } from "@synara/contracts";
import type { AgentAccountProfile, AgentWorkspace } from "~/agentWorkspaceStore";
import { ensureNativeApi, readNativeApi } from "~/nativeApi";
import { addWsTransportStateListener } from "~/wsTransportEvents";
import type { TerminalRuntimeCallbacks } from "../terminal/terminalRuntimeTypes";
import { terminalEventDispatcher } from "../terminal/terminalEventDispatcher";

export interface WorkspaceSessionState {
  status: "connecting" | "ready" | "error";
  exited: boolean;
  busy: boolean;
}
export interface WorkspaceSession {
  input: TerminalOpenInput;
  state: WorkspaceSessionState;
  listeners: Set<(state: WorkspaceSessionState) => void>;
  ready: Promise<void>;
  resolveReady: () => void;
  opening: boolean;
  headlessQueries: boolean;
  cancelled: boolean;
  unsubscribe: () => void;
  disposeRenderer?: () => void;
}
const keyOf = (input: Pick<TerminalOpenInput, "threadId" | "terminalId">) =>
  `${input.threadId}::${input.terminalId}`;

// Process ownership is separate from xterm ownership. Never-viewed panes need
// only this record; viewed panes also retain their renderer until explicitly closed.
export class WorkspaceTerminalSessions {
  private sessions = new Map<string, WorkspaceSession>();
  private queue: WorkspaceSession[] = [];
  private openingCount = 0;
  private transportCleanup: (() => void) | null = null;

  ensure(input: TerminalOpenInput): WorkspaceSession {
    const key = keyOf(input);
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const session: WorkspaceSession = {
      input,
      state: { status: "connecting", exited: false, busy: false },
      listeners: new Set(),
      ready: Promise.resolve(),
      resolveReady: () => {},
      opening: false,
      headlessQueries: false,
      cancelled: false,
      unsubscribe: () => {},
    };
    this.sessions.set(key, session);
    session.unsubscribe = terminalEventDispatcher.subscribeMetadata(
      input.threadId,
      input.terminalId ?? "default",
      (event) => this.onEvent(session, event),
    );
    if (!this.transportCleanup)
      this.transportCleanup = addWsTransportStateListener((state) => {
        if (state === "open")
          for (const current of this.sessions.values())
            if (
              !current.cancelled &&
              !current.opening &&
              !current.state.exited &&
              !current.disposeRenderer
            )
              this.schedule(current);
        if (state === "closed" || state === "connecting" || state === "disposed")
          for (const current of this.sessions.values())
            if (!current.state.exited) this.update(current, { status: "connecting" });
      });
    this.schedule(session);
    return session;
  }

  get(threadId: string, terminalId: string): WorkspaceSession | undefined {
    return this.sessions.get(keyOf({ threadId, terminalId }));
  }

  // These callbacks belong to the session, not to a mounted React pane.
  retainRenderer(session: WorkspaceSession, dispose: () => void): TerminalRuntimeCallbacks {
    session.disposeRenderer = dispose;
    return {
      onSessionExited: () => this.update(session, { status: "ready", exited: true, busy: false }),
      onTerminalMetadataChange: () => {},
      onTerminalActivityChange: (_, activity) =>
        this.update(session, { busy: activity.hasRunningSubprocess }),
      onTerminalRuntimeStatusChange: (_, status) =>
        this.update(session, {
          status: status === "replaying" ? "connecting" : status,
        }),
    };
  }

  subscribe(session: WorkspaceSession, listener: (state: WorkspaceSessionState) => void) {
    session.listeners.add(listener);
    listener(session.state);
    return () => {
      session.listeners.delete(listener);
    };
  }

  prioritize(session: WorkspaceSession) {
    const index = this.queue.indexOf(session);
    if (index > 0) {
      this.queue.splice(index, 1);
      this.queue.unshift(session);
    }
  }

  sync(workspaces: AgentWorkspace[], profiles: AgentAccountProfile[]) {
    const accounts = new Map(profiles.map((p) => [p.id, p]));
    for (const workspace of workspaces)
      for (const pane of workspace.panes) {
        const profile = pane.profileId ? accounts.get(pane.profileId) : undefined;
        this.ensure({
          threadId: workspace.id,
          terminalId: pane.id,
          cwd: workspace.cwd,
          ...(profile
            ? {
                agentProfile: {
                  provider: profile.provider,
                  profileId: profile.id,
                  action: pane.action,
                },
              }
            : {}),
        });
      }
  }

  async close(threadId: string, terminalId: string) {
    const key = keyOf({ threadId, terminalId });
    const session = this.sessions.get(key);
    if (session) {
      session.cancelled = true;
      const queued = this.queue.indexOf(session);
      if (queued >= 0) {
        this.queue.splice(queued, 1);
        session.opening = false;
        session.resolveReady();
      }
      await session.ready;
    }
    try {
      await ensureNativeApi().terminal.close({ threadId, terminalId, deleteHistory: true });
    } catch (error) {
      if (session) session.cancelled = false;
      throw error;
    }
    session?.disposeRenderer?.();
    session?.unsubscribe();
    this.sessions.delete(key);
    if (this.sessions.size === 0) {
      this.transportCleanup?.();
      this.transportCleanup = null;
    }
  }

  private update(session: WorkspaceSession, patch: Partial<WorkspaceSessionState>) {
    if (session.cancelled) return;
    const next = { ...session.state, ...patch };
    if (
      next.status === session.state.status &&
      next.exited === session.state.exited &&
      next.busy === session.state.busy
    )
      return;
    session.state = next;
    for (const listener of session.listeners) listener(next);
  }

  private onEvent(session: WorkspaceSession, event: TerminalEvent) {
    if (event.type === "activity") this.update(session, { busy: event.hasRunningSubprocess });
    else if (event.type === "exited")
      this.update(session, { status: "ready", exited: true, busy: false });
    else if (event.type === "error") this.update(session, { status: "error" });
    else if (event.type === "started" || event.type === "restarted")
      this.update(session, { status: "ready", exited: false });
  }

  private schedule(session: WorkspaceSession) {
    if (session.opening || session.cancelled) return;
    session.opening = true;
    session.ready = new Promise((resolve) => {
      session.resolveReady = resolve;
    });
    this.queue.push(session);
    this.drain();
  }

  private drain() {
    while (this.openingCount < 2 && this.queue.length) {
      const session = this.queue.shift()!;
      if (session.cancelled) {
        session.resolveReady();
        continue;
      }
      const api = readNativeApi();
      if (!api) {
        session.opening = false;
        this.update(session, { status: "error" });
        session.resolveReady();
        continue;
      }
      this.openingCount++;
      void api.terminal
        .open({ ...session.input, includeHistory: false, headlessQueries: true })
        .then((snapshot) => {
          session.headlessQueries = snapshot.headlessQueries === true;
          this.update(session, {
            status: snapshot.status === "error" ? "error" : "ready",
            exited: snapshot.status === "exited",
          });
        })
        .catch(() => this.update(session, { status: "error" }))
        .finally(() => {
          session.opening = false;
          this.openingCount--;
          session.resolveReady();
          this.drain();
        });
    }
  }
}

export const workspaceTerminalSessions = new WorkspaceTerminalSessions();
