import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  date,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";

/** A public slug identifies a redirect; it is never an account credential. */
export const socialTrackingLinks = pgTable(
  "social_tracking_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    targetUrl: text("target_url").notNull(),
    campaignId: text("campaign_id").notNull(),
    threadId: text("thread_id").notNull(),
    contentRevision: integer("content_revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("social_tracking_slug").on(t.slug),
    index("social_tracking_owner_campaign").on(t.orgId, t.userId, t.campaignId, t.createdAt),
  ],
);

/** UTC-day aggregates only. No visitor IP, user agent, fingerprint or event rows. */
export const socialTrackingDaily = pgTable(
  "social_tracking_daily",
  {
    linkId: uuid("link_id")
      .notNull()
      .references(() => socialTrackingLinks.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    linkOpens: integer("link_opens").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.linkId, t.day] }),
    index("social_tracking_daily_owner").on(t.orgId, t.userId, t.day),
  ],
);
