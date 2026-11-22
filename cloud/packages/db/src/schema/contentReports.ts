/**
 * Reports of offensive, harmful, or wrong AI answers, reviewed by moderators in
 * the admin app. The reported answer is copied into `snapshot` so a report
 * survives the conversation's deletion. Reporter ids are null for signed-out
 * desktop reports.
 */
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { admins } from "./admin.ts";
import { organization, user } from "./auth.ts";
import { conversations, messages } from "./chat.ts";

export const contentReports = pgTable(
  "content_reports",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    orgId: uuid("org_id").references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    source: text("source").$type<"cloud" | "desktop">().notNull(),
    reason: text("reason").$type<"offensive" | "harmful" | "wrong" | "other">().notNull(),
    note: text("note"),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    /** Cloud: the message's CloudMessagePart[]. Desktop: [{ type: "text", text }]. */
    snapshot: jsonb("snapshot").$type<readonly unknown[]>().notNull(),
    /** Desktop: the agent's display name as the phone showed it. */
    agent: text("agent"),
    /** Cloud: the model that wrote the message. */
    model: text("model"),
    status: text("status").$type<"open" | "resolved">().notNull().default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => admins.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("content_reports_user_message_idx")
      .on(t.userId, t.messageId)
      .where(sql`${t.messageId} IS NOT NULL`),
    index("content_reports_status_created_idx").on(t.status, t.createdAt),
  ],
);
