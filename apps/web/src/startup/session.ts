import { StartupStorage, createStartupDraft } from "./storage";
import type {
  StartupDraft,
  StartupModel,
  StartupShellHandle,
  StartupSnapshot,
  StartupStatus,
  StartupSurface,
} from "./types";

export interface StartupSendIdentity {
  messageId: string;
  commandId: string;
}

export class StartupSession {
  private drafts = new Map<StartupSurface, StartupDraft>();
  private listeners = new Set<() => void>();
  private shell: StartupShellHandle | null = null;
  private revision = 0;
  previewActive = true;
  editedDuringPreview = false;
  navigationTarget: string | null = null;
  status: StartupStatus = "loading";
  constructor(
    readonly storage: StartupStorage,
    public surface: StartupSurface,
    readonly snapshot: StartupSnapshot | null,
  ) {
    this.load(surface);
  }
  private load(surface: StartupSurface): StartupDraft {
    const cached = this.drafts.get(surface);
    if (cached) return cached;
    const draft =
      this.storage.readDraft(surface) ?? createStartupDraft(surface, this.snapshot?.model ?? null);
    if (draft.sendState === "claimed" || draft.sendState === "pending") {
      draft.sendState = "uncertain";
      if (!this.storage.writeDraft(draft)) this.status = "storage-error";
    }
    this.drafts.set(surface, draft);
    return draft;
  }
  get draft(): StartupDraft {
    return this.load(this.surface);
  }
  getVersion = (): number => this.revision;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private notify(): void {
    this.revision += 1;
    this.shell?.update(this.draft, this.status);
    for (const listener of this.listeners) listener();
  }
  private save(next: StartupDraft, required = false): boolean {
    const previousStatus = this.status;
    const saved = this.storage.writeDraft(next);
    if (!saved) this.status = "storage-error";
    else if (this.status === "storage-error") this.status = "loading";
    if (saved || !required) this.drafts.set(next.surface, next);
    if (saved || !required || previousStatus !== this.status) this.notify();
    return saved;
  }
  attachShell(shell: StartupShellHandle): void {
    this.shell?.destroy();
    this.shell = shell;
    shell.update(this.draft, this.status);
  }
  edit(text: string): void {
    const draft = this.draft;
    if (draft.sendState === "pending" || draft.sendState === "claimed" || text === draft.text)
      return;
    if (this.previewActive) this.editedDuringPreview = true;
    this.save({
      ...draft,
      id: draft.sendState === "uncertain" ? crypto.randomUUID() : draft.id,
      text,
      sendState: "editing",
      revision: draft.revision + 1,
      updatedAt: Date.now(),
    });
  }
  setModel(model: StartupModel | null): void {
    const draft = this.draft;
    if (
      draft.sendState === "pending" ||
      draft.sendState === "claimed" ||
      (draft.model?.provider === model?.provider && draft.model?.model === model?.model)
    )
      return;
    this.save({ ...draft, model, revision: draft.revision + 1, updatedAt: Date.now() });
  }
  requestSend(): boolean {
    if (
      !this.draft.text.trim() ||
      !this.draft.model ||
      this.draft.sendState === "pending" ||
      this.draft.sendState === "claimed"
    )
      return false;
    return this.save(
      {
        ...this.draft,
        sendState: "pending",
        revision: this.draft.revision + 1,
        updatedAt: Date.now(),
      },
      true,
    );
  }
  cancelSend(): void {
    if (this.draft.sendState !== "pending") return;
    this.save({
      ...this.draft,
      sendState: "editing",
      revision: this.draft.revision + 1,
      updatedAt: Date.now(),
    });
  }
  bindThread(threadId: string): boolean {
    if (this.draft.threadId && this.draft.threadId !== threadId) return false;
    if (this.draft.threadId !== threadId) this.save({ ...this.draft, threadId });
    return true;
  }
  claimSend(threadId: string): StartupSendIdentity | null {
    if (
      this.status === "storage-error" ||
      this.draft.threadId !== threadId ||
      this.draft.sendState !== "pending" ||
      !this.draft.model ||
      !this.draft.text.trim()
    )
      return null;
    if (!this.save({ ...this.draft, sendState: "claimed", updatedAt: Date.now() }, true))
      return null;
    return { messageId: this.draft.id, commandId: `startup-${this.draft.id}` };
  }
  identityFor(threadId: string, text: string, model?: StartupModel): StartupSendIdentity | null {
    const draft = [...this.drafts.values()].find(
      (candidate) => candidate.threadId === threadId && candidate.text === text,
    );
    if (
      !draft ||
      !text.trim() ||
      (model && (model.provider !== draft.model?.provider || model.model !== draft.model?.model))
    )
      return null;
    if (
      draft.sendState !== "claimed" &&
      !this.save({ ...draft, sendState: "claimed", updatedAt: Date.now() }, true)
    )
      return null;
    return { messageId: draft.id, commandId: `startup-${draft.id}` };
  }
  sendFinished(messageId: string, succeeded: boolean): void {
    const previous = [...this.drafts.values()].find((draft) => draft.id === messageId);
    if (!previous) return;
    if (succeeded) {
      this.storage.removeDraft(previous.surface, previous.id);
      this.drafts.set(previous.surface, {
        ...createStartupDraft(previous.surface, previous.model),
        threadId: previous.threadId,
      });
      this.notify();
    } else this.save({ ...previous, sendState: "uncertain", updatedAt: Date.now() });
  }
  adoptThread(surface: StartupSurface, threadId: string, text: string, model: StartupModel): void {
    if (this.previewActive) return;
    const previous = this.load(surface);
    if (
      previous.threadId !== threadId &&
      (previous.text.length > 0 || previous.sendState !== "editing")
    )
      return;
    this.surface = surface;
    if (previous.threadId !== threadId)
      this.save({ ...createStartupDraft(surface, model), threadId, text });
  }
  setStatus(status: StartupStatus): void {
    if (status !== this.status) {
      this.status = status;
      this.notify();
    }
  }
  navigate(path: string): void {
    this.cancelSend();
    const normalized = path.replace(/\/$/, "") || "/";
    if (normalized === "/" || normalized === "/work" || normalized === "/studio") {
      this.surface = normalized === "/" ? "home" : "work";
      this.load(this.surface);
      this.navigationTarget = null;
    } else
      this.navigationTarget =
        this.draft.text && `/${this.draft.threadId ?? this.draft.id}` === normalized
          ? null
          : normalized;
    this.notify();
  }
  selection(): { start: number; end: number } {
    return (
      this.shell?.selection() ?? { start: this.draft.text.length, end: this.draft.text.length }
    );
  }
  isFocused(): boolean {
    return this.shell?.isFocused() ?? false;
  }
  isComposing(): boolean {
    return this.shell?.isComposing() ?? false;
  }
  finishPreview(): void {
    this.previewActive = false;
    this.shell?.destroy();
    this.shell = null;
    const root = globalThis.document?.getElementById("root");
    if (root) root.inert = false;
    this.notify();
  }
}

let current: StartupSession | null = null;
export function getStartupSession(): StartupSession | null {
  return current;
}
export function setStartupSession(session: StartupSession | null): void {
  current = session;
}
export function getStartupSeed(surface: StartupSurface): string | undefined {
  if (!current?.previewActive || current.navigationTarget || current.surface !== surface)
    return undefined;
  return current.draft.threadId ?? current.draft.id;
}
export function startupNavigationIsCurrent(surface: StartupSurface): boolean {
  return Boolean(
    current?.previewActive && !current.navigationTarget && current.surface === surface,
  );
}
