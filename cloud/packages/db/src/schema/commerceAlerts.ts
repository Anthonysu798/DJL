import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { commerceOrders } from "./commerce.ts";

/** Operational follow-up only: these incidents never authorize a financial action. */
export const commerceAlertIncidents = pgTable(
  "commerce_alert_incidents",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    kind: text("kind").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    orderId: uuid("order_id").references(() => commerceOrders.id),
    sourceStatus: text("source_status").notNull(),
    state: text("state").$type<"pending" | "open" | "resolved">().notNull(),
    firstDetectedAt: timestamp("first_detected_at", { withTimezone: true }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    lastTransitionAt: timestamp("last_transition_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("commerce_alert_active_unique")
      .on(t.kind, t.resourceId)
      .where(sql`${t.state} in ('pending','open')`),
    index("commerce_alert_transition_idx").on(t.lastTransitionAt, t.id),
    check(
      "commerce_alert_kind",
      sql`${t.kind} in ('payment_unresolved','payment_review','refund_unresolved','refund_review','refund_pending','event_unprocessed','event_review_unmapped','external_refund_unresolved','withdrawal_requested','withdrawal_approved')`,
    ),
    check(
      "commerce_alert_resource_type",
      sql`${t.resourceType} in ('payment_attempt','provider_refund','payment_event','external_refund','withdrawal')`,
    ),
    check("commerce_alert_state", sql`${t.state} in ('pending','open','resolved')`),
    check(
      "commerce_alert_lifecycle",
      sql`${t.firstDetectedAt}<=${t.lastSeenAt} and ${t.firstDetectedAt}<=${t.lastTransitionAt} and
      ((${t.state}='pending' and ${t.openedAt} is null and ${t.resolvedAt} is null) or
       (${t.state}='open' and ${t.openedAt} is not null and ${t.resolvedAt} is null) or
       (${t.state}='resolved' and ${t.resolvedAt} is not null))`,
    ),
  ],
);
