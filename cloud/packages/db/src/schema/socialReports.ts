import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";
import { socialDrafts } from "./socialPublishing.ts";
import type { CloudSocialWeeklyReport } from "../../../../../packages/contracts/src/cloud/socialReports.ts";

export const socialReportSchedules = pgTable(
  "social_report_schedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => socialDrafts.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    timezone: text("timezone").notNull(),
    weekday: integer("weekday").notNull(),
    hour: integer("hour").notNull(),
    minute: integer("minute").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("social_report_schedule_owner_thread").on(
      table.orgId,
      table.userId,
      table.threadId,
    ),
    index("social_report_schedule_due").on(table.enabled, table.nextRunAt),
  ],
);
export const socialWeeklyReports = pgTable(
  "social_weekly_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => socialReportSchedules.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    content: jsonb("content").$type<CloudSocialWeeklyReport>().notNull(),
  },
  (table) => [
    uniqueIndex("social_weekly_report_period").on(table.scheduleId, table.periodEnd),
    index("social_weekly_report_owner_thread").on(
      table.orgId,
      table.userId,
      table.threadId,
      table.periodEnd,
    ),
  ],
);
