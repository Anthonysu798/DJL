import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth.ts";
import type { CommerceWithdrawalStatus } from "@djl/domain";

const id = () =>
  uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey();
const date = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => bigint(name, { mode: "number" });

/** Personal shopping identity. Never inherits AI organization permissions or balances. */
export const commerceCustomers = pgTable(
  "commerce_customers",
  {
    // Opaque historical identity survives auth-account purging without cascading financial records.
    userId: uuid("user_id").primaryKey(),
    referralCode: text("referral_code").notNull().unique(),
    referrerId: uuid("referrer_id").references((): AnyPgColumn => commerceCustomers.userId),
    firstPaidAt: date("first_paid_at"),
    createdAt: date("created_at").defaultNow().notNull(),
  },
  (t) => [
    check(
      "commerce_customer_no_self",
      sql`${t.referrerId} is null or ${t.referrerId} <> ${t.userId}`,
    ),
  ],
);

export const commerceSuppliers = pgTable("commerce_suppliers", {
  id: id(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  returnAddress: text("return_address").notNull(),
  createdAt: date("created_at").defaultNow().notNull(),
});
export const commerceSupplierMembers = pgTable(
  "commerce_supplier_members",
  {
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => commerceSuppliers.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.supplierId, t.userId] })],
);

/** Unverified TEST documents only. These records never settle a payable or move funds. */
export const commerceSupplierPaymentDocuments = pgTable(
  "commerce_supplier_payment_documents",
  {
    id: id(),
    operationId: uuid("operation_id").notNull().unique(),
    supplierId: uuid("supplier_id").notNull(),
    amountCents: money("amount_cents").notNull(),
    currency: text("currency").$type<"CAD">().notNull().default("CAD"),
    mode: text("mode").$type<"test">().notNull().default("test"),
    source: text("source")
      .$type<"unverified_manual_test_document">()
      .notNull()
      .default("unverified_manual_test_document"),
    reference: text("reference").notNull(),
    evidenceReference: text("evidence_reference").notNull(),
    reason: text("reason").notNull(),
    recordedBy: uuid("recorded_by").notNull(),
    recordedAt: date("recorded_at").defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      name: "commerce_supplier_payment_documents_supplier_fk",
      columns: [t.supplierId],
      foreignColumns: [commerceSuppliers.id],
    }),
    check(
      "commerce_supplier_payment_document_amount",
      sql`${t.amountCents} between 1 and 9007199254740991`,
    ),
    check(
      "commerce_supplier_payment_document_scope",
      sql`${t.currency}='CAD' and ${t.mode}='test' and ${t.source}='unverified_manual_test_document'`,
    ),
    check(
      "commerce_supplier_payment_document_text",
      sql`${t.reference}=btrim(${t.reference}) and char_length(${t.reference}) between 1 and 150 and ${t.evidenceReference}=btrim(${t.evidenceReference}) and char_length(${t.evidenceReference}) between 1 and 500 and ${t.reason}=btrim(${t.reason}) and char_length(${t.reason}) between 1 and 500`,
    ),
    index("commerce_supplier_payment_documents_supplier_idx").on(t.supplierId, t.recordedAt, t.id),
    index("commerce_supplier_payment_documents_reference_idx").on(t.reference),
  ],
);

export const commerceProducts = pgTable(
  "commerce_products",
  {
    id: id(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => commerceSuppliers.id),
    sku: text("sku").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    imageUrl: text("image_url").notNull(),
    priceCents: money("price_cents").notNull(),
    costCents: money("cost_cents").notNull(),
    commissionBps: integer("commission_bps").notNull(),
    returnDays: integer("return_days").notNull(),
    stock: integer("stock").notNull(),
    reserved: integer("reserved").notNull().default(0),
    status: text("status").$type<"draft" | "published" | "archived">().notNull().default("draft"),
    updatedAt: date("updated_at").defaultNow().notNull(),
    createdAt: date("created_at").defaultNow().notNull(),
  },
  (t) => [
    check(
      "commerce_product_money",
      sql`${t.priceCents} between 1 and 100000000 and ${t.costCents} between 0 and ${t.priceCents}`,
    ),
    check(
      "commerce_product_rate",
      sql`${t.commissionBps} between 0 and 10000 and ${t.returnDays} between 0 and 365`,
    ),
    check(
      "commerce_product_stock",
      sql`${t.stock} between 0 and 1000000 and ${t.reserved} between 0 and ${t.stock}`,
    ),
    check("commerce_product_status", sql`${t.status} in ('draft','published','archived')`),
    index("commerce_product_catalog_idx").on(t.status),
  ],
);

export const commerceFavorites = pgTable(
  "commerce_favorites",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => commerceProducts.id, { onDelete: "cascade" }),
    createdAt: date("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] })],
);

export interface CommerceAddressRow {
  name: string;
  line1: string;
  city: string;
  province: string;
  postalCode: string;
  country: "CA";
}
export const commerceOrders = pgTable(
  "commerce_orders",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => commerceCustomers.userId),
    referrerId: uuid("referrer_id").references(() => commerceCustomers.userId),
    status: text("status")
      .$type<"awaiting_payment" | "paid" | "cancelled" | "refunded">()
      .notNull()
      .default("awaiting_payment"),
    mode: text("mode").$type<"test">().notNull().default("test"),
    paymentProvider: text("payment_provider")
      .$type<"simulation" | "stripe_test">()
      .notNull()
      .default("simulation"),
    currency: text("currency").$type<"CAD">().notNull().default("CAD"),
    totalCents: money("total_cents").notNull(),
    refundedCents: money("refunded_cents").notNull().default(0),
    address: jsonb("address").$type<CommerceAddressRow>().notNull(),
    expiresAt: date("expires_at").notNull(),
    paidAt: date("paid_at"),
    createdAt: date("created_at").defaultNow().notNull(),
  },
  (t) => [
    check(
      "commerce_order_money",
      sql`${t.totalCents} between 1 and 5000000000000 and ${t.refundedCents} between 0 and ${t.totalCents}`,
    ),
    check("commerce_order_mode", sql`${t.mode}='test' and ${t.currency}='CAD'`),
    check(
      "commerce_order_payment_provider",
      sql`${t.paymentProvider} in ('simulation','stripe_test')`,
    ),
    check(
      "commerce_order_status",
      sql`${t.status} in ('awaiting_payment','paid','cancelled','refunded')`,
    ),
    index("commerce_order_owner_idx").on(t.userId),
  ],
);

export const commerceOrderItems = pgTable(
  "commerce_order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => commerceOrders.id),
    productId: uuid("product_id")
      .notNull()
      .references(() => commerceProducts.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => commerceSuppliers.id),
    name: text("name").notNull(),
    sku: text("sku"),
    quantity: integer("quantity").notNull(),
    priceCents: money("price_cents").notNull(),
    costCents: money("cost_cents").notNull(),
    lineCents: money("line_cents").notNull(),
    refundedCents: money("refunded_cents").notNull().default(0),
    commissionBps: integer("commission_bps").notNull(),
    returnDays: integer("return_days").notNull(),
    status: text("status")
      .$type<"pending" | "accepted" | "shipped" | "delivered" | "cancelled">()
      .notNull()
      .default("pending"),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    deliveredAt: date("delivered_at"),
    openCase: boolean("open_case").notNull().default(false),
  },
  (t) => [
    check(
      "commerce_item_money",
      sql`${t.quantity} between 1 and 1000 and ${t.lineCents}=${t.quantity}*${t.priceCents} and ${t.refundedCents} between 0 and ${t.lineCents}`,
    ),
    check(
      "commerce_item_status",
      sql`${t.status} in ('pending','accepted','shipped','delivered','cancelled')`,
    ),
    index("commerce_item_order_idx").on(t.orderId),
    index("commerce_item_supplier_idx").on(t.supplierId),
  ],
);

export const commerceCommissions = pgTable(
  "commerce_commissions",
  {
    id: id(),
    orderItemId: uuid("order_item_id")
      .notNull()
      .unique()
      .references(() => commerceOrderItems.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => commerceCustomers.userId),
    amountCents: money("amount_cents").notNull(),
    released: boolean("released").notNull().default(false),
    createdAt: date("created_at").defaultNow().notNull(),
  },
  (t) => [check("commerce_commission_amount", sql`${t.amountCents} between 0 and 5000000000000`)],
);

/** Every journal balances to zero; migrations reject UPDATE/DELETE even for the owner. */
export const commerceLedger = pgTable(
  "commerce_ledger",
  {
    id: id(),
    eventKey: text("event_key").notNull(),
    line: integer("line").notNull(),
    ownerId: text("owner_id").notNull(),
    account: text("account").notNull(),
    amountCents: money("amount_cents").notNull(),
    currency: text("currency").notNull().default("CAD"),
    mode: text("mode").notNull().default("test"),
    resourceId: text("resource_id").notNull(),
    createdAt: date("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("commerce_ledger_event_line").on(t.eventKey, t.line),
    index("commerce_ledger_owner_idx").on(t.ownerId, t.account),
    check(
      "commerce_ledger_money",
      sql`${t.amountCents} between -9007199254740991 and 9007199254740991 and ${t.amountCents}<>0 and ${t.currency}='CAD' and ${t.mode}='test'`,
    ),
  ],
);

export const commerceOperations = pgTable(
  "commerce_operations",
  {
    id: id(),
    actorId: text("actor_id").notNull(),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    resourceId: uuid("resource_id").notNull(),
    createdAt: date("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("commerce_operation_idempotency").on(t.actorId, t.kind, t.key)],
);

export const commerceWithdrawals = pgTable(
  "commerce_withdrawals",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => commerceCustomers.userId),
    amountCents: money("amount_cents").notNull(),
    status: text("status").$type<CommerceWithdrawalStatus>().notNull().default("requested"),
    reference: text("reference").unique(),
    reason: text("reason"),
    approvedBy: uuid("approved_by"),
    recordedBy: uuid("recorded_by"),
    paymentOperationId: uuid("payment_operation_id").unique(),
    paymentStartedBy: uuid("payment_started_by"),
    paymentStartedAt: date("payment_started_at"),
    paymentUnknownAt: date("payment_unknown_at"),
    paymentConfirmedAt: date("payment_confirmed_at"),
    paymentEvidenceReference: text("payment_evidence_reference"),
    createdAt: date("created_at").defaultNow().notNull(),
    updatedAt: date("updated_at").defaultNow().notNull(),
  },
  (t) => [
    check("commerce_withdrawal_amount", sql`${t.amountCents} between 2000 and 9007199254740991`),
    check(
      "commerce_withdrawal_status",
      sql`${t.status} in ('requested','approved','payment_pending','payment_unknown','paid_test','rejected')`,
    ),
    check(
      "commerce_withdrawal_payment_identity",
      sql`(
        (${t.paymentOperationId} is null and ${t.paymentStartedBy} is null and ${t.paymentStartedAt} is null and ${t.paymentUnknownAt} is null and ${t.paymentConfirmedAt} is null and ${t.paymentEvidenceReference} is null and ${t.status} not in ('payment_pending','payment_unknown'))
        or (${t.paymentOperationId} is not null and ${t.paymentStartedBy} is not null and ${t.paymentStartedAt} is not null and ${t.approvedBy} is not null and ${t.paymentStartedBy}<>${t.approvedBy} and ${t.paymentStartedBy}<>${t.userId} and (
          (${t.status} in ('payment_pending','payment_unknown') and ${t.reference} is null and ${t.recordedBy} is null and ${t.paymentConfirmedAt} is null and ${t.paymentEvidenceReference} is null and ((${t.status}='payment_pending' and ${t.paymentUnknownAt} is null) or (${t.status}='payment_unknown' and ${t.paymentUnknownAt} is not null and ${t.paymentUnknownAt}>=${t.paymentStartedAt})))
          or (${t.status}='paid_test' and ${t.reference} is not null and ${t.reference}=btrim(${t.reference}) and char_length(${t.reference}) between 1 and 150 and ${t.recordedBy} is not null and ${t.recordedBy}<>${t.approvedBy} and ${t.recordedBy}<>${t.userId} and ${t.paymentConfirmedAt} is not null and ${t.paymentConfirmedAt}>=${t.paymentStartedAt} and ${t.paymentEvidenceReference} is not null and ${t.paymentEvidenceReference}=btrim(${t.paymentEvidenceReference}) and char_length(${t.paymentEvidenceReference}) between 1 and 500 and ${t.reason} is not null and ${t.reason}=btrim(${t.reason}) and char_length(${t.reason}) between 1 and 500 and (${t.paymentUnknownAt} is null or (${t.paymentUnknownAt}>=${t.paymentStartedAt} and ${t.paymentConfirmedAt}>=${t.paymentUnknownAt})))
        ))
      )`,
    ),
    uniqueIndex("commerce_withdrawal_one_processing")
      .on(t.userId)
      .where(sql`${t.status} in ('requested','approved','payment_pending','payment_unknown')`),
  ],
);
