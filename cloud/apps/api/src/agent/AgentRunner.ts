/**
 * Executes task runs (the worker's `agent.run` jobs): a tool-calling loop in
 * which every model step goes through GatewayService.completeStep, so each
 * step reserves, streams, and settles like any gateway request.
 *
 * Budgets per run: 25 steps, 50 tool calls, 30 minutes, and a credit cap
 * (the run's own, else the `agent.run_credit_cap` setting). Out of credits
 * or over a usage window, the run moves to `blocked_on_usage` and resumes
 * from where it stopped when it is enqueued again.
 *
 * Durability: the run holds a lease (runs.lease_owner / lease_expires_at)
 * renewed by a heartbeat, and every tool call, tool result, and text part is
 * persisted on the reply message as it happens. A worker that crashes loses
 * its lease; the retried job claims the run and replays the parts, so it
 * resumes after the last completed step (a step cut off mid-stream reruns).
 */
import { hostname } from "node:os";

import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { ChatMessage } from "@djl/providers";
import type {
  CloudCitationPart,
  CloudMessagePart,
  CloudRunError,
  CloudRunStatus,
  CloudToolCallPart,
} from "@synara/contracts/cloud";

import type { OrgRole, Principal } from "../auth/guard.ts";
import { appendSearchText, textOf } from "../chat/ChatService.ts";
import type { Settings } from "../config/settings.ts";
import type { FileRow } from "../files/FileService.ts";
import type { GatewayService, RequestFacts, Step } from "../gateway/GatewayService.ts";
import { ApiError } from "../http/errors.ts";
import { SafeFetchError } from "../net/safeFetch.ts";
import type { RunExecutor } from "../runs/RunExecutor.ts";
import type { RunLog, RunWriter } from "../runs/RunLog.ts";
import type { RunRow } from "../runs/wire.ts";
import type { BlobStore } from "../sync/BlobStore.ts";
import {
  FINAL_STEP_NOTE,
  SYSTEM_PROMPT,
  conversationContext,
  replayParts,
  type Replay,
} from "./context.ts";
import type { Sandbox, SandboxSession } from "./sandbox/Sandbox.ts";
import { asUsageBlocked, isUsageExhausted, type ToolBilling } from "./ToolBilling.ts";
import { ToolError, parseArgs, toolDefinition, type AgentTool, type ToolContext } from "./tools.ts";
import { normalizeUrl } from "./webTools.ts";

export interface AgentLimits {
  readonly maxSteps: number;
  readonly maxToolCalls: number;
  readonly maxWallMs: number;
}

export const AGENT_LIMITS: AgentLimits = {
  maxSteps: 25,
  maxToolCalls: 50,
  maxWallMs: 30 * 60_000,
};

export interface AgentRunnerDeps {
  readonly db: DjlDatabase;
  readonly log: RunLog;
  readonly blobs: BlobStore;
  readonly settings: Pick<Settings, "get">;
  readonly gateway: Pick<GatewayService, "completeStep">;
  readonly tools: readonly AgentTool[];
  readonly billing: Pick<ToolBilling, "charge">;
  readonly sandbox: Sandbox;
  readonly notifier?: { readonly runFinished: (run: RunRow) => Promise<unknown> };
  readonly limits?: Partial<AgentLimits>;
  readonly workerId?: string;
  readonly leaseMs?: number;
  readonly cancelPollMs?: number;
  /** Wait before retrying a step the gateway refused for load (429 rate, 503 no model). */
  readonly retryDelayMs?: number;
  readonly now?: () => number;
}

/** The worker is shutting down; the job should be retried so the run resumes. */
export class RunInterruptedError extends Error {
  readonly _tag = "RunInterruptedError";
}

type Outcome =
  | { readonly status: "succeeded" | "cancelled" }
  | { readonly status: "failed" | "blocked_on_usage"; readonly error: CloudRunError };

const fail = (code: string, message: string): Outcome => ({
  status: "failed",
  error: { code, message },
});

/** Mutable state of one execution. */
interface Work {
  readonly run: RunRow;
  readonly facts: RequestFacts;
  readonly log: RunWriter;
  readonly parts: CloudMessagePart[];
  readonly base: readonly ChatMessage[];
  readonly allowedUrls: Set<string>;
  readonly fileIds: ReadonlySet<string>;
  readonly cap: bigint;
  readonly deadline: number;
  spent: bigint;
  steps: number;
  sandbox: SandboxSession | null;
}

const MAX_STEP_RETRIES = 3;

function logError(msg: string, runId: string, error: unknown) {
  console.error(
    JSON.stringify({
      level: "error",
      msg,
      runId,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

export class AgentRunner implements RunExecutor {
  private readonly limits: AgentLimits;
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: AgentRunnerDeps) {
    this.limits = { ...AGENT_LIMITS, ...deps.limits };
    this.workerId =
      deps.workerId ?? `${hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
    this.leaseMs = deps.leaseMs ?? 60_000;
    this.now = deps.now ?? Date.now;
  }

  async execute(runId: string, signal: AbortSignal): Promise<void> {
    const run = await this.claim(runId);
    if (!run) return;
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal.addEventListener("abort", stop, { once: true });
    let leaseLost = false;
    const heartbeat = setInterval(() => {
      this.renew(runId)
        .then((held) => {
          if (!held) {
            leaseLost = true;
            controller.abort();
          }
        })
        .catch((error) => logError("agent lease renew failed", runId, error));
    }, this.leaseMs / 3);

    const log = this.deps.log.writer(runId, run.lastSeq);
    let work: Work | null = null;
    let outcome: Outcome | null = null; // null: interrupted before an outcome
    try {
      await log.append("status", { status: "running", error: null });
      work = await this.prepare(run, log);
      outcome = work
        ? await this.loop(work, controller.signal)
        : fail("forbidden", "This account can no longer run tasks.");
    } catch (error) {
      if (!controller.signal.aborted) outcome = this.classify(runId, error);
    } finally {
      clearInterval(heartbeat);
      signal.removeEventListener("abort", stop);
      await work?.sandbox?.close().catch((error) => logError("sandbox close failed", runId, error));
    }
    if (leaseLost) return void (await log.flush()); // another worker owns the run now
    if (!outcome) {
      await log.flush();
      await this.releaseLease(runId, work);
      throw new RunInterruptedError("interrupted");
    }
    await this.finish(run, log, work, outcome);
  }

  // ---- lease -----------------------------------------------------------------

  /** Queued, blocked, or running under an expired lease → running under ours. */
  private async claim(runId: string): Promise<RunRow | null> {
    const { runs } = schema;
    const [run] = await this.deps.db
      .update(runs)
      .set({
        status: "running",
        error: null,
        leaseOwner: this.workerId,
        leaseExpiresAt: sql`now() + ${`${this.leaseMs} milliseconds`}::interval`,
        // A crashed run keeps its clock; a queued or unblocked run starts a fresh one.
        startedAt: sql`CASE WHEN ${runs.status} = 'running' THEN coalesce(${runs.startedAt}, now()) ELSE now() END`,
      })
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.mode, "task"),
          or(
            inArray(runs.status, ["queued", "blocked_on_usage"]),
            and(
              eq(runs.status, "running"),
              or(isNull(runs.leaseExpiresAt), lt(runs.leaseExpiresAt, sql`now()`)),
            ),
          ),
        ),
      )
      .returning();
    return run ?? null;
  }

  private async renew(runId: string): Promise<boolean> {
    const rows = await this.deps.db
      .update(schema.runs)
      .set({ leaseExpiresAt: sql`now() + ${`${this.leaseMs} milliseconds`}::interval` })
      .where(
        and(
          eq(schema.runs.id, runId),
          eq(schema.runs.leaseOwner, this.workerId),
          eq(schema.runs.status, "running"),
        ),
      )
      .returning({ id: schema.runs.id });
    return rows.length > 0;
  }

  /** Let the retried job claim the run immediately. */
  private async releaseLease(runId: string, work: Work | null): Promise<void> {
    await this.deps.db
      .update(schema.runs)
      .set({
        leaseOwner: null,
        leaseExpiresAt: null,
        ...(work ? { steps: work.steps, spentMicro: work.spent } : {}),
      })
      .where(and(eq(schema.runs.id, runId), eq(schema.runs.leaseOwner, this.workerId)));
  }

  // ---- setup -----------------------------------------------------------------

  /** Everything the loop needs, rebuilt from the database; null when the user may no longer run. */
  private async prepare(run: RunRow, log: RunWriter): Promise<Work | null> {
    const { db, blobs, settings } = this.deps;
    const facts = await this.factsFor(run);
    if (!facts) return null;
    const reply = await db.query.messages.findFirst({
      columns: { parts: true },
      where: eq(schema.messages.id, run.messageId),
    });
    const context = await conversationContext({ db, blobs }, run);
    const cap =
      run.budgetCapMicro ?? BigInt(await settings.get("agent.run_credit_cap")) * 1_000_000n;
    return {
      run,
      facts,
      log,
      parts: [...((reply?.parts ?? []) as CloudMessagePart[])],
      base: [{ role: "system", content: SYSTEM_PROMPT }, ...context.messages],
      allowedUrls: new Set(context.userUrls),
      fileIds: context.fileIds,
      cap,
      deadline: (run.startedAt?.getTime() ?? this.now()) + this.limits.maxWallMs,
      spent: run.spentMicro,
      steps: run.steps,
      sandbox: null,
    };
  }

  /** The run's user acting in its org, as the gateway expects; null if banned or no longer a member. */
  private async factsFor(run: RunRow): Promise<RequestFacts | null> {
    const { db } = this.deps;
    const user = await db.query.user.findFirst({ where: eq(schema.user.id, run.userId) });
    const member = await db.query.member.findFirst({
      where: and(eq(schema.member.userId, run.userId), eq(schema.member.organizationId, run.orgId)),
    });
    if (!user || user.banned || !member) return null;
    const principal: Principal = {
      userId: run.userId,
      email: user.email,
      emailVerified: user.emailVerified,
      banned: false,
      sessionId: `agent:${run.id}`,
      orgId: run.orgId,
      role: member.role as OrgRole,
      personalOrgId: run.orgId,
    };
    return { principal, traceId: `run-${run.id}`, ipHash: null, deviceId: null };
  }

  // ---- loop ------------------------------------------------------------------

  private async loop(w: Work, signal: AbortSignal): Promise<Outcome> {
    const definitions = this.deps.tools.map(toolDefinition);
    for (;;) {
      const replay = replayParts(w.parts);
      for (const url of replay.searchResults.keys()) w.allowedUrls.add(url);
      if (replay.pending.length > 0) {
        const stopped = await this.runTools(w, replay, signal);
        if (stopped) return stopped;
        continue;
      }
      if (await this.cancelRequested(w.run.id)) return { status: "cancelled" };
      if (this.now() > w.deadline) return fail("time_limit", "The task ran out of time.");
      if (w.steps >= this.limits.maxSteps)
        return fail("step_limit", "The task reached its step limit.");
      if (w.spent >= w.cap) return fail("budget_exhausted", "The task reached its spending cap.");

      w.steps += 1;
      await this.deps.db
        .update(schema.runs)
        .set({ steps: w.steps })
        .where(eq(schema.runs.id, w.run.id));
      await w.log.append("step.started", { step: w.steps, maxSteps: this.limits.maxSteps });
      const finalStep =
        w.steps === this.limits.maxSteps || replay.toolCalls >= this.limits.maxToolCalls;
      const messages: ChatMessage[] = [
        ...w.base,
        ...replay.messages,
        ...(finalStep ? [{ role: "user" as const, content: FINAL_STEP_NOTE }] : []),
      ];
      const step = await this.step(w, messages, definitions, signal);
      // Interrupted mid-step: drop the partial step; the resumed run redoes it.
      if (signal.aborted) throw new RunInterruptedError("interrupted");
      if (step.text) await this.addParts(w, [{ type: "text", text: step.text }]);
      if (step.cancelled) return { status: "cancelled" };
      if (step.error)
        return isUsageExhausted(step.error.code)
          ? { status: "blocked_on_usage", error: step.error }
          : { status: "failed", error: step.error };
      if (step.calls.length === 0) return { status: "succeeded" };
      if (finalStep)
        return w.steps === this.limits.maxSteps
          ? fail("step_limit", "The task reached its step limit.")
          : fail("tool_limit", "The task reached its tool call limit.");
      await this.addParts(w, step.calls);
    }
  }

  /** One model call: streams text deltas, collects tool calls, settles, and records usage. */
  private async step(
    w: Work,
    messages: readonly ChatMessage[],
    tools: ReturnType<typeof toolDefinition>[],
    signal: AbortSignal,
  ): Promise<{
    readonly text: string;
    readonly calls: CloudToolCallPart[];
    readonly error: CloudRunError | null;
    readonly cancelled: boolean;
  }> {
    let started: Step | undefined;
    for (let attempt = 0; ; attempt += 1) {
      try {
        started = await this.deps.gateway.completeStep(
          w.facts,
          { model: w.run.model, messages, tools, tool_choice: "auto" },
          { signal, budgetCap: w.cap - w.spent },
        );
        break;
      } catch (error) {
        const retryable =
          error instanceof ApiError &&
          ((error.status === 429 && error.code !== "usage_window_exhausted") ||
            error.code === "no_healthy_model");
        if (!retryable || attempt >= MAX_STEP_RETRIES || signal.aborted) throw error;
        await sleep((this.deps.retryDelayMs ?? 5_000) * (attempt + 1), signal);
      }
    }
    let text = "";
    let cancelled = false;
    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    const pollMs = this.deps.cancelPollMs ?? 500;
    let checkedAt = Date.now();
    for await (const chunk of started!.chunks) {
      const delta = chunk.choices[0].delta;
      if (delta.content) {
        text += delta.content;
        await w.log.append("text.delta", { messageId: w.run.messageId, text: delta.content });
      }
      for (const t of delta.tool_calls ?? []) {
        const call = calls.get(t.index) ?? { id: "", name: "", arguments: "" };
        call.id ||= t.id ?? "";
        call.name += t.function?.name ?? "";
        call.arguments += t.function?.arguments ?? "";
        calls.set(t.index, call);
      }
      if (Date.now() - checkedAt >= pollMs) {
        checkedAt = Date.now();
        if (await this.cancelRequested(w.run.id)) {
          cancelled = true;
          break; // the gateway settles what was used
        }
      }
    }
    const { usage, error } = await started!.result;
    if (usage) {
      w.spent += BigInt(usage.settled);
      await w.log.append("usage", usage);
      await this.deps.db
        .update(schema.runs)
        .set({ spentMicro: w.spent })
        .where(eq(schema.runs.id, w.run.id));
    }
    return {
      text,
      cancelled,
      error: cancelled ? null : error,
      calls: Array.from(calls.values(), (c) => ({
        type: "tool_call" as const,
        toolCallId: c.id || `call_${crypto.randomUUID().slice(0, 12)}`,
        name: c.name || "unknown",
        arguments: c.arguments || "{}",
      })),
    };
  }

  /** Runs the last step's unanswered tool calls in order, persisting each result. */
  private async runTools(w: Work, replay: Replay, signal: AbortSignal): Promise<Outcome | null> {
    for (const call of replay.pending) {
      if (await this.cancelRequested(w.run.id)) return { status: "cancelled" };
      const index = replay.callIndex.get(call.toolCallId)!;
      const tool = this.deps.tools.find((t) => t.name === call.name);
      let content: string;
      let isError = false;
      let extra: readonly CloudMessagePart[] = [];
      try {
        if (!tool) throw new ToolError(`There is no tool named ${call.name}.`);
        if (index.overall > this.limits.maxToolCalls)
          throw new ToolError("This task has used all its tool calls. Answer with what you have.");
        if (index.ofTool > tool.quota)
          throw new ToolError(`${tool.name} can be used at most ${tool.quota} times per task.`);
        const output = await tool.run(
          parseArgs(tool.parameters, call.arguments),
          this.context(w, signal),
        );
        content = output.content;
        isError = output.isError ?? false;
        extra = output.parts ?? [];
      } catch (error) {
        const blocked = asUsageBlocked(error);
        if (blocked)
          return {
            status: "blocked_on_usage",
            error: { code: blocked.code, message: blocked.message },
          };
        if (signal.aborted) throw new RunInterruptedError("interrupted"); // the call stays pending
        if (
          !(
            error instanceof ToolError ||
            error instanceof SafeFetchError ||
            error instanceof ApiError
          )
        )
          logError("agent tool failed", w.run.id, error);
        content =
          error instanceof ToolError || error instanceof SafeFetchError || error instanceof ApiError
            ? error.message
            : "The tool failed.";
        isError = true;
      }
      await this.addParts(w, [
        { type: "tool_result", toolCallId: call.toolCallId, name: call.name, content, isError },
        ...extra,
      ]);
      await this.deps.db
        .update(schema.runs)
        .set({ toolCalls: index.overall, spentMicro: w.spent })
        .where(eq(schema.runs.id, w.run.id));
    }
    return null;
  }

  private context(w: Work, signal: AbortSignal): ToolContext {
    const { db, billing, sandbox } = this.deps;
    return {
      run: w.run,
      facts: w.facts,
      signal,
      allowedUrls: w.allowedUrls,
      file: async (fileId): Promise<FileRow | null> => {
        const own = w.parts.some((p) => p.type === "image_ref" && p.fileId === fileId);
        if (!own && !w.fileIds.has(fileId)) return null;
        const row = await db.query.files.findFirst({
          where: and(
            eq(schema.files.id, fileId),
            eq(schema.files.orgId, w.run.orgId),
            eq(schema.files.userId, w.run.userId),
            eq(schema.files.status, "ready"),
            isNull(schema.files.deletedAt),
          ),
        });
        return row ?? null;
      },
      charge: async (tool, maxUnits, run) => {
        const { value, cost } = await billing.charge(w.facts, tool, maxUnits, run);
        w.spent += cost;
        return value;
      },
      sandbox: async () => (w.sandbox ??= await sandbox.open(w.run.id)),
    };
  }

  /** Appends parts to the reply (durably, first) and announces the non-text ones. */
  private async addParts(w: Work, parts: readonly CloudMessagePart[]): Promise<void> {
    w.parts.push(...parts);
    await this.deps.db
      .update(schema.messages)
      .set({ parts: w.parts })
      .where(eq(schema.messages.id, w.run.messageId));
    for (const part of parts)
      if (part.type !== "text")
        await w.log.append("message.part", { messageId: w.run.messageId, part });
  }

  private async cancelRequested(runId: string): Promise<boolean> {
    const row = await this.deps.db.query.runs.findFirst({
      columns: { cancelRequestedAt: true },
      where: eq(schema.runs.id, runId),
    });
    return Boolean(row?.cancelRequestedAt);
  }

  private classify(runId: string, error: unknown): Outcome {
    const blocked = asUsageBlocked(error);
    if (blocked)
      return {
        status: "blocked_on_usage",
        error: { code: blocked.code, message: blocked.message },
      };
    if (error instanceof ApiError) return fail(error.code, error.message);
    logError("agent run error", runId, error);
    return fail("internal", "The task failed.");
  }

  // ---- end -------------------------------------------------------------------

  /** Sources for the reply: pages read, then search results the answer links to. */
  private citations(w: Work): CloudCitationPart[] {
    const replay = replayParts(w.parts);
    const text = textOf(w.parts);
    const linked = Array.from(replay.searchResults.keys()).filter((url) => text.includes(url));
    const urls = [...new Set([...replay.pagesRead, ...linked])].slice(0, 10);
    return urls.map((url) => ({
      type: "citation",
      url,
      title: replay.searchResults.get(normalizeUrl(url) ?? url) ?? null,
    }));
  }

  private async finish(
    run: RunRow,
    log: RunWriter,
    w: Work | null,
    outcome: Outcome,
  ): Promise<void> {
    const { db } = this.deps;
    if (w && outcome.status === "succeeded") await this.addParts(w, this.citations(w));
    const status: CloudRunStatus = outcome.status;
    const error = "error" in outcome ? outcome.error : null;
    const terminal = status !== "blocked_on_usage";
    // The status event goes out before the row changes, so a reader that sees
    // the run end has already been sent every event.
    await log.append("status", { status, error });
    await log.flush();
    const [updated] = await db
      .update(schema.runs)
      .set({
        status,
        error,
        leaseOwner: null,
        leaseExpiresAt: null,
        ...(w ? { steps: w.steps, spentMicro: w.spent } : {}),
        ...(terminal ? { finishedAt: new Date() } : {}),
      })
      .where(and(eq(schema.runs.id, run.id), eq(schema.runs.leaseOwner, this.workerId)))
      .returning();
    if (!updated || !terminal) return;
    const text = w ? textOf(w.parts) : "";
    await db
      .update(schema.conversations)
      .set({ lastMessageAt: new Date(), searchText: appendSearchText(text) })
      .where(eq(schema.conversations.id, run.conversationId));
    await this.deps.notifier
      ?.runFinished(updated)
      .catch((e: unknown) => logError("run notification failed", run.id, e));
  }
}
