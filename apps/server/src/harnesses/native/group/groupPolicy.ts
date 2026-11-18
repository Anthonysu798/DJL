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

import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { nativeQuestions } from "../requests";

export type RequestClass = "lookup" | "change" | "input";

export const GROUP_INPUT_REFUSAL = "Ask your question in the group chat instead.";
const DEFAULT_WAIT_MS = 10 * 60_000;

// Web look-ups carry no local path; file look-ups must stay inside the allowed folders.
const CLAUDE_WEB_TOOLS = new Set(["WebFetch", "WebSearch"]);
const CLAUDE_SEARCH_TOOLS = new Set(["Grep", "Glob"]);
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

/** Real path of `path`, following symlinks; a missing file resolves through its folder. */
function realPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(realPath(parent), basename(path));
  }
}

function insideRoots(paths: readonly string[], roots: readonly string[]): boolean {
  const cwd = roots[0];
  if (!cwd || paths.length === 0) return false;
  const realRoots = roots.map(realPath);
  return paths.every((path) => {
    const target = realPath(resolve(cwd, path));
    return realRoots.some((rootPath) => {
      const rel = relative(rootPath, target);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    });
  });
}

const stringField = (value: Record<string, unknown>, key: string): string[] => {
  const field = value[key];
  return typeof field === "string" && field ? [field] : [];
};

const ACP_PATH_FIELDS = ["path", "dir_path", "file_path", "absolute_path"];

function patternLeavesFolder(pattern: string): boolean {
  return isAbsolute(pattern) || pattern.startsWith("~") || pattern.split(/[\\/]/).includes("..");
}

/** Local paths a look-up would touch, null for a web look-up, or "not-lookup". */
function lookupPaths(
  provider: GroupMemberProvider,
  type: CanonicalRequestType,
  args: unknown,
): string[] | null | "not-lookup" {
  const request = record(args);
  if (provider === "claudeAgent") {
    const tool = String(request.tool);
    const input = record(request.input);
    if (CLAUDE_WEB_TOOLS.has(tool)) return null;
    if (CLAUDE_SEARCH_TOOLS.has(tool)) {
      // Glob's pattern and Grep's glob are paths too: one that leaves the folder is not checked.
      const patterns = [
        ...(tool === "Glob" ? stringField(input, "pattern") : []),
        ...stringField(input, "glob"),
      ];
      if (patterns.some(patternLeavesFolder)) return [];
      const path = stringField(input, "path");
      // Claude's Grep and Glob search the working folder when no path is given.
      return path.length > 0 ? path : ["."];
    }
    if (tool === "Read" || type === "file_read_approval")
      return [...stringField(input, "file_path"), ...stringField(input, "notebook_path")];
    return "not-lookup";
  }
  if (ACP_PROVIDERS.has(provider)) {
    const toolCall = record(request.toolCall);
    const kind = String(toolCall.kind);
    const rawInput = record(toolCall.rawInput);
    const locations = [
      ...(Array.isArray(toolCall.locations)
        ? toolCall.locations.flatMap((location) => stringField(record(location), "path"))
        : []),
      ...ACP_PATH_FIELDS.flatMap((field) => stringField(rawInput, field)),
      ...(Array.isArray(rawInput.paths)
        ? rawInput.paths.filter((path): path is string => typeof path === "string" && !!path)
        : []),
    ];
    if (kind === "fetch") return null;
    // An empty list means the touched paths are unknown, which is not a look-up.
    if (kind === "search" || kind === "read" || type === "file_read_approval") return locations;
    return "not-lookup";
  }
  if (type === "file_read_approval")
    return [...stringField(request, "path"), ...stringField(record(request.input), "path")];
  return "not-lookup";
}

/**
 * `roots` are the folders an agent may read without asking; the first is its working folder.
 * A read that leaves them (symlinks followed), or names no path, counts as a change.
 */
export function classifyRequest(
  provider: GroupMemberProvider,
  type: CanonicalRequestType,
  args: unknown,
  roots: readonly string[],
): RequestClass {
  if (type === "tool_user_input") return "input";
  const paths = lookupPaths(provider, type, args);
  if (paths === "not-lookup") return "change";
  if (paths === null) return "lookup";
  return insideRoots(paths, roots) ? "lookup" : "change";
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
  /** Folders the member may read without asking; the first is its working folder. */
  roots: readonly string[];
  type: CanonicalRequestType;
  args: unknown;
  signal?: AbortSignal;
  onWaiting?: (waiting: boolean) => void;
}): Promise<ProviderApprovalDecision | ProviderUserInputAnswers> {
  const kind = classifyRequest(input.provider, input.type, input.args, input.roots);
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
