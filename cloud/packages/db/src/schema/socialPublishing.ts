import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";

export interface SocialDraftContent {
  caption: string;
  captions: Record<string, string>;
  tiktokOptions?:
    | {
        privacyLevel: string;
        disableDuet: boolean;
        disableStitch: boolean;
        disableComment: boolean;
        brandContent: boolean;
        brandOrganic: boolean;
        isAigc: boolean;
        musicUsageConfirmed: boolean;
      }
    | undefined;
  mediaFileIds: string[];
  accountIds: string[];
  scheduledAt: string;
  timezone: string;
}
export const socialDrafts = pgTable("social_drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  threadId: text("thread_id").notNull(),
  revision: integer("revision").notNull(),
  content: jsonb("content").$type<SocialDraftContent>().notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type SocialTaskState =
  | "queued"
  | "publishing"
  | "reconciling"
  | "published"
  | "failed"
  | "uncertain"
  | "cancelled";
export const socialPublishTasks = pgTable(
  "social_publish_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => socialDrafts.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    accountId: uuid("account_id").notNull(),
    state: text("state").$type<SocialTaskState>().notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    attemptId: uuid("attempt_id"),
    remoteId: text("remote_id"),
    postId: text("post_id"),
    publishStartedAt: timestamp("publish_started_at", { withTimezone: true }),
    errorCode: text("error_code"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("social_publish_revision_account").on(t.draftId, t.revision, t.accountId),
    index("social_publish_due").on(t.state, t.dueAt),
  ],
);
