import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
  boolean,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";
import { socialDrafts } from "./socialPublishing.ts";

/** Private pinned references. Never serialize this snapshot directly to a public response. */
export interface SocialReviewSnapshot {
  caption: string;
  targets: { provider: string; caption: string }[];
  media: { fileId: string; storageKey: string; sha256: string; mimeType: string }[];
  publicationMode: "now" | "scheduled";
  scheduledAt: string;
  timezone: string;
}
export const socialReviewLinks = pgTable(
  "social_review_links",
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
    tokenHash: text("token_hash").notNull(),
    snapshot: jsonb("snapshot").$type<SocialReviewSnapshot>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("social_review_token_hash").on(t.tokenHash),
    index("social_review_draft").on(t.draftId),
  ],
);
export const socialReviewFeedback = pgTable(
  "social_review_feedback",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    linkId: uuid("link_id")
      .notNull()
      .references(() => socialReviewLinks.id, { onDelete: "cascade" }),
    reviewerName: text("reviewer_name").notNull(),
    identityVerified: boolean("identity_verified").notNull().default(false),
    comment: text("comment").notNull(),
    decision: text("decision").$type<"comment" | "approved" | "changes_requested">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("social_review_feedback_link").on(t.linkId)],
);
