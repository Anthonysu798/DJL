import { sql } from "drizzle-orm";
import {
  bigint,
  check,
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
import { commerceCustomers, commerceOrderItems, commerceOrders } from "./commerce.ts";

const date = (name: string) => timestamp(name, { withTimezone: true });
export type CommercePaymentAttemptState =
  | "creating"
  | "open"
  | "unknown"
  | "cancel_requested"
  | "paid"
  | "expired_unpaid"
  | "failed"
  | "requires_review";
export const commercePaymentAttempts = pgTable(
  "commerce_payment_attempts",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => commerceOrders.id),
    requestKey: text("request_key").notNull(),
    referrerId: uuid("referrer_id").references(() => commerceCustomers.userId),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("cad"),
    status: text("status").$type<CommercePaymentAttemptState>().notNull().default("creating"),
    sessionId: text("session_id").unique(),
    paymentIntentId: text("payment_intent_id").unique(),
    checkoutUrl: text("checkout_url"),
    expiresAt: date("expires_at").notNull(),
    createdAt: date("created_at").defaultNow().notNull(),
    updatedAt: date("updated_at").defaultNow().notNull(),
    reviewKey: text("review_key"),
    reviewVersion: integer("review_version").notNull().default(0),
  },
  (t) => [
    uniqueIndex("commerce_payment_request_unique").on(t.orderId, t.requestKey),
    uniqueIndex("commerce_payment_one_active")
      .on(t.orderId)
      .where(
        sql`${t.status} in ('creating','open','unknown','cancel_requested','requires_review')`,
      ),
    check(
      "commerce_payment_test_amount",
      sql`${t.currency}='cad' and ${t.amountCents} between 50 and 99999999`,
    ),
    check(
      "commerce_payment_state",
      sql`${t.status} in ('creating','open','unknown','cancel_requested','paid','expired_unpaid','failed','requires_review')`,
    ),
    index("commerce_payment_order_idx").on(t.orderId),
    check("commerce_payment_review_version", sql`${t.reviewVersion}>=0`),
  ],
);

export type CommerceProviderRefundState =
  | "submitting"
  | "unknown"
  | "pending"
  | "succeeded"
  | "failed"
  | "requires_review";
export const commerceProviderRefunds = pgTable(
  "commerce_provider_refunds",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => commerceOrders.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => commerceOrderItems.id),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => commercePaymentAttempts.id),
    actorId: text("actor_id").notNull(),
    requestKey: text("request_key").notNull(),
    reason: text("reason").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    refundTotalCents: bigint("refund_total_cents", { mode: "number" }).notNull(),
    status: text("status").$type<CommerceProviderRefundState>().notNull().default("submitting"),
    providerRefundId: text("provider_refund_id").unique(),
    appliedAt: date("applied_at"),
    createdAt: date("created_at").defaultNow().notNull(),
    updatedAt: date("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("commerce_refund_request_unique").on(t.actorId, t.requestKey),
    uniqueIndex("commerce_refund_one_active")
      .on(t.itemId)
      .where(sql`${t.status} in ('submitting','unknown','pending','requires_review')`),
    check(
      "commerce_provider_refund_amount",
      sql`${t.amountCents}>0 and ${t.refundTotalCents}>=${t.amountCents} and ${t.refundTotalCents}<=99999999`,
    ),
    check(
      "commerce_provider_refund_state",
      sql`${t.status} in ('submitting','unknown','pending','succeeded','failed','requires_review')`,
    ),
    index("commerce_provider_refund_order_idx").on(t.orderId),
  ],
);

export const commercePaymentEvents = pgTable(
  "commerce_payment_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    objectId: text("object_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    receivedAt: date("received_at").defaultNow().notNull(),
    processedAt: date("processed_at"),
    attempts: integer("attempts").notNull().default(0),
    outcome: text("outcome").$type<"processed" | "ignored" | "requires_review" | null>(),
    errorCode: text("error_code"),
    facts: jsonb("facts").$type<Readonly<Record<string, string | number | boolean | null>>>(),
  },
  (t) => [index("commerce_payment_event_object_idx").on(t.objectId)],
);

export type CommerceExternalRefundStatus =
  | "unknown"
  | "pending"
  | "requires_action"
  | "succeeded"
  | "failed"
  | "canceled";
export type CommerceExternalAllocationState =
  | "unallocated"
  | "allocated"
  | "excluded_owned"
  | "requires_review";
export const commerceExternalRefunds = pgTable(
  "commerce_external_refunds",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => commerceOrders.id),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => commercePaymentAttempts.id),
    providerRefundId: text("provider_refund_id").notNull().unique(),
    sourceEventId: text("source_event_id")
      .notNull()
      .references(() => commercePaymentEvents.id),
    paymentIntentId: text("payment_intent_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("cad"),
    providerStatus: text("provider_status")
      .$type<CommerceExternalRefundStatus>()
      .notNull()
      .default("unknown"),
    allocationState: text("allocation_state")
      .$type<CommerceExternalAllocationState>()
      .notNull()
      .default("unallocated"),
    version: integer("version").notNull().default(1),
    holdVersion: integer("hold_version"),
    allocatedAt: date("allocated_at"),
    allocatedBy: text("allocated_by"),
    allocationFingerprint: text("allocation_fingerprint"),
    allocationReason: text("allocation_reason"),
    observedAt: date("observed_at").defaultNow().notNull(),
    createdAt: date("created_at").defaultNow().notNull(),
  },
  (t) => [
    check(
      "commerce_external_refund_amount",
      sql`${t.currency}='cad' and ${t.amountCents} between 1 and 99999999`,
    ),
    check(
      "commerce_external_refund_status",
      sql`${t.providerStatus} in ('unknown','pending','requires_action','succeeded','failed','canceled')`,
    ),
    check(
      "commerce_external_refund_state",
      sql`${t.allocationState} in ('unallocated','allocated','excluded_owned','requires_review')`,
    ),
    check(
      "commerce_external_refund_version",
      sql`${t.version}>=1 and (${t.holdVersion} is null or ${t.holdVersion}>0)`,
    ),
    index("commerce_external_refund_order_idx").on(t.orderId),
  ],
);

export const commerceExternalRefundAllocations = pgTable(
  "commerce_external_refund_allocations",
  {
    externalRefundId: uuid("external_refund_id")
      .notNull()
      .references(() => commerceExternalRefunds.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => commerceOrderItems.id),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    refundedBeforeCents: bigint("refunded_before_cents", { mode: "number" }).notNull(),
    refundedAfterCents: bigint("refunded_after_cents", { mode: "number" }).notNull(),
    createdAt: date("created_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.externalRefundId, t.itemId] }),
    check(
      "commerce_external_allocation_amount",
      sql`${t.amountCents}>0 and ${t.refundedBeforeCents}>=0 and ${t.refundedAfterCents}=${t.refundedBeforeCents}+${t.amountCents} and ${t.refundedAfterCents}<=99999999`,
    ),
  ],
);
