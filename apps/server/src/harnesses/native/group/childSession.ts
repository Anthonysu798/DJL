// FILE: childSession.ts
// Purpose: Runs one group member's native CLI and reduces its turn to the final answer plus a
//          short record of the files it changed and the commands it ran.
// Layer: Native harness (group)

import type {
  CanonicalRequestType,
  GroupContextUsage,
  GroupMemberProvider,
  ProviderApprovalDecision,
  ProviderSessionStartInput,
  ProviderUserInputAnswers,
} from "@djl/contracts";

import { extractCodexGeneratedImageReference } from "../../../codexGeneratedImages";
import type { PluginGatewaySession } from "../../../plugins/PluginGateway";
import { nativeApprovalDetail } from "../requests";
import type { NativeDriver, NativeDriverFactory, NativeSink } from "../types";
import { findNewOutputs, withOutputs } from "./groupOutputs";

export type ChildWork = { files: string[]; commands: string[] };
export type ChildReply =
  | { status: "ok"; text: string; work: ChildWork }
  | { status: "empty"; work: ChildWork }
  | { status: "failed"; error: string; work: ChildWork }
  | { status: "stopped"; work: ChildWork };
export type ChildRequestHandler = (
  type: CanonicalRequestType,
  args: unknown,
  signal?: AbortSignal,
) => Promise<ProviderApprovalDecision | ProviderUserInputAnswers>;

/** `restart` is true when the member begins a new message, which replaces what it wrote before. */
export type ChildDraftHandler = (delta: string, restart: boolean) => void;
/** What the member's CLI is doing now, for the live stage. */
export type ChildActivityKind = "reading" | "editing" | "running" | "writing";
export type ChildActivityHandler = (kind: ChildActivityKind, detail: string | null) => void;

export interface ChildSession {
  readonly nativeSessionId: string;
  /** How full the member's context was at its CLI's last report; null until it reports. */
  contextUsage(): GroupContextUsage | null;
  /** When the CLI last reported anything (an event or a request), in epoch milliseconds. */
  lastActivityAt(): number;
  ask(
    prompt: string,
    onRequest: ChildRequestHandler,
    onDraft?: ChildDraftHandler,
    onActivity?: ChildActivityHandler,
  ): Promise<ChildReply>;
  stop(): Promise<void>;
  close(): void;
}

const FILE_REQUESTS = new Set<CanonicalRequestType>([
  "file_change_approval",
  "apply_patch_approval",
]);
const COMMAND_REQUESTS = new Set<CanonicalRequestType>([
  "command_execution_approval",
  "exec_command_approval",
]);
const WORK_LINE_LIMIT = 200;
const ACTIVITY_DETAIL_LIMIT = 80;
// Claude reports these tools as commands, but they only look things up.
const LOOKUP_TOOLS = new Set(["Read", "Grep", "Glob", "LS", "WebFetch", "WebSearch"]);

function requestActivity(
  type: CanonicalRequestType,
  args: unknown,
): { kind: ChildActivityKind; detail: string | null } | null {
  const detail = workLine(nativeApprovalDetail(args)).slice(0, ACTIVITY_DETAIL_LIMIT) || null;
  if (FILE_REQUESTS.has(type)) return { kind: "editing", detail };
  if (type === "file_read_approval") return { kind: "reading", detail };
  if (COMMAND_REQUESTS.has(type)) {
    const tool = (args as { tool?: unknown } | null)?.tool;
    return typeof tool === "string" && LOOKUP_TOOLS.has(tool)
      ? { kind: "reading", detail }
      : { kind: "running", detail };
  }
  return null;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const workLine = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, WORK_LINE_LIMIT);

/** The files or command a completed Codex item records: one line per changed file. */
function codexItemWork(payload: Record<string, unknown>): string[] {
  const data = (payload.data ?? {}) as { command?: unknown; changes?: unknown };
  const lines = Array.isArray(data.changes)
    ? data.changes.map((change) => String((change as { path?: unknown })?.path ?? ""))
    : Array.isArray(data.command)
      ? [data.command.join(" ")]
      : typeof data.command === "string"
        ? [data.command]
        : [String(payload.title ?? payload.detail ?? "")];
  return lines.map(workLine).filter(Boolean);
}

interface Turn {
  readonly texts: Map<string, string>;
  lastItem: string | null;
  readonly work: ChildWork;
  /** Images the member generated outside the folder (Codex keeps them in its own home). */
  readonly images: string[];
  readonly startedAt: number;
  onRequest: ChildRequestHandler;
  onDraft: ChildDraftHandler | undefined;
  onActivity: ChildActivityHandler | undefined;
  settled: boolean;
  resolve: (reply: ChildReply) => void;
}

export async function openChildSession(input: {
  provider: GroupMemberProvider;
  factory: NativeDriverFactory;
  start: ProviderSessionStartInput;
  plugins?: PluginGatewaySession;
}): Promise<ChildSession> {
  const countsCodexItems = input.provider === "codex";
  let turn: Turn | null = null;
  let driver: NativeDriver | null = null;
  let usage: GroupContextUsage | null = null;
  let lastActivity = Date.now();

  const settle = (reply: (work: ChildWork) => ChildReply) => {
    const current = turn;
    if (!current || current.settled) return;
    current.settled = true;
    turn = null;
    current.resolve(reply(current.work));
  };

  const sink: NativeSink = {
    emit: (event) => {
      lastActivity = Date.now();
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      if (event.type === "thread.token-usage.updated") {
        const reported = (payload.usage ?? {}) as { usedTokens?: unknown; maxTokens?: unknown };
        if (typeof reported.usedTokens === "number")
          usage = {
            usedTokens: reported.usedTokens,
            maxTokens: typeof reported.maxTokens === "number" ? reported.maxTokens : null,
          };
        return;
      }
      const current = turn;
      if (!current) return;
      if (
        event.type === "content.delta" &&
        payload.streamKind === "assistant_text" &&
        typeof event.itemId === "string"
      ) {
        const delta = String(payload.delta ?? "");
        current.texts.set(event.itemId, (current.texts.get(event.itemId) ?? "") + delta);
        if (delta) {
          current.onDraft?.(delta, event.itemId !== current.lastItem);
          current.onActivity?.("writing", null);
        }
        current.lastItem = event.itemId;
        return;
      }
      if (countsCodexItems && event.type === "item.completed") {
        if (payload.status === "failed" || payload.status === "declined") return;
        const work = codexItemWork(payload);
        if (payload.itemType === "file_change") current.work.files.push(...work);
        if (payload.itemType === "command_execution") current.work.commands.push(...work);
        const image = extractCodexGeneratedImageReference({
          value: payload.data,
          threadId: driver?.id,
        });
        if (image) current.images.push(image.path);
      }
    },
    request: async (type, args, signal) => {
      lastActivity = Date.now();
      const current = turn;
      if (!current) return "cancel";
      const activity = requestActivity(type, args);
      if (activity) current.onActivity?.(activity.kind, activity.detail);
      const answer = await current.onRequest(type, args, signal);
      const accepted = answer === "accept" || answer === "acceptForSession";
      if (accepted && !countsCodexItems) {
        if (FILE_REQUESTS.has(type)) current.work.files.push(workLine(nativeApprovalDetail(args)));
        if (COMMAND_REQUESTS.has(type))
          current.work.commands.push(workLine(nativeApprovalDetail(args)));
      }
      return answer;
    },
    // A failing member must never fail the group: it becomes this member's failed reply.
    fail: (error) => settle((work) => ({ status: "failed", error: error.message, work })),
  };

  const { sandboxMode: _sandbox, approvalPolicy: _approval, ...start } = input.start;
  driver = await input.factory(
    { ...start, runtimeMode: "approval-required" },
    sink,
    undefined,
    input.plugins,
  );
  const active = driver;

  return {
    nativeSessionId: active.id,
    contextUsage: () => usage,
    lastActivityAt: () => lastActivity,
    ask: (prompt, onRequest, onDraft, onActivity) =>
      new Promise<ChildReply>((resolve) => {
        lastActivity = Date.now();
        turn = {
          texts: new Map(),
          lastItem: null,
          work: { files: [], commands: [] },
          images: [],
          // File times can be a little coarser than the clock.
          startedAt: Date.now() - 1000,
          onRequest,
          onDraft,
          onActivity,
          settled: false,
          resolve,
        };
        const current = turn;
        active.send({ threadId: input.start.threadId, input: prompt }).then(
          async () => {
            if (turn !== current) return;
            const answer = current.lastItem
              ? (current.texts.get(current.lastItem) ?? "").trim()
              : "";
            const created = input.start.cwd
              ? await findNewOutputs(input.start.cwd, current.startedAt)
              : [];
            const text = withOutputs(answer, [...current.images, ...created]);
            settle((work) => (text ? { status: "ok", text, work } : { status: "empty", work }));
          },
          (error: unknown) =>
            settle((work) => ({ status: "failed", error: errorText(error), work })),
        );
      }),
    stop: async () => {
      settle((work) => ({ status: "stopped", work }));
      await active.interrupt().catch(() => undefined);
    },
    close: () => {
      settle((work) => ({ status: "stopped", work }));
      active.close();
    },
  };
}
