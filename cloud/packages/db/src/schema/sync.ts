import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { organization, user } from "./auth.ts";
import { devices } from "./usage.ts";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/**
 * Org-scoped replica of the desktop's orchestration event log. Each row is
 * one event as the desktop persists it (same shape as the open-source
 * `orchestration_events` table) plus the org, the device that produced it,
 * and a cloud-assigned sequence used as the pull cursor.
 */
export const threadEvents = pgTable(
  "thread_events",
  {
    sequence: bigserial("sequence", { mode: "bigint" }).primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    originDeviceId: uuid("origin_device_id").references(() => devices.id, { onDelete: "set null" }),
    /** The desktop's own event id; unique per org so replays are idempotent. */
    eventId: text("event_id").notNull(),
    aggregateKind: text("aggregate_kind").notNull(),
    streamId: text("stream_id").notNull(),
    streamVersion: integer("stream_version").notNull(),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    commandId: text("command_id"),
    causationEventId: text("causation_event_id"),
    correlationId: text("correlation_id"),
    actorKind: text("actor_kind").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    metadata: jsonb("metadata").$type<unknown>(),
    sizeBytes: integer("size_bytes").notNull(),
    receivedAt: createdAt(),
  },
  (t) => [
    uniqueIndex("thread_events_org_event_idx").on(t.orgId, t.eventId),
    index("thread_events_org_sequence_idx").on(t.orgId, t.sequence),
    index("thread_events_org_stream_idx").on(t.orgId, t.streamId),
  ],
);

/** Lightweight per-thread index derived from events, for listing on web and iOS. */
export const threadIndex = pgTable(
  "thread_index",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    projectId: text("project_id"),
    title: text("title"),
    provider: text("provider"),
    model: text("model"),
    lastEventSequence: bigint("last_event_sequence", { mode: "bigint" }).notNull(),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
    archived: boolean("archived").notNull().default(false),
    deleted: boolean("deleted").notNull().default(false),
    eventCount: integer("event_count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("thread_index_org_thread_idx").on(t.orgId, t.threadId),
    index("thread_index_org_last_idx").on(t.orgId, t.lastEventAt),
  ],
);

/** Content-addressed attachments in object storage. */
export const attachments = pgTable(
  "attachments",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    contentHash: text("content_hash").notNull(), // sha256 hex
    bucketKey: text("bucket_key").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"), // pending | ready
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("attachments_org_hash_idx").on(t.orgId, t.contentHash)],
);

/** Where each device has pulled up to, and what it has pushed. */
export const deviceCursors = pgTable(
  "device_cursors",
  {
    deviceId: uuid("device_id")
      .primaryKey()
      .references(() => devices.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    pulledThrough: bigint("pulled_through", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    lastPushedEventId: text("last_pushed_event_id"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  },
  (t) => [index("device_cursors_org_idx").on(t.orgId)],
);

/** Per-org storage accounting so quota checks are one row read. */
export const syncUsage = pgTable("sync_usage", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  eventBytes: bigint("event_bytes", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  attachmentBytes: bigint("attachment_bytes", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
