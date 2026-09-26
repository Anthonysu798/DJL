/**
 * Conversations and their message trees. Every row is scoped to the caller's
 * org and user; another user's conversation is indistinguishable from a
 * missing one (404).
 *
 * Sending a message stores the user message, an empty assistant reply, and
 * the run that fills it, in one transaction; the same `clientMessageId`
 * returns that original trio. Editing sends a sibling user message (same
 * parent), regenerating adds a sibling reply. Chat runs start in this process
 * detached from the request; task runs go to the worker queue.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type {
  CloudConversationDetailResponse,
  CloudConversationListQuery,
  CloudConversationListResponse,
  CloudConversationMessagesResponse,
  CloudConversationSearchQuery,
  CloudConversationSearchResponse,
  CloudCreateConversationInput,
  CloudMessagePart,
  CloudRegenerateInput,
  CloudRunMode,
  CloudSendMessageInput,
  CloudSendMessageResponse,
  CloudUpdateConversationInput,
  CloudConversation,
} from "@synara/contracts/cloud";

import type { Principal } from "../auth/guard.ts";
import type { FileService } from "../files/FileService.ts";
import type { RequestFacts } from "../gateway/GatewayService.ts";
import { ApiError } from "../http/errors.ts";
import type { TaskQueue } from "../runs/RunExecutor.ts";
import { toRun, type RunRow } from "../runs/wire.ts";
import { branchTo, childrenByParent, newestLeaf } from "./tree.ts";
import { toConversation, toMessage, type ConversationRow, type MessageRow } from "./wire.ts";

const PAGE_SIZE = 30;
/** Message text kept for search per conversation. */
const SEARCH_TEXT_LIMIT = 100_000;

type Tx = Parameters<Parameters<DjlDatabase["transaction"]>[0]>[0];

export interface ChatRunStarter {
  readonly start: (runId: string, facts: RequestFacts) => void;
}

export interface ChatServiceDeps {
  readonly db: DjlDatabase;
  readonly files: Pick<FileService, "assertUsable">;
  readonly runner: ChatRunStarter;
  readonly tasks: TaskQueue;
}

const notFound = () => new ApiError(404, "not_found", "Not found.");

/** Text parts joined, for search and titles. */
export function textOf(parts: readonly unknown[]): string {
  return (parts as CloudMessagePart[])
    .flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("\n");
}

/** SQL that appends `text` to a conversation's bounded search text. */
export const appendSearchText = (text: string) =>
  sql`left(${schema.conversations.searchText} || ' ' || ${text}, ${SEARCH_TEXT_LIMIT})`;

const encodeCursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function decodeCursor<T>(cursor: string, valid: (value: unknown) => value is T): T {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (valid(value)) return value;
  } catch {
    // fall through
  }
  throw new ApiError(400, "bad_cursor", "Invalid cursor.");
}

const isListCursor = (v: unknown): v is [boolean, string, string] =>
  Array.isArray(v) &&
  typeof v[0] === "boolean" &&
  typeof v[1] === "string" &&
  !Number.isNaN(Date.parse(v[1])) &&
  typeof v[2] === "string" &&
  /^[0-9a-f-]{36}$/.test(v[2]);
const isOffset = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export class ChatService {
  constructor(private readonly deps: ChatServiceDeps) {}

  private get db() {
    return this.deps.db;
  }

  /** The caller's conversation, or 404. */
  async own(p: Principal, id: string): Promise<ConversationRow> {
    const row = await this.db.query.conversations.findFirst({
      where: and(
        eq(schema.conversations.id, id),
        eq(schema.conversations.orgId, p.orgId),
        eq(schema.conversations.userId, p.userId),
        isNull(schema.conversations.deletedAt),
      ),
    });
    if (!row) throw notFound();
    return row;
  }

  /** All messages of a conversation the caller already owns. */
  async messages(conversationId: string): Promise<MessageRow[]> {
    return this.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id));
  }

  async list(
    p: Principal,
    query: CloudConversationListQuery,
  ): Promise<typeof CloudConversationListResponse.Encoded> {
    const c = schema.conversations;
    const after = query.cursor ? decodeCursor(query.cursor, isListCursor) : null;
    const rows = await this.db
      .select({ row: c, at: sql<string>`${c.lastMessageAt}::text` })
      .from(c)
      .where(
        and(
          eq(c.orgId, p.orgId),
          eq(c.userId, p.userId),
          isNull(c.deletedAt),
          eq(c.archived, query.archived === "true"),
          after
            ? sql`(${c.pinned}, ${c.lastMessageAt}, ${c.id}) < (${after[0]}, ${after[1]}::timestamptz, ${after[2]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(c.pinned), desc(c.lastMessageAt), desc(c.id))
      .limit(PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      conversations: page.map((r) => toConversation(r.row)),
      nextCursor:
        rows.length > PAGE_SIZE && last
          ? encodeCursor([last.row.pinned, last.at, last.row.id])
          : null,
    };
  }

  async create(
    p: Principal,
    input: CloudCreateConversationInput,
  ): Promise<typeof CloudConversation.Encoded> {
    const [row] = await this.db
      .insert(schema.conversations)
      .values({ orgId: p.orgId, userId: p.userId, title: input.title ?? null })
      .returning();
    return toConversation(row!);
  }

  /** The whole tree; clients pick the branch. */
  async get(p: Principal, id: string): Promise<typeof CloudConversationDetailResponse.Encoded> {
    const conversation = await this.own(p, id);
    const rows = await this.messages(id);
    return { conversation: toConversation(conversation), messages: rows.map(toMessage) };
  }

  async update(
    p: Principal,
    id: string,
    input: CloudUpdateConversationInput,
  ): Promise<typeof CloudConversation.Encoded> {
    const conversation = await this.own(p, id);
    const { branchMessageId, ...fields } = input;
    const changes: Partial<ConversationRow> = { ...fields };
    if (branchMessageId) {
      const rows = await this.messages(id);
      if (!rows.some((m) => m.id === branchMessageId)) throw notFound();
      changes.currentLeafId = newestLeaf(rows, branchMessageId);
    }
    if (Object.keys(changes).length === 0) return toConversation(conversation);
    const [row] = await this.db
      .update(schema.conversations)
      .set(changes)
      .where(eq(schema.conversations.id, id))
      .returning();
    return toConversation(row!);
  }

  /** Soft delete: hidden at once, purged by the worker after 30 days. Active runs are cancelled. */
  async remove(p: Principal, id: string): Promise<void> {
    await this.own(p, id);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.conversations)
        .set({ deletedAt: now })
        .where(eq(schema.conversations.id, id));
      await tx
        .update(schema.runs)
        .set({ cancelRequestedAt: now })
        .where(
          and(
            eq(schema.runs.conversationId, id),
            inArray(schema.runs.status, ["queued", "running", "blocked_on_usage"]),
            isNull(schema.runs.cancelRequestedAt),
          ),
        );
    });
  }

  async search(
    p: Principal,
    query: CloudConversationSearchQuery,
  ): Promise<typeof CloudConversationSearchResponse.Encoded> {
    const c = schema.conversations;
    const offset = query.cursor ? decodeCursor(query.cursor, isOffset) : 0;
    const q = sql`websearch_to_tsquery('simple', ${query.q})`;
    // Written out so the outer "conversations"."id" can't be read as the subquery's own id.
    const newestMatch = sql<string | null>`(
      select m.id from messages m
      where m.conversation_id = "conversations"."id"
        and to_tsvector('simple', jsonb_path_query_array(m.parts, '$[*] ? (@.type == "text").text')::text) @@ ${q}
      order by m.created_at desc limit 1)`;
    const rows = await this.db
      .select({
        row: c,
        messageId: newestMatch,
        snippet: sql<string>`ts_headline('simple', coalesce(${c.title}, '') || ' ' || ${c.searchText}, ${q}, 'StartSel="", StopSel="", MaxWords=20, MinWords=10')`,
      })
      .from(c)
      .where(
        and(
          eq(c.orgId, p.orgId),
          eq(c.userId, p.userId),
          isNull(c.deletedAt),
          sql`${c.search} @@ ${q}`,
        ),
      )
      .orderBy(desc(sql`ts_rank(${c.search}, ${q})`), desc(c.lastMessageAt))
      .limit(PAGE_SIZE + 1)
      .offset(offset);
    return {
      results: rows.slice(0, PAGE_SIZE).map((r) => ({
        conversation: toConversation(r.row),
        messageId: r.messageId,
        snippet: r.snippet,
      })),
      nextCursor: rows.length > PAGE_SIZE ? encodeCursor(offset + PAGE_SIZE) : null,
    };
  }

  /** The branch the user is looking at, root to leaf, with each message's siblings. */
  async branch(
    p: Principal,
    id: string,
  ): Promise<typeof CloudConversationMessagesResponse.Encoded> {
    const conversation = await this.own(p, id);
    const rows = await this.messages(id);
    const children = childrenByParent(rows);
    return {
      conversation: toConversation(conversation),
      messages: branchTo(rows, conversation.currentLeafId).map((m) =>
        Object.assign(toMessage(m), {
          siblingIds: (children.get(m.parentId) ?? []).map((s) => s.id),
        }),
      ),
    };
  }

  async send(
    facts: RequestFacts,
    conversationId: string,
    input: CloudSendMessageInput,
  ): Promise<typeof CloudSendMessageResponse.Encoded> {
    const p = facts.principal;
    await this.own(p, conversationId);
    const sent = await this.findSent(conversationId, input.clientMessageId);
    if (sent) return this.resume(facts, sent);
    if (input.parentId) {
      const parent = await this.db.query.messages.findFirst({
        where: and(
          eq(schema.messages.id, input.parentId),
          eq(schema.messages.conversationId, conversationId),
        ),
      });
      if (!parent) throw notFound();
      if (parent.role !== "assistant")
        throw new ApiError(400, "bad_parent", "A message must reply to an assistant message.");
    }
    await this.deps.files.assertUsable(p, input.parts);
    let created: { message: MessageRow; reply: MessageRow; run: RunRow };
    try {
      created = await this.db.transaction(async (tx) => {
        const [message] = await tx
          .insert(schema.messages)
          .values({
            conversationId,
            parentId: input.parentId,
            role: "user",
            parts: input.parts,
            clientMessageId: input.clientMessageId,
          })
          .returning();
        const reply = await this.createReply(tx, p, message!, input.model, input.mode);
        return { message: message!, ...reply };
      });
    } catch (error) {
      // A concurrent retry with the same clientMessageId won the insert.
      const again = isUniqueViolation(error)
        ? await this.findSent(conversationId, input.clientMessageId)
        : null;
      if (again) return this.resume(facts, again);
      throw error;
    }
    await this.startRun(facts, created.run);
    return {
      message: toMessage(created.message),
      reply: toMessage(created.reply),
      run: toRun(created.run),
    };
  }

  /** A new reply beside `messageId` (an assistant message), for the same user message. */
  async regenerate(
    facts: RequestFacts,
    conversationId: string,
    messageId: string,
    input: CloudRegenerateInput,
  ): Promise<typeof CloudSendMessageResponse.Encoded> {
    const p = facts.principal;
    await this.own(p, conversationId);
    const original = await this.db.query.messages.findFirst({
      where: and(
        eq(schema.messages.id, messageId),
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.role, "assistant"),
      ),
    });
    const parent = original?.parentId
      ? await this.db.query.messages.findFirst({ where: eq(schema.messages.id, original.parentId) })
      : null;
    if (!original || !parent) throw notFound();
    const previous = original.runId
      ? await this.db.query.runs.findFirst({ where: eq(schema.runs.id, original.runId) })
      : null;
    const model = input.model ?? original.model ?? previous?.model;
    if (!model) throw new ApiError(400, "bad_request", "Choose a model.");
    const { reply, run } = await this.db.transaction((tx) =>
      this.createReply(tx, p, parent, model, previous?.mode ?? "chat"),
    );
    await this.startRun(facts, run);
    return { message: toMessage(parent), reply: toMessage(reply), run: toRun(run) };
  }

  /** An empty assistant reply to `parent` and the run that fills it; it becomes the current leaf. */
  private async createReply(
    tx: Tx,
    p: Principal,
    parent: MessageRow,
    model: string,
    mode: CloudRunMode,
  ): Promise<{ reply: MessageRow; run: RunRow }> {
    const [reply] = await tx
      .insert(schema.messages)
      .values({
        conversationId: parent.conversationId,
        parentId: parent.id,
        role: "assistant",
        parts: [],
        model,
      })
      .returning();
    const [run] = await tx
      .insert(schema.runs)
      .values({
        orgId: p.orgId,
        userId: p.userId,
        conversationId: parent.conversationId,
        messageId: reply!.id,
        mode,
        model,
      })
      .returning();
    const [linked] = await tx
      .update(schema.messages)
      .set({ runId: run!.id })
      .where(eq(schema.messages.id, reply!.id))
      .returning();
    await tx
      .update(schema.conversations)
      .set({
        currentLeafId: reply!.id,
        lastMessageAt: new Date(),
        searchText: appendSearchText(textOf(parent.parts)),
      })
      .where(eq(schema.conversations.id, parent.conversationId));
    return { reply: linked!, run: run! };
  }

  private async findSent(conversationId: string, clientMessageId: string) {
    const message = await this.db.query.messages.findFirst({
      where: and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.clientMessageId, clientMessageId),
      ),
    });
    if (!message) return null;
    const reply = await this.db.query.messages.findFirst({
      where: and(eq(schema.messages.parentId, message.id), eq(schema.messages.role, "assistant")),
      orderBy: asc(schema.messages.createdAt),
    });
    const run = reply?.runId
      ? await this.db.query.runs.findFirst({ where: eq(schema.runs.id, reply.runId) })
      : null;
    return reply && run ? { message, reply, run } : null;
  }

  /** A retried send returns the original; a run that never started is started now. */
  private async resume(
    facts: RequestFacts,
    sent: { message: MessageRow; reply: MessageRow; run: RunRow },
  ): Promise<typeof CloudSendMessageResponse.Encoded> {
    if (sent.run.status === "queued") await this.startRun(facts, sent.run);
    return { message: toMessage(sent.message), reply: toMessage(sent.reply), run: toRun(sent.run) };
  }

  private async startRun(facts: RequestFacts, run: RunRow): Promise<void> {
    if (run.mode === "chat") this.deps.runner.start(run.id, facts);
    else await this.deps.tasks.enqueue(run.id);
  }
}
