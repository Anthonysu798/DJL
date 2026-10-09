/**
 * Executes chat runs inside the API process, detached from the HTTP request
 * that created them: a client disconnect never stops a reply. One model call
 * per run through GatewayService.completeStep, so credits are reserved and
 * settled like any gateway request. Text streams to the run log; the reply's
 * parts, the usage, and the final status are persisted when it ends. A cancel
 * (runs.cancel_requested_at) is noticed between chunks.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { ChatMessage, ContentPart } from "@djl/providers";
import type { CloudMessagePart, CloudRunError, CloudUsageTrailer } from "@synara/contracts/cloud";

import { appendSearchText, textOf } from "../chat/ChatService.ts";
import { branchTo } from "../chat/tree.ts";
import { DOWNLOAD_URL_SECONDS } from "../files/FileService.ts";
import type { GatewayService, RequestFacts } from "../gateway/GatewayService.ts";
import { ApiError } from "../http/errors.ts";
import type { BlobStore } from "../sync/BlobStore.ts";
import type { RunLog } from "./RunLog.ts";
import type { RunRow } from "./wire.ts";

/** Cheap model used to title a conversation after its first reply. */
export const TITLE_MODEL = "text.fast";
const TITLE_PROMPT =
  "Write a short title (at most six words) for a conversation that starts with the user's message below. Reply with the title only.";

export interface ChatRunnerDeps {
  readonly db: DjlDatabase;
  readonly gateway: Pick<GatewayService, "completeStep">;
  readonly log: RunLog;
  readonly blobs: BlobStore;
  /** How often to look for a cancel request while streaming. */
  readonly cancelPollMs?: number;
}

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

export class ChatRunner {
  private readonly active = new Map<
    string,
    { readonly controller: AbortController; readonly done: Promise<void> }
  >();

  constructor(private readonly deps: ChatRunnerDeps) {}

  /** Starts the run unless it is already running here or is no longer queued. */
  start(runId: string, facts: RequestFacts): void {
    if (this.active.has(runId)) return;
    const controller = new AbortController();
    const done = this.execute(runId, facts, controller.signal)
      .catch((error) => logError("chat run failed", runId, error))
      .finally(() => this.active.delete(runId));
    this.active.set(runId, { controller, done });
  }

  /** Resolves when every run started here has finished. */
  async idle(): Promise<void> {
    await Promise.all(Array.from(this.active.values(), (a) => a.done));
  }

  /** Shutdown: stop every run (each settles what it used and fails as `interrupted`). */
  async stop(): Promise<void> {
    for (const a of this.active.values()) a.controller.abort();
    await this.idle();
  }

  private async execute(runId: string, facts: RequestFacts, signal: AbortSignal): Promise<void> {
    const { db } = this.deps;
    // Claim the run; a cancelled or already-started run is left alone.
    const [run] = await db
      .update(schema.runs)
      .set({ status: "running", startedAt: new Date() })
      .where(
        and(
          eq(schema.runs.id, runId),
          eq(schema.runs.status, "queued"),
          eq(schema.runs.mode, "chat"),
        ),
      )
      .returning();
    if (!run) return;
    const log = this.deps.log.writer(runId, run.lastSeq);
    await log.append("status", { status: "running", error: null });

    let text = "";
    let usage: CloudUsageTrailer | null = null;
    let error: CloudRunError | null = null;
    let cancelled = false;
    try {
      const step = await this.deps.gateway.completeStep(
        facts,
        { model: run.model, messages: await this.history(run) },
        { signal },
      );
      const pollMs = this.deps.cancelPollMs ?? 250;
      let checkedAt = Date.now();
      for await (const chunk of step.chunks) {
        const delta = chunk.choices[0].delta.content;
        if (delta) {
          text += delta;
          await log.append("text.delta", { messageId: run.messageId, text: delta });
        }
        if (Date.now() - checkedAt >= pollMs) {
          checkedAt = Date.now();
          if (await this.cancelRequested(runId)) {
            cancelled = true;
            break; // ends the step; the gateway settles what was used
          }
        }
      }
      ({ usage, error } = await step.result);
    } catch (e) {
      if (!(e instanceof ApiError)) logError("chat run error", runId, e);
      error =
        e instanceof ApiError
          ? { code: e.code, message: e.message }
          : { code: "internal", message: "The reply failed." };
    }
    if (signal.aborted && !cancelled)
      error = { code: "interrupted", message: "The reply was interrupted. Try again." };
    const status = cancelled ? "cancelled" : error ? "failed" : "succeeded";

    const parts: CloudMessagePart[] = text ? [{ type: "text", text }] : [];
    await db.update(schema.messages).set({ parts }).where(eq(schema.messages.id, run.messageId));
    if (usage) await log.append("usage", usage);
    // The terminal event goes out before the row changes, so a reader that
    // sees a finished run has already been sent every event.
    await log.append("status", { status, error: status === "failed" ? error : null });
    await db
      .update(schema.runs)
      .set({
        status,
        error: status === "failed" ? error : null,
        steps: 1,
        spentMicro: usage ? BigInt(usage.settled) : 0n,
        finishedAt: new Date(),
      })
      .where(eq(schema.runs.id, runId));
    await db
      .update(schema.conversations)
      .set({ lastMessageAt: new Date(), searchText: appendSearchText(text) })
      .where(eq(schema.conversations.id, run.conversationId));
    if (status === "succeeded") await this.titleIfUntitled(facts, run.conversationId);
  }

  private async cancelRequested(runId: string): Promise<boolean> {
    const row = await this.deps.db.query.runs.findFirst({
      columns: { cancelRequestedAt: true },
      where: eq(schema.runs.id, runId),
    });
    return Boolean(row?.cancelRequestedAt);
  }

  /**
   * The branch up to the reply as provider messages. Images go as signed
   * URLs; documents as their extracted text when there is some.
   */
  private async history(run: RunRow): Promise<ChatMessage[]> {
    const { db, blobs } = this.deps;
    const rows = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, run.conversationId));
    const branch = branchTo(rows, run.messageId).slice(0, -1);
    const fileIds = branch.flatMap((m) =>
      (m.parts as CloudMessagePart[]).flatMap((p) => ("fileId" in p ? [p.fileId] : [])),
    );
    const files = fileIds.length
      ? await db
          .select()
          .from(schema.files)
          .where(
            and(
              inArray(schema.files.id, fileIds),
              eq(schema.files.orgId, run.orgId),
              eq(schema.files.status, "ready"),
              isNull(schema.files.deletedAt),
            ),
          )
      : [];
    const byId = new Map(files.map((f) => [f.id, f]));

    const messages: ChatMessage[] = [];
    for (const m of branch) {
      if (m.role === "assistant") {
        const text = textOf(m.parts);
        if (text) messages.push({ role: "assistant", content: text });
        continue;
      }
      const content: ContentPart[] = [];
      for (const part of m.parts as CloudMessagePart[]) {
        if (part.type === "text") content.push({ type: "text", text: part.text });
        if (part.type === "image_ref") {
          const file = byId.get(part.fileId);
          if (file) {
            const { url } = await blobs.presignDownload(file.storageKey, DOWNLOAD_URL_SECONDS);
            content.push({ type: "image_url", image_url: { url } });
          }
        }
        if (part.type === "file_ref") {
          const extracted = byId.get(part.fileId)?.textContent;
          content.push({
            type: "text",
            text: extracted
              ? `File ${part.name}:\n${extracted}`
              : `[Attached file ${part.name} (${part.mimeType}); its text is not available.]`,
          });
        }
      }
      const textOnly = content.every((c) => c.type === "text");
      messages.push({
        role: "user",
        content: textOnly
          ? content.map((c) => (c.type === "text" ? c.text : "")).join("\n\n")
          : content,
      });
    }
    return messages;
  }

  /** Best effort: name an untitled conversation from its first message with a cheap model. */
  private async titleIfUntitled(facts: RequestFacts, conversationId: string): Promise<void> {
    const { db } = this.deps;
    try {
      const conversation = await db.query.conversations.findFirst({
        columns: { title: true },
        where: eq(schema.conversations.id, conversationId),
      });
      if (!conversation || conversation.title) return;
      const first = await db.query.messages.findFirst({
        where: and(
          eq(schema.messages.conversationId, conversationId),
          isNull(schema.messages.parentId),
        ),
        orderBy: asc(schema.messages.createdAt),
      });
      const prompt = first ? textOf(first.parts).slice(0, 2000) : "";
      if (!prompt) return;
      const step = await this.deps.gateway.completeStep(facts, {
        model: TITLE_MODEL,
        max_tokens: 24,
        messages: [
          { role: "system", content: TITLE_PROMPT },
          { role: "user", content: prompt },
        ],
      });
      let raw = "";
      for await (const chunk of step.chunks) raw += chunk.choices[0].delta.content ?? "";
      await step.result;
      const title = (raw.trim().split("\n")[0] ?? "")
        .replace(/^["'“”]+|["'“”.]+$/g, "")
        .trim()
        .slice(0, 80);
      if (!title) return;
      await db
        .update(schema.conversations)
        .set({ title })
        .where(
          and(eq(schema.conversations.id, conversationId), isNull(schema.conversations.title)),
        );
    } catch (error) {
      logError("conversation title failed", conversationId, error);
    }
  }
}
