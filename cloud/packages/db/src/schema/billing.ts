import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { Bucket } from "@djl/domain";

import { organization, user } from "./auth.ts";

const id = () =>
  uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

export const planIdEnum = pgEnum("plan_id", ["free", "trial", "starter", "business", "autopilot"]);

/** Plan configuration. Seeded from @djl/domain DEFAULT_PLANS; admins edit rows, not code. */
export const plans = pgTable("plans", {
  id: planIdEnum("id").primaryKey(),
  name: text("name").notNull(),
  monthlyPriceUsdCents: integer("monthly_price_usd_cents").notNull(),
  annualPriceUsdCents: integer("annual_price_usd_cents").notNull(),
  includedMicrocredits: bigint("included_microcredits", { mode: "bigint" }).notNull(),
  concurrentStreams: integer("concurrent_streams").notNull(),
  requestsPerMinute: integer("requests_per_minute").notNull(),
  priorityWeight: integer("priority_weight").notNull(),
  syncQuotaBytes: bigint("sync_quota_bytes", { mode: "bigint" }).notNull(),
  /** Usage window caps in microcredits: rolling 5 hours and the 7-day week. */
  window5hMicro: bigint("window_5h_micro", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  windowWeekMicro: bigint("window_week_micro", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  requiresOwner2fa: boolean("requires_owner_2fa").notNull().default(false),
  stripeMonthlyPriceId: text("stripe_monthly_price_id"),
  stripeAnnualPriceId: text("stripe_annual_price_id"),
  active: boolean("active").notNull().default(true),
  updatedAt: updatedAt(),
});

/** Organization-level billing profile. One Stripe customer per org. */
export const customers = pgTable(
  "customers",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    billingEmail: text("billing_email").notNull(),
    country: text("country"),
    currency: text("currency").notNull().default("usd"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("customers_org_id_idx").on(t.orgId),
    uniqueIndex("customers_stripe_customer_id_idx").on(t.stripeCustomerId),
  ],
);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    planId: planIdEnum("plan_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    status: subscriptionStatusEnum("status").notNull(),
    interval: text("interval").notNull(), // month | year
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** Period for which plan credits were last granted; prevents double grants. */
    lastGrantedPeriodStart: timestamp("last_granted_period_start", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("subscriptions_org_id_idx").on(t.orgId),
    uniqueIndex("subscriptions_stripe_id_idx").on(t.stripeSubscriptionId),
  ],
);

export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  "free_grant",
  "trial_grant",
  "plan_grant",
  "topup",
  "admin_grant",
  "reservation",
  "release",
  "settlement",
  "refund",
  "expiry",
  "anonymize",
]);
/** `free` holds the weekly free allowance, spent only on free-eligible models. */
export const ledgerBucketEnum = pgEnum("ledger_bucket", ["free", "trial", "plan", "topup"]);

/**
 * Append-only. No UPDATE or DELETE grant exists for the application role;
 * see infra/supabase/policies.sql. Amounts are signed microcredits.
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id),
    type: ledgerEntryTypeEnum("type").notNull(),
    bucket: ledgerBucketEnum("bucket").$type<Bucket>().notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    reservationId: uuid("reservation_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    /** Who or what caused the entry: user id, admin id, "system:worker", "stripe:evt_..." */
    actor: text("actor").notNull(),
    reason: text("reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("credit_ledger_idempotency_idx").on(t.idempotencyKey),
    index("credit_ledger_org_created_idx").on(t.orgId, t.createdAt),
    index("credit_ledger_reservation_idx").on(t.reservationId),
  ],
);

/**
 * Materialized per-org balances, maintained in the same transaction as each
 * ledger write. `SELECT ... FOR UPDATE` on this row serializes concurrent
 * reservations for one org. The ledger is the source of truth; a worker job
 * re-folds and repairs drift.
 */
export const creditBalances = pgTable("credit_balances", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  free: bigint("free", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  trial: bigint("trial", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  plan: bigint("plan", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  topup: bigint("topup", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  /** Lower bound for the next fold; entries at or before this are included. */
  foldedThrough: timestamp("folded_through", { withTimezone: true }),
  updatedAt: updatedAt(),
});

/** Every Stripe event id we have handled. Insert-before-process makes webhooks idempotent. */
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: createdAt(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
});

/** Mirror of Stripe invoices for the dashboard; Stripe stays authoritative. */
export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(), // Stripe invoice id
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id),
    status: text("status").notNull(),
    amountDueUsdCents: integer("amount_due_usd_cents").notNull(),
    amountPaidUsdCents: integer("amount_paid_usd_cents").notNull(),
    currency: text("currency").notNull(),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    pdfUrl: text("pdf_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("invoices_org_id_idx").on(t.orgId)],
);

/** Trial grant tracking: one row per org; phone hash uniqueness enforces one trial per phone. */
export const trialGrants = pgTable(
  "trial_grants",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    phoneHash: text("phone_hash").notNull(),
    phoneLineType: text("phone_line_type").notNull(),
    deviceFingerprint: text("device_fingerprint"),
    ipHash: text("ip_hash"),
    status: text("status").notNull(), // pending_first_request | queued_for_review | granted | rejected
    reasons: jsonb("reasons").$type<readonly string[]>().notNull().default([]),
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("trial_grants_phone_hash_idx").on(t.phoneHash),
    uniqueIndex("trial_grants_org_id_idx").on(t.orgId),
    index("trial_grants_status_idx").on(t.status),
  ],
);

/** Daily trial budget consumption, one row per UTC day. */
export const trialBudgetDays = pgTable("trial_budget_days", {
  day: text("day").primaryKey(), // YYYY-MM-DD UTC
  capUsdCents: integer("cap_usd_cents").notNull(),
  grantedUsdCents: integer("granted_usd_cents").notNull().default(0),
  updatedAt: updatedAt(),
});
