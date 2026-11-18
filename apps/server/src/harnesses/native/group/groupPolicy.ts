// FILE: groupPolicy.ts
// Purpose: Answers group members' permission requests without asking the user: look-ups are
//          allowed, changes need the group's single write lock, and @all rounds only propose.
// Layer: Native harness (group)

import type {
  CanonicalRequestType,
  GroupMemberProvider,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
} from "@synara/contracts";

import { nativeQuestions } from "../requests";

export type RequestClass = "lookup" | "change" | "input";

export const GROUP_INPUT_REFUSAL = "Ask your question in the group chat instead.";
const DEFAULT_WAIT_MS = 10 * 60_000;

const CLAUDE_LOOKUP_TOOLS = new Set(["Read", "Grep", "Glob", "WebFetch", "WebSearch"]);
const ACP_LOOKUP_KINDS = new Set(["read", "search", "fetch", "think"]);
const ACP_PROVIDERS = new Set<GroupMemberProvider>([
  "cursor",
  "grok",
  "kimi",
  "iflow",
  "qwen",
  "codebuddy",
  "gemini",
]);

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

export function classifyRequest(
  provider: GroupMemberProvider,
  type: CanonicalRequestType,
  args: unknown,
): RequestClass {
  if (type === "tool_user_input") return "input";
  if (type === "file_read_approval") return "lookup";
  if (provider === "claudeAgent" && CLAUDE_LOOKUP_TOOLS.has(String(record(args).tool)))
    return "lookup";
  if (
    ACP_PROVIDERS.has(provider) &&
    ACP_LOOKUP_KINDS.has(String(record(record(args).toolCall).kind))
  )
    return "lookup";
  return "change";
}

export interface WriteLock {
  /** Resolves true once `memberId` holds the lock, false if it timed out, was aborted or released. */
  acquire(memberId: string, signal?: AbortSignal): Promise<boolean>;
  /** Releases the lock if held and drops the member from the queue. */
  release(memberId: string): void;
  holder(): string | null;
}

export function createWriteLock(options: { waitMs?: number } = {}): WriteLock {
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  let holder: string | null = null;
  const queue: Array<{ memberId: string; grant: (granted: boolean) => void }> = [];

  const promote = () => {
    if (holder !== null) return;
    const next = queue.shift();
    if (!next) return;
    holder = next.memberId;
    next.grant(true);
  };

  return {
    acquire(memberId, signal) {
      if (holder === null || holder === memberId) {
        holder = memberId;
        return Promise.resolve(true);
      }
      if (signal?.aborted) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const waiter = {
          memberId,
          grant: (granted: boolean) => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            resolve(granted);
          },
        };
        const leave = () => {
          const index = queue.indexOf(waiter);
          if (index !== -1) queue.splice(index, 1);
          waiter.grant(false);
        };
        const onAbort = () => leave();
        const timer = setTimeout(leave, waitMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        queue.push(waiter);
      });
    },
    release(memberId) {
      for (const waiter of queue.filter((entry) => entry.memberId === memberId)) {
        queue.splice(queue.indexOf(waiter), 1);
        waiter.grant(false);
      }
      if (holder === memberId) {
        holder = null;
        promote();
      }
    },
    holder: () => holder,
  };
}

function refuseQuestions(args: unknown): ProviderUserInputAnswers | ProviderApprovalDecision {
  try {
    const questions = nativeQuestions(args);
    // A plain refusal makes some agents abandon the whole turn; an answer lets them carry on.
    return Object.fromEntries(questions.map((question) => [question.id, GROUP_INPUT_REFUSAL]));
  } catch {
    return "decline";
  }
}

export async function decideRequest(input: {
  provider: GroupMemberProvider;
  memberId: string;
  proposeOnly: boolean;
  lock: WriteLock;
  type: CanonicalRequestType;
  args: unknown;
  signal?: AbortSignal;
  onWaiting?: (waiting: boolean) => void;
}): Promise<ProviderApprovalDecision | ProviderUserInputAnswers> {
  const kind = classifyRequest(input.provider, input.type, input.args);
  if (kind === "input") return refuseQuestions(input.args);
  if (kind === "lookup") return "accept";
  if (input.proposeOnly) return "decline";
  const holder = input.lock.holder();
  const mustWait = holder !== null && holder !== input.memberId;
  if (mustWait) input.onWaiting?.(true);
  const granted = await input.lock.acquire(input.memberId, input.signal);
  if (mustWait) input.onWaiting?.(false);
  return granted ? "accept" : "decline";
}
