/**
 * Cloud chat: conversations, message trees, uploaded files, share snapshots,
 * and the runs (assistant turns and background tasks) that write replies.
 * Shapes on the wire are defined in @synara/contracts/cloud.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth.ts";

const id = () =>
  uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    pinned: boolean("pinned").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    /** Message text the app appends (bounded) so search covers content, not just titles. */
    searchText: text("search_text").notNull().default(""),
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || search_text)`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("conversations_user_updated_idx").on(t.userId, t.updatedAt),
    index("conversations_org_idx").on(t.orgId),
    index("conversations_search_idx").using("gin", t.search),
  ],
);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

/** A tree: edits and regenerations add siblings under the same parent. */
export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => messages.id, {
      onDelete: "cascade",
    }),
    role: messageRoleEnum("role").notNull(),
    /** CloudMessagePart[]: text, file_ref, image_ref, tool_call, tool_result. */
    parts: jsonb("parts").$type<readonly unknown[]>().notNull(),
    model: text("model"),
    runId: uuid("run_id").references((): AnyPgColumn => runs.id, { onDelete: "set null" }),
    /** Client-generated id that makes sending a message idempotent. */
    clientMessageId: text("client_message_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("messages_client_message_idx").on(t.conversationId, t.clientMessageId),
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
    index("messages_parent_idx").on(t.parentId),
  ],
);

export const fileStatusEnum = pgEnum("file_status", ["pending", "scanning", "ready", "rejected"]);

/** Private blobs under org/{orgId}/files/{fileId}; usable only once `ready`. */
export const files = pgTable(
  "files",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    status: fileStatusEnum("status").notNull().default("pending"),
    source: text("source").notNull().default("upload"), // upload | generated
    sha256: text("sha256"),
    width: integer("width"),
    height: integer("height"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("files_storage_key_idx").on(t.storageKey),
    index("files_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/** Read-only snapshot links. Only the SHA-256 of the 32-byte token is stored. */
export const shares = pgTable(
  "shares",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    title: text("title"),
    /** CloudSharedMessage[] frozen at creation. */
    snapshot: jsonb("snapshot").$type<readonly unknown[]>().notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("shares_token_hash_idx").on(t.tokenHash),
    index("shares_conversation_idx").on(t.conversationId),
  ],
);

export const runModeEnum = pgEnum("run_mode", ["chat", "task"]);
export const runStatusEnum = pgEnum("run_status", [
  "queued",
  "running",
  "blocked_on_usage",
  "succeeded",
  "failed",
  "cancelled",
]);

/** Every assistant turn. Task runs hold a lease so a crashed worker's run can resume. */
export const runs = pgTable(
  "runs",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** The assistant message this run writes into. */
    messageId: uuid("message_id")
      .notNull()
      .references((): AnyPgColumn => messages.id, { onDelete: "cascade" }),
    mode: runModeEnum("mode").notNull(),
    status: runStatusEnum("status").notNull().default("queued"),
    model: text("model").notNull(),
    error: jsonb("error").$type<{ readonly code: string; readonly message: string }>(),
    lastSeq: integer("last_seq").notNull().default(0),
    steps: integer("steps").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
    budgetCapMicro: bigint("budget_cap_micro", { mode: "bigint" }),
    spentMicro: bigint("spent_micro", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("runs_conversation_created_idx").on(t.conversationId, t.createdAt),
    index("runs_user_created_idx").on(t.userId, t.createdAt),
    // Resumable work: unfinished runs by lease expiry.
    index("runs_active_lease_idx")
      .on(t.status, t.leaseExpiresAt)
      .where(sql`${t.status} IN ('queued', 'running', 'blocked_on_usage')`),
  ],
);

/** Append-only, durable run event log; `seq` is dense per run starting at 1. */
export const runEvents = pgTable(
  "run_events",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] })],
);
