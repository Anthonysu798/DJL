import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { commerceAlertIncidents } from "./commerceAlerts.ts";

/** A durable, at-most-one automatic attempt, not proof that an email was received. */
export const commerceAlertEmailDeliveries = pgTable(
  "commerce_alert_email_deliveries",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => commerceAlertIncidents.id),
    mode: text("mode").$type<"mock" | "resend">().notNull(),
    recipient: text("recipient").notNull(),
    templateVersion: text("template_version").notNull().default("commerce-alert-v1"),
    state: text("state")
      .$type<
        "pending" | "submitting" | "accepted" | "simulated" | "needs_review" | "skipped_resolved"
      >()
      .notNull()
      .default("pending"),
    claimToken: uuid("claim_token"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    providerId: text("provider_id"),
    reasonCode: text("reason_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("commerce_alert_email_incident_mode_unique").on(t.incidentId, t.mode),
    index("commerce_alert_email_pending_idx").on(t.state, t.createdAt, t.id),
    check("commerce_alert_email_mode", sql`${t.mode} in ('mock','resend')`),
    check(
      "commerce_alert_email_state",
      sql`${t.state} in ('pending','submitting','accepted','simulated','needs_review','skipped_resolved')`,
    ),
    check(
      "commerce_alert_email_reason",
      sql`${t.reasonCode} is null or ${t.reasonCode} in ('delivery_interrupted','send_result_unknown','resolved_before_send','recipient_changed')`,
    ),
    check(
      "commerce_alert_email_times",
      sql`(${t.attemptedAt} is null or ${t.attemptedAt}>=${t.createdAt}) and (${t.completedAt} is null or ${t.attemptedAt} is null or ${t.completedAt}>=${t.attemptedAt})`,
    ),
    check(
      "commerce_alert_email_lifecycle",
      sql`
    ((${t.state}='pending' and ${t.claimToken} is null and ${t.attemptedAt} is null and ${t.completedAt} is null)
    or (${t.state}='submitting' and ${t.claimToken} is not null and ${t.attemptedAt} is not null and ${t.completedAt} is null)
    or (${t.state} in ('accepted','simulated') and ${t.claimToken} is not null and ${t.attemptedAt} is not null and ${t.completedAt} is not null and coalesce(length(${t.providerId}),0)>0)
    or (${t.state} in ('needs_review','skipped_resolved') and ${t.completedAt} is not null and ${t.reasonCode} is not null))
    and (${t.state}<>'accepted' or ${t.mode}='resend') and (${t.state}<>'simulated' or ${t.mode}='mock')
    and (${t.completedAt} is null or ${t.completedAt}>=${t.createdAt})
  `,
    ),
  ],
);
