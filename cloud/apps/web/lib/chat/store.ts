/**
 * Client state for the chat area: the sidebar list, loaded conversations,
 * live runs, models, and usage. One instance lives in the (chat) layout so
 * a stream keeps running while the user navigates between chats.
 */
import type {
  CloudConversation,
  CloudMeResponse,
  CloudMessage,
  CloudMessagePart,
  CloudModel,
  CloudRunError,
  CloudRunEvent,
  CloudRunMode,
  CloudRunStatus,
  CloudSendMessageInput,
  CloudSendMessageResponse,
  CloudUsageWindowsResponse,
  CloudUserMessagePart,
} from "@synara/contracts/cloud";

import { ChatApiError, type ChatClient, sendMessageIdempotent } from "./client";
import {
  applyEventToParts,
  followRun,
  isTerminal,
  readRunSnapshot,
  writeRunSnapshot,
} from "./runs";
import { buildTree, select, type Selection, visibleBranch } from "./tree";

export interface ConversationView {
  readonly status: "loading" | "ready" | "error";
  readonly conversation: CloudConversation | null;
  readonly messages: readonly CloudMessage[];
  readonly selection: Selection;
}

export interface RunView {
  readonly id: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly mode: CloudRunMode;
  readonly status: CloudRunStatus;
  readonly error: CloudRunError | null;
  readonly step: number | null;
  readonly maxSteps: number | null;
  readonly lastSeq: number;
}

export interface UsageBlock {
  readonly resetsAt: string | null;
}

export interface ChatState {
  readonly listStatus: "idle" | "loading" | "ready" | "error";
  readonly conversations: readonly CloudConversation[];
  readonly archived: readonly CloudConversation[] | null;
  readonly views: Readonly<Record<string, ConversationView>>;
  readonly runs: Readonly<Record<string, RunView>>;
  readonly models: readonly CloudModel[];
  readonly usage: CloudUsageWindowsResponse | null;
  readonly me: CloudMeResponse | null;
  /** Set when the API refused a send with usage_window_exhausted. */
  readonly usageBlock: UsageBlock | null;
}

export interface SendRequest {
  readonly conversationId: string | null;
  readonly parentId: string | null;
  readonly parts: readonly CloudUserMessagePart[];
  readonly model: string;
  readonly mode: CloudRunMode;
  /** Reused on retry so the server never records the message twice. */
  readonly clientMessageId: string;
}

const EMPTY_VIEW: ConversationView = {
  status: "loading",
  conversation: null,
  messages: [],
  selection: {},
};

export const newClientId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const titleFrom = (parts: readonly CloudUserMessagePart[]) => {
  const text = parts.find((p) => p.type === "text");
  const title = text?.type === "text" ? text.text.trim().replace(/\s+/g, " ") : "";
  return title ? title.slice(0, 80) : undefined;
};

export class ChatStore {
  private state: ChatState = {
    listStatus: "idle",
    conversations: [],
    archived: null,
    views: {},
    runs: {},
    models: [],
    usage: null,
    me: null,
    usageBlock: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly followers = new Map<string, AbortController>();
  private readonly snapshotTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private redeemKey: string | null = null;

  constructor(private readonly client: ChatClient) {}

  // --- subscription -----------------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getState = () => this.state;

  private set(patch: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) {
    const next = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l();
  }

  private patchView(id: string, patch: (v: ConversationView) => Partial<ConversationView>) {
    this.set((s) => {
      const view = s.views[id] ?? EMPTY_VIEW;
      return { views: { ...s.views, [id]: { ...view, ...patch(view) } } };
    });
  }

  private upsertConversation(c: CloudConversation) {
    this.set((s) => {
      const inList = (list: readonly CloudConversation[]) => [
        c,
        ...list.filter((x) => x.id !== c.id),
      ];
      const views = s.views[c.id]
        ? { ...s.views, [c.id]: { ...s.views[c.id]!, conversation: c } }
        : s.views;
      return {
        conversations: c.archived
          ? s.conversations.filter((x) => x.id !== c.id)
          : inList(s.conversations),
        archived:
          s.archived === null
            ? null
            : c.archived
              ? inList(s.archived)
              : s.archived.filter((x) => x.id !== c.id),
        views,
      };
    });
  }

  dispose() {
    for (const c of this.followers.values()) c.abort();
    this.followers.clear();
  }

  // --- bootstrapping ------------------------------------------------------------

  async init() {
    this.set({ listStatus: "loading" });
    const [list, models, usage, me] = await Promise.allSettled([
      this.client.listConversations({ archived: false }),
      this.client.listModels(),
      this.client.getUsage(),
      this.client.getMe(),
    ]);
    this.set({
      listStatus: list.status === "fulfilled" ? "ready" : "error",
      conversations: list.status === "fulfilled" ? list.value.conversations : [],
      models: models.status === "fulfilled" ? models.value.models : [],
      usage: usage.status === "fulfilled" ? usage.value : null,
      usageBlock: usage.status === "fulfilled" ? windowExhausted(usage.value) : null,
      me: me.status === "fulfilled" ? me.value : null,
    });
  }

  async refreshList() {
    const { conversations } = await this.client.listConversations({ archived: false });
    this.set({ conversations });
  }

  async loadArchived() {
    const { conversations } = await this.client.listConversations({ archived: true });
    this.set({ archived: conversations });
  }

  async refreshUsage() {
    try {
      const usage = await this.client.getUsage();
      const exhausted = windowExhausted(usage);
      this.set((s) => ({ usage, usageBlock: exhausted ? (s.usageBlock ?? exhausted) : null }));
    } catch {
      /* keep the last known usage */
    }
  }

  // --- conversations --------------------------------------------------------------

  async openConversation(id: string) {
    const existing = this.state.views[id];
    if (existing?.status === "ready") return;
    this.patchView(id, () => ({ status: "loading" }));
    try {
      const detail = await this.client.getConversation(id);
      this.patchView(id, (v) => ({
        status: "ready",
        conversation: detail.conversation,
        // Messages streamed in this tab are newer than the server copy.
        messages: mergeMessages(detail.messages, v.messages),
      }));
    } catch {
      this.patchView(id, () => ({ status: "error" }));
      return;
    }
    await this.resumeRuns(id);
  }

  /** Loads the visible branch's runs and reattaches to unfinished ones, resuming from the last seq seen in this tab. */
  private async resumeRuns(conversationId: string) {
    const view = this.state.views[conversationId];
    if (!view) return;
    const branch = visibleBranch(buildTree(view.messages), view.selection);
    const candidates = branch.filter(
      (m) => m.role === "assistant" && m.runId && !this.followers.has(m.runId),
    );
    for (const message of candidates) {
      const run = await this.client.getRun(message.runId!).then(
        (r) => r.run,
        () => null, // a run we can't look up is shown as stored
      );
      if (!run) continue;
      if (isTerminal(run.status)) {
        writeRunSnapshot(run.id, null);
        // Kept (not followed) so a failed or cut-off reply still says why.
        this.trackRun({
          id: run.id,
          conversationId,
          messageId: run.messageId,
          mode: run.mode,
          status: run.status,
          error: run.error,
          step: null,
          maxSteps: null,
          lastSeq: run.lastSeq,
        });
        continue;
      }
      const snapshot = readRunSnapshot(run.id);
      this.setMessageParts(conversationId, message.id, snapshot?.parts ?? []);
      this.trackRun({
        id: run.id,
        conversationId,
        messageId: run.messageId,
        mode: run.mode,
        status: run.status,
        error: run.error,
        step: snapshot?.step ?? null,
        maxSteps: snapshot?.maxSteps ?? null,
        lastSeq: snapshot?.lastSeq ?? 0,
      });
    }
  }

  async rename(id: string, title: string) {
    this.upsertConversation(await this.client.updateConversation(id, { title }));
  }
  async setPinned(id: string, pinned: boolean) {
    this.upsertConversation(await this.client.updateConversation(id, { pinned }));
  }
  async setArchived(id: string, archived: boolean) {
    this.upsertConversation(await this.client.updateConversation(id, { archived }));
  }
  async remove(id: string) {
    await this.client.deleteConversation(id);
    this.set((s) => {
      const { [id]: _removed, ...views } = s.views;
      return {
        conversations: s.conversations.filter((c) => c.id !== id),
        archived: s.archived?.filter((c) => c.id !== id) ?? null,
        views,
      };
    });
  }

  selectMessage(conversationId: string, message: Pick<CloudMessage, "id" | "parentId">) {
    this.patchView(conversationId, (v) => ({ selection: select(v.selection, message) }));
    void this.resumeRuns(conversationId);
  }

  // --- sending ----------------------------------------------------------------------

  /** Sends a message (creating the conversation first if needed) and starts streaming the reply. Returns the conversation id. */
  async send(request: SendRequest): Promise<string> {
    let conversationId = request.conversationId;
    if (!conversationId) {
      const title = titleFrom(request.parts);
      const created = await this.client.createConversation(title ? { title } : {});
      conversationId = created.id;
      this.upsertConversation(created);
      this.patchView(created.id, () => ({ status: "ready", conversation: created }));
    }
    const input = {
      clientMessageId: request.clientMessageId,
      parentId: request.parentId,
      parts: request.parts,
      model: request.model,
      mode: request.mode,
    } as CloudSendMessageInput;
    const response = await this.guardUsage(() =>
      sendMessageIdempotent(this.client, conversationId, input),
    );
    this.acceptTurn(conversationId, response);
    return conversationId;
  }

  async regenerate(conversationId: string, assistantMessageId: string, model?: string) {
    const response = await this.guardUsage(() =>
      this.client.regenerate(conversationId, assistantMessageId, model ? { model } : {}),
    );
    this.acceptTurn(conversationId, response);
  }

  async cancel(runId: string) {
    const { run } = await this.client.cancelRun(runId);
    this.patchRun(runId, { status: run.status, error: run.error });
    if (isTerminal(run.status)) this.stopFollowing(runId);
  }

  private async guardUsage<T>(call: () => Promise<T>): Promise<T> {
    try {
      const result = await call();
      if (this.state.usageBlock) this.set({ usageBlock: null });
      return result;
    } catch (error) {
      if (error instanceof ChatApiError && error.code === "usage_window_exhausted") {
        this.set({ usageBlock: { resetsAt: error.resetsAt } });
        void this.refreshUsage();
      }
      throw error;
    }
  }

  private acceptTurn(conversationId: string, response: CloudSendMessageResponse) {
    const { message, reply, run } = response;
    this.patchView(conversationId, (v) => ({
      messages: mergeMessages(v.messages, [message, reply]),
      selection: select(select(v.selection, message), reply),
    }));
    this.set((s) => {
      const c = s.conversations.find((x) => x.id === conversationId);
      if (!c) return {};
      const bumped = { ...c, updatedAt: run.createdAt };
      return { conversations: [bumped, ...s.conversations.filter((x) => x.id !== c.id)] };
    });
    this.trackRun({
      id: run.id,
      conversationId,
      messageId: reply.id,
      mode: run.mode,
      status: run.status,
      error: run.error,
      step: null,
      maxSteps: null,
      lastSeq: run.lastSeq,
    });
  }

  // --- runs ---------------------------------------------------------------------------

  private trackRun(run: RunView) {
    this.set((s) => ({ runs: { ...s.runs, [run.id]: run } }));
    if (isTerminal(run.status) || this.followers.has(run.id)) return;
    const controller = new AbortController();
    this.followers.set(run.id, controller);
    void followRun({
      client: this.client,
      runId: run.id,
      after: run.lastSeq,
      signal: controller.signal,
      onEvent: (event) => this.applyEvent(run.conversationId, event),
    })
      .catch((error: unknown) => {
        this.patchRun(run.id, {
          status: "failed",
          error: {
            code: error instanceof ChatApiError ? error.code : "stream_lost",
            message: error instanceof Error ? error.message : "Stream lost",
          },
        });
      })
      .finally(() => {
        if (this.followers.get(run.id) === controller) this.followers.delete(run.id);
      });
  }

  private stopFollowing(runId: string) {
    this.followers.get(runId)?.abort();
    this.followers.delete(runId);
    writeRunSnapshot(runId, null);
  }

  private patchRun(runId: string, patch: Partial<RunView>) {
    this.set((s) => {
      const run = s.runs[runId];
      return run ? { runs: { ...s.runs, [runId]: { ...run, ...patch } } } : {};
    });
  }

  private setMessageParts(
    conversationId: string,
    messageId: string,
    parts: readonly CloudMessagePart[],
  ) {
    this.patchView(conversationId, (v) => ({
      messages: v.messages.map((m) => (m.id === messageId ? { ...m, parts } : m)),
    }));
  }

  private applyEvent(conversationId: string, event: CloudRunEvent) {
    const run = this.state.runs[event.runId];
    if (event.type === "text.delta" || event.type === "message.part") {
      this.patchView(conversationId, (v) => ({
        messages: v.messages.map((m) =>
          m.id === event.payload.messageId
            ? { ...m, parts: applyEventToParts(m.parts, event) as CloudMessagePart[] }
            : m,
        ),
      }));
    }
    const patch: { -readonly [K in keyof RunView]?: RunView[K] } = { lastSeq: event.seq };
    if (event.type === "step.started") {
      patch.step = event.payload.step;
      patch.maxSteps = event.payload.maxSteps;
    }
    if (event.type === "status") {
      patch.status = event.payload.status;
      patch.error = event.payload.error;
    }
    this.patchRun(event.runId, patch);

    if (event.type === "status" && isTerminal(event.payload.status)) {
      writeRunSnapshot(event.runId, null);
      void this.refreshUsage();
      if (!this.state.views[conversationId]?.conversation?.title)
        void this.refreshTitle(conversationId);
      return;
    }
    if (event.type === "status" && event.payload.status === "blocked_on_usage") {
      void this.refreshUsage();
    }
    if (run) this.scheduleSnapshot(conversationId, event.runId);
  }

  private async refreshTitle(conversationId: string) {
    try {
      const detail = await this.client.getConversation(conversationId);
      this.upsertConversation(detail.conversation);
    } catch {
      /* titles are cosmetic */
    }
  }

  private scheduleSnapshot(conversationId: string, runId: string) {
    if (this.snapshotTimers.has(runId)) return;
    this.snapshotTimers.set(
      runId,
      setTimeout(() => {
        this.snapshotTimers.delete(runId);
        const run = this.state.runs[runId];
        const message = this.state.views[conversationId]?.messages.find(
          (m) => m.id === run?.messageId,
        );
        if (!run || !message || isTerminal(run.status)) return;
        writeRunSnapshot(runId, {
          lastSeq: run.lastSeq,
          parts: message.parts,
          step: run.step,
          maxSteps: run.maxSteps,
        });
      }, 250),
    );
  }

  // --- usage ----------------------------------------------------------------------------

  /** Redeems the oldest banked reset. The idempotency key survives a failed attempt so a retry can't spend two banks. */
  async redeemBank() {
    this.redeemKey ??= newClientId();
    const { usage } = await this.client.redeemBank(this.redeemKey);
    this.redeemKey = null;
    this.set({ usage, usageBlock: null });
  }
}

function mergeMessages(
  base: readonly CloudMessage[],
  extra: readonly CloudMessage[],
): CloudMessage[] {
  const byId = new Map(base.map((m) => [m.id, m]));
  for (const m of extra) {
    const prior = byId.get(m.id);
    // Keep whichever copy has more streamed content.
    if (!prior || m.parts.length >= prior.parts.length) byId.set(m.id, m);
  }
  return [...byId.values()];
}

export function windowExhausted(usage: CloudUsageWindowsResponse): UsageBlock | null {
  const { fiveHour, week } = usage.windows;
  if (BigInt(week.remaining) <= 0n && BigInt(week.limit) > 0n) return { resetsAt: week.resetsAt };
  if (BigInt(fiveHour.remaining) <= 0n && BigInt(fiveHour.limit) > 0n)
    return { resetsAt: fiveHour.resetsAt };
  return null;
}
