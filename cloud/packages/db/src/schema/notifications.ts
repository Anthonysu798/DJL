import { pgTable, uuid, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { organization, user } from "./auth.ts";
import { runs } from "./chat.ts";

export const notificationReads = pgTable(
  "notification_reads",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.runId] })],
);
