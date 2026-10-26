import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";

/** Random installation identity; credentials and customer content never enter reports. */
export const analyticsInstallations = pgTable(
  "analytics_installations",
  {
    id: uuid("id").primaryKey(),
    credentialHash: text("credential_hash").notNull().unique(),
    platform: text("platform").notNull(),
    appVersion: text("app_version").notNull(),
    osVersion: text("os_version").notNull(),
    channel: text("channel").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    firstOpenedAt: timestamp("first_opened_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (table) => [index("analytics_installations_seen_idx").on(table.lastSeenAt)],
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => analyticsInstallations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    kind: text("kind").notNull(),
    feature: text("feature"),
    platform: text("platform").notNull(),
    appVersion: text("app_version").notNull(),
    channel: text("channel").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("analytics_events_installation_idx").on(table.installationId),
    index("analytics_events_user_idx").on(table.userId),
    index("analytics_events_retention_idx").on(table.receivedAt),
  ],
);

/** Actor keys preserve interval-distinct counts without summing daily users. */
export const analyticsDailyActivity = pgTable(
  "analytics_daily_activity",
  {
    day: text("day").notNull(),
    installationId: uuid("installation_id")
      .notNull()
      .references(() => analyticsInstallations.id, { onDelete: "cascade" }),
    actorKey: text("actor_key").notNull(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    platform: text("platform").notNull(),
    appVersion: text("app_version").notNull(),
    channel: text("channel").notNull(),
    events: integer("events").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.day, table.installationId, table.actorKey, table.feature, table.appVersion],
    }),
    index("analytics_daily_user_day_idx").on(table.userId, table.day),
    index("analytics_daily_day_idx").on(table.day),
  ],
);

export const analyticsSourceSnapshots = pgTable(
  "analytics_source_snapshots",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    source: text("source").notNull(),
    dimensionKey: text("dimension_key").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    value: bigint("value", { mode: "bigint" }).notNull(),
    /** Parsed aggregate metadata only; never source credentials or raw visitors. */
    metadata: jsonb("metadata")
      .$type<{
        platform?: string;
        version?: string;
        assetType?: string;
        name?: string;
        status?: "connected" | "error";
        visibility?: "public" | "private";
      }>()
      .notNull()
      .default({}),
  },
  (table) => [
    uniqueIndex("analytics_source_observation_uidx").on(
      table.source,
      table.dimensionKey,
      table.observedAt,
    ),
    index("analytics_source_retention_idx").on(table.observedAt),
  ],
);
