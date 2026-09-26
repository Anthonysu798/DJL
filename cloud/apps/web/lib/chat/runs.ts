/**
 * Following a run's event log. Events carry a gapless `seq`, so after a drop
 * (network, tab sleep, reload) the client reconnects with `after=<last seq>`
 * and skips anything it has already applied.
 */
import type { CloudMessagePart, CloudRunEvent, CloudRunStatus } from "@synara/contracts/cloud";

import { ChatApiError, type ChatClient } from "./client";

export const TERMINAL_STATUSES: readonly CloudRunStatus[] = ["succeeded", "failed", "cancelled"];
export const isTerminal = (status: CloudRunStatus) => TERMINAL_STATUSES.includes(status);

export interface FollowRunOptions {
  readonly client: Pick<ChatClient, "streamRunEvents" | "getRun">;
  readonly runId: string;
  /** Last seq already applied; 0 to replay from the start. */
  readonly after: number;
  readonly onEvent: (event: CloudRunEvent) => void;
  readonly signal: AbortSignal;
  /** Wait before reconnect attempt n (0-based) after a drop with no progress. */
  readonly backoff?: (attempt: number) => number;
  /** Consecutive failed reconnects before giving up. */
  readonly maxFailures?: number;
}

export interface FollowRunResult {
  readonly lastSeq: number;
  readonly status: CloudRunStatus | null;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** Streams until a terminal status event, reconnecting from the last seq after every drop. Resolves early when aborted. */
export async function followRun(options: FollowRunOptions): Promise<FollowRunResult> {
  const {
    client,
    runId,
    onEvent,
    signal,
    backoff = (n) => Math.min(8000, 500 * 2 ** n),
    maxFailures = 8,
  } = options;
  let lastSeq = options.after;
  let failures = 0;
  while (!signal.aborted) {
    const before = lastSeq;
    try {
      for await (const event of client.streamRunEvents(runId, lastSeq, signal)) {
        if (event.seq <= lastSeq) continue; // already applied before the drop
        lastSeq = event.seq;
        onEvent(event);
        if (event.type === "status" && isTerminal(event.payload.status))
          return { lastSeq, status: event.payload.status };
      }
      // Clean close without a terminal event: the run may have ended before we
      // (re)connected, or the server rotated the connection.
      if (lastSeq === before) {
        const { run } = await client.getRun(runId);
        if (isTerminal(run.status) && run.lastSeq <= lastSeq)
          return { lastSeq, status: run.status };
      }
    } catch (error) {
      if (signal.aborted) break;
      if (error instanceof ChatApiError && error.status >= 400 && error.status < 500) throw error;
    }
    failures = lastSeq > before ? 0 : failures + 1;
    if (failures > maxFailures) throw new Error(`Lost the stream for run ${runId}`);
    if (failures > 0) await sleep(backoff(failures - 1), signal);
  }
  return { lastSeq, status: null };
}

/** Appends one event's content to an assistant message's parts. Returns the same array when nothing changed. */
export function applyEventToParts(
  parts: readonly CloudMessagePart[],
  event: CloudRunEvent,
): readonly CloudMessagePart[] {
  if (event.type === "text.delta") {
    const last = parts[parts.length - 1];
    if (last?.type === "text")
      return [...parts.slice(0, -1), { type: "text", text: last.text + event.payload.text }];
    return [...parts, { type: "text", text: event.payload.text }];
  }
  if (event.type === "message.part") return [...parts, event.payload.part];
  return parts;
}

/** Run progress persisted per tab so a reload resumes with after=<seq> instead of replaying. */
export interface RunSnapshot {
  readonly lastSeq: number;
  readonly parts: readonly CloudMessagePart[];
  readonly step: number | null;
  readonly maxSteps: number | null;
}

const snapshotKey = (runId: string) => `djl.run.${runId}`;

export function readRunSnapshot(runId: string): RunSnapshot | null {
  try {
    const raw = sessionStorage.getItem(snapshotKey(runId));
    return raw ? (JSON.parse(raw) as RunSnapshot) : null;
  } catch {
    return null;
  }
}

export function writeRunSnapshot(runId: string, snapshot: RunSnapshot | null) {
  try {
    if (snapshot) sessionStorage.setItem(snapshotKey(runId), JSON.stringify(snapshot));
    else sessionStorage.removeItem(snapshotKey(runId));
  } catch {
    /* storage full or unavailable: resume falls back to a replay from seq 0 */
  }
}
