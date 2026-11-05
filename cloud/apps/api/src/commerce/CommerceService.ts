import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import {
  assertBalancedCommerceJournal,
  assertCommerceReferralBinding,
  calculateCommerceCommission,
  canReleaseCommerceCommission,
  commerceMoney,
  commerceRefundCommission,
  commerceWithdrawalPaymentTransition,
  COMMERCE_ACTIVE_WITHDRAWAL_STATUSES,
} from "@djl/domain";
import type {
  CommerceAddress,
  CommerceCatalogResponse,
  CommerceFavoritesResponse,
  CommerceFavoriteResponse,
  CommerceOrder,
  CommerceOrderRecoveryResponse,
  CommerceProfile,
  CommerceReferralSummary,
  CommerceWallet,
  CommerceWithdrawal,
  CommerceAdminOrder,
  CommerceAdminWithdrawal,
  CommerceConfirmWithdrawalPaymentInput,
  CommerceOrderAttentionReason,
  CommerceSupplierStatement,
  CommerceSupplierPaymentDocument,
  CommerceSupplierPaymentDocumentInput,
  CommerceSupplierPaymentDocumentMetadata,
  CommerceSupplierPaymentDocumentsResponse,
  CommerceSupplierPaymentDocumentResponse,
  CommerceSupplierIssue,
  CommerceSupplierMemberList,
  CommerceBuyerReturnRequest,
  CommerceCaseHandling,
  CommerceBuyerAfterSalesStatus,
} from "@synara/contracts/cloud";
import { ApiError } from "../http/errors.ts";
import { parseCommerceCsv } from "./csv.ts";
import {
  commerceProductImageUrl,
  CommerceMediaPolicyError,
  type CommerceMediaPolicy,
} from "./commerceMediaPolicy.ts";

export type CommerceTransaction = Parameters<Parameters<DjlDatabase["transaction"]>[0]>[0];
type Tx = CommerceTransaction;
export interface CommerceActor {
  readonly id: string;
  readonly type: "user" | "admin" | "system";
  readonly traceId: string;
}
export interface CommerceOptions {
  readonly mode: "test" | "disabled";
  readonly environment: "local" | "test" | "staging" | "production";
  readonly now?: () => Date;
  readonly checkoutPaused?: boolean;
  readonly withdrawalsPaused?: boolean;
  readonly supplierPaymentDocumentsEnabled?: boolean;
  readonly paymentProvider?: "simulation" | "stripe_test";
  readonly mediaPolicy?: CommerceMediaPolicy;
}
type JournalLine = { ownerId: string; account: string; amountCents: number };
const {
  commerceCustomers: customers,
  commerceSuppliers: suppliers,
  commerceSupplierMembers: members,
  commerceSupplierPaymentDocuments: supplierPaymentDocuments,
  commerceProducts: products,
  commerceFavorites: favorites,
  commerceOrders: orders,
  commerceOrderItems: items,
  commerceCommissions: commissions,
  commerceLedger: ledger,
  commerceOperations: operations,
  commerceWithdrawals: withdrawals,
} = schema;
const fail = (status: number, code: string, message: string): never => {
  throw new ApiError(status, code, message);
};
const checkoutOperation = "order.create";
// Share the create operation key so older servers also reject late submissions. Never a SHA-256.
const closedCheckoutFingerprint = "checkout-attempt-closed-v1";
const provinces = new Set([
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
]);
export function commerceText(value: unknown, name: string, maximum = 200): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum)
    return fail(
      400,
      "bad_request",
      `${name} is required and must be at most ${maximum} characters.`,
    );
  return value.trim();
}
export function commerceId(value: unknown): string {
  const id = commerceText(value, "id", 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    return fail(400, "bad_request", "Invalid id.");
  return id;
}
export function commerceInteger(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
    return fail(400, "bad_request", `${name} must be an integer from ${min} to ${max}.`);
  return value;
}
export function commercePage(value: unknown = 0): number {
  return commerceInteger(
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
    "page",
    0,
    10000,
  );
}
function statementInstant(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)
  )
    return fail(400, "bad_request", `${name} must be an ISO UTC timestamp ending in Z.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19))
    return fail(400, "bad_request", `Invalid ${name} timestamp.`);
  // Preserve microseconds for the database; Date.toISOString() would truncate this paging boundary.
  return value;
}
function statementInteger(value: unknown): number {
  if (typeof value !== "string" || !/^-?\d+$/.test(value))
    return fail(
      500,
      "commerce_statement_amount_invalid",
      "Statement amounts could not be represented exactly.",
    );
  const amount = BigInt(value);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || amount < BigInt(Number.MIN_SAFE_INTEGER))
    return fail(
      500,
      "commerce_statement_amount_overflow",
      "Statement totals exceed safe integer cents.",
    );
  return Number(amount);
}
function referralAggregateInteger(value: unknown): number {
  const amount = typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(amount) || amount < 0 || String(amount) !== value)
    throw new Error("Invalid referral aggregate.");
  return amount;
}
/** Cost allocation uses integer arithmetic: quantity × price × cost can exceed float precision. */
export function commerceRemainingSupplierCost(
  goodsCents: number,
  refundedCents: number,
  priceCents: number,
  costCents: number,
): number {
  const remaining = BigInt(commerceMoney(goodsCents)) - BigInt(commerceMoney(refundedCents));
  commerceInteger(priceCents, "priceCents", 1, 100000000);
  commerceInteger(costCents, "costCents", 0, priceCents);
  if (remaining < 0n) return fail(400, "bad_request", "Invalid supplier cost allocation.");
  return Number((remaining * BigInt(costCents)) / BigInt(priceCents));
}
export function commerceAddress(value: unknown): CommerceAddress {
  if (!value || typeof value !== "object")
    return fail(400, "bad_request", "Canadian address required.");
  const v = value as Record<string, unknown>;
  if (v.country !== "CA") return fail(400, "unsupported_country", "Only Canada is supported.");
  const province = commerceText(v.province, "province", 2).toUpperCase();
  const postalCode = commerceText(v.postalCode, "postalCode", 7).toUpperCase().replace(/\s/g, "");
  if (
    !provinces.has(province) ||
    !/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(postalCode)
  )
    return fail(400, "bad_request", "Invalid Canadian province or postal code.");
  return {
    name: commerceText(v.name, "name", 100),
    line1: commerceText(v.line1, "line1"),
    city: commerceText(v.city, "city", 100),
    province,
    postalCode,
    country: "CA",
  };
}
export function commerceImageUrl(value: unknown): string {
  return productImageUrl(value, "draft");
}
function productImageUrl(
  value: unknown,
  status: "draft" | "published" | "archived",
  policy?: CommerceMediaPolicy,
): string {
  try {
    return commerceProductImageUrl(value, status, policy);
  } catch (error) {
    if (error instanceof CommerceMediaPolicyError)
      return fail(
        error.code === "media_configuration_invalid" ? 503 : 400,
        error.code,
        error.message,
      );
    throw error;
  }
}
const keyOf = (key: unknown) => {
  const k = commerceText(key, "idempotencyKey", 100);
  if (!/^[A-Za-z0-9:_-]{8,100}$/.test(k))
    return fail(400, "bad_request", "Invalid idempotency key.");
  return k;
};
function productInput(body: Record<string, unknown>, policy?: CommerceMediaPolicy) {
  if (
    body.status !== undefined &&
    !["draft", "published", "archived"].includes(body.status as string)
  )
    fail(400, "bad_request", "Invalid product status.");
  const status = (body.status ?? "draft") as "draft" | "published" | "archived";
  const values = {
    supplierId: commerceId(body.supplierId),
    sku: commerceText(body.sku, "sku", 100),
    name: commerceText(body.name, "name", 150),
    description: commerceText(body.description, "description", 4000),
    category: commerceText(body.category, "category", 100),
    imageUrl: productImageUrl(body.imageUrl, status, policy),
    priceCents: commerceInteger(body.priceCents, "priceCents", 1, 100000000),
    costCents: commerceInteger(body.costCents, "costCents", 0, 100000000),
    commissionBps: commerceInteger(body.commissionBps, "commissionBps", 0, 10000),
    returnDays: commerceInteger(body.returnDays, "returnDays", 0, 365),
    stock: commerceInteger(body.stock, "stock", 0, 1000000),
    status,
  };
  if (values.costCents > values.priceCents) fail(400, "bad_request", "Cost exceeds price.");
  return values;
}

/** All currency below is isolated test CAD. No production gateway is selected implicitly. */
export class CommerceService {
  constructor(
    readonly db: DjlDatabase,
    readonly options: CommerceOptions,
  ) {}
  get mode(): "test" | "disabled" {
    return this.options.mode === "test" && ["local", "test"].includes(this.options.environment)
      ? "test"
      : "disabled";
  }
  get paymentProvider(): "simulation" | "stripe_test" | "disabled" {
    return this.mode === "test" ? (this.options.paymentProvider ?? "simulation") : "disabled";
  }
  paymentTransaction<T>(fn: (tx: CommerceTransaction) => Promise<T>): Promise<T> {
    this.enabled();
    return this.write(fn);
  }
  private now() {
    return this.options.now?.() ?? new Date();
  }
  private enabled() {
    if (this.mode !== "test")
      fail(
        503,
        "commerce_funds_disabled",
        "Commerce checkout and settlement are disabled. Verified production payment integration is not configured.",
      );
  }
  private async write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(async (tx) => {
        // One lock gives the small pilot a simple serializable referral graph, inventory and wallet boundary.
        // No network/payment work occurs while it is held.
        await tx.execute(sql`select pg_advisory_xact_lock(17473, 1)`);
        return fn(tx);
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Drizzle errors include bind parameters (addresses and support notes). Never pass them to HTTP logging.
      throw new ApiError(
        500,
        "commerce_write_failed",
        "Commerce operation could not be confirmed. Refresh its status before retrying.",
      );
    }
  }
  private async customer(tx: Tx, userId: string) {
    await tx
      .insert(customers)
      .values({ userId, referralCode: randomBytes(10).toString("hex") })
      .onConflictDoNothing({ target: customers.userId });
    return (await tx.select().from(customers).where(eq(customers.userId, userId)))[0]!;
  }
  private async audit(
    tx: Tx,
    actor: CommerceActor,
    action: string,
    targetId: string,
    after: unknown,
    reason?: string,
  ) {
    await tx.insert(schema.auditEvents).values({
      actorType: actor.type,
      actorId: actor.id,
      action: `commerce.${action}`,
      targetType: "commerce",
      targetId,
      after,
      reason,
      traceId: actor.traceId,
    });
  }
  private async operation(tx: Tx, actorId: string, kind: string, key: string) {
    return (
      await tx
        .select({ fingerprint: operations.fingerprint, resourceId: operations.resourceId })
        .from(operations)
        .where(
          and(eq(operations.actorId, actorId), eq(operations.kind, kind), eq(operations.key, key)),
        )
    )[0];
  }
  private async once(
    tx: Tx,
    actor: CommerceActor,
    kind: string,
    key: unknown,
    body: unknown,
    work: () => Promise<string>,
    prepare?: () => Promise<void>,
  ) {
    const k = keyOf(key);
    const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const prior = await this.operation(tx, actor.id, kind, k);
    if (kind === checkoutOperation && prior?.fingerprint === closedCheckoutFingerprint)
      fail(
        409,
        "checkout_attempt_closed",
        "This checkout attempt was closed. Start a new checkout.",
      );
    if (prior && prior.fingerprint !== fingerprint)
      fail(409, "idempotency_conflict", "This key was already used for a different operation.");
    await prepare?.();
    if (prior) return prior.resourceId;
    const resourceId = await work();
    await tx
      .insert(operations)
      .values({ actorId: actor.id, kind, key: k, fingerprint, resourceId });
    return resourceId;
  }
  private async journal(tx: Tx, eventKey: string, resourceId: string, lines: JournalLine[]) {
    const nonzero = lines.filter((line) => line.amountCents !== 0);
    if (!nonzero.length) return;
    assertBalancedCommerceJournal(nonzero.map((line) => ({ ...line, currency: "CAD" })));
    await tx.insert(ledger).values(
      nonzero.map((line, i) => ({
        ownerId: line.ownerId,
        account: line.account,
        amountCents: line.amountCents,
        eventKey,
        resourceId,
        line: i,
        currency: "CAD",
        mode: "test",
      })),
    );
  }
  private async walletIn(tx: Tx | DjlDatabase, userId: string): Promise<CommerceWallet> {
    // One statement sees one MVCC snapshot, even when a concurrent journal moves funds between accounts.
    const rows = await tx
      .select({ account: ledger.account, amount: sql<string>`sum(${ledger.amountCents})::text` })
      .from(ledger)
      .where(
        and(
          eq(ledger.ownerId, userId),
          inArray(ledger.account, ["pending", "available", "frozen", "paid", "recovery"]),
        ),
      )
      .groupBy(ledger.account);
    const amounts = new Map<string, number>();
    for (const row of rows) {
      const amount = Number(row.amount);
      if (!Number.isSafeInteger(amount))
        return fail(500, "ledger_overflow", "Ledger amount is out of range.");
      amounts.set(row.account, amount);
    }
    return {
      pendingCents: amounts.get("pending") ?? 0,
      availableCents: amounts.get("available") ?? 0,
      frozenCents: amounts.get("frozen") ?? 0,
      paidCents: amounts.get("paid") ?? 0,
      recoveryCents: amounts.get("recovery") ? -amounts.get("recovery")! : 0,
    };
  }
  async wallet(userId: string) {
    return this.walletIn(this.db, userId);
  }
  async ledgerEntries(userId?: string, page: unknown = 0) {
    const current = commercePage(page);
    const rows = await this.db
      .select()
      .from(ledger)
      .where(userId ? eq(ledger.ownerId, userId) : undefined)
      .orderBy(sql`${ledger.createdAt} desc`, sql`${ledger.id} desc`)
      .limit(101)
      .offset(current * 100);
    return {
      page: current,
      hasMore: rows.length > 100,
      entries: rows.slice(0, 100).map((row) => ({
        id: row.id,
        eventKey: row.eventKey,
        line: row.line,
        ownerId: row.ownerId,
        account: row.account,
        amountCents: row.amountCents,
        currency: row.currency,
        mode: row.mode,
        resourceId: row.resourceId,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
  private async expireIn(tx: Tx) {
    const expired = await tx
      .select()
      .from(orders)
      .where(
        and(
          or(
            eq(orders.paymentProvider, "simulation"),
            sql`not exists(select 1 from commerce_payment_attempts p where p.order_id=${orders.id})`,
          ),
          eq(orders.status, "awaiting_payment"),
          sql`${orders.expiresAt} <= ${this.now().toISOString()}::timestamptz`,
        ),
      );
    for (const order of expired) {
      const lines = await tx.select().from(items).where(eq(items.orderId, order.id));
      for (const line of lines)
        await tx
          .update(products)
          .set({ reserved: sql`${products.reserved}-${line.quantity}` })
          .where(eq(products.id, line.productId));
      await tx.update(orders).set({ status: "cancelled" }).where(eq(orders.id, order.id));
      await tx.update(items).set({ status: "cancelled" }).where(eq(items.orderId, order.id));
    }
  }
  /** Test payments have no asynchronous channel outcome; expired reservations are safe to release. */
  async expireReservations() {
    await this.write((tx) => this.expireIn(tx));
  }
  async catalog(): Promise<CommerceCatalogResponse> {
    await this.expireReservations();
    return this.catalogSnapshot();
  }

  /** Trusted read-only projection; unlike catalog(), this never expires reservations. */
  async catalogSnapshot(): Promise<CommerceCatalogResponse> {
    const rows = await this.db
      .select({ product: products })
      .from(products)
      .innerJoin(suppliers, eq(suppliers.id, products.supplierId))
      .where(and(eq(products.status, "published"), eq(suppliers.active, true)))
      .orderBy(products.createdAt)
      .limit(1000);
    return {
      paymentProvider: this.paymentProvider,
      checkoutPaused: this.options.checkoutPaused ?? false,
      products: rows.map(({ product: p }) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        category: p.category,
        imageUrl: p.imageUrl,
        priceCents: p.priceCents,
        stock: p.stock - p.reserved,
        commissionBps: p.commissionBps,
        returnDays: p.returnDays,
      })),
      currency: "CAD",
      mode: this.mode,
    };
  }
  async favorites(userId: string): Promise<CommerceFavoritesResponse> {
    const rows = await this.db
      .select({ productId: favorites.productId })
      .from(favorites)
      .where(eq(favorites.userId, commerceId(userId)))
      .orderBy(sql`${favorites.createdAt} desc`, favorites.productId)
      .limit(1000);
    return { userId, productIds: rows.map((row) => row.productId) };
  }
  async setFavorite(
    actor: CommerceActor,
    productId: string,
    saved: unknown,
    expectedUserId: unknown,
  ): Promise<CommerceFavoriteResponse> {
    if (actor.type !== "user") fail(403, "forbidden", "Buyer account required.");
    // A session may rotate while the browser waits for CSRF. Never write to the later account.
    if (expectedUserId !== actor.id)
      fail(401, "commerce_account_changed", "Commerce account changed. Sign in again.");
    const id = commerceId(productId);
    if (typeof saved !== "boolean") fail(400, "bad_request", "saved must be a boolean.");
    const desired = saved === true;
    return this.write(async (tx) => {
      if (desired) {
        const available = await tx
          .select({ id: products.id })
          .from(products)
          .innerJoin(suppliers, eq(suppliers.id, products.supplierId))
          .where(
            and(eq(products.id, id), eq(products.status, "published"), eq(suppliers.active, true)),
          );
        if (!available.length) fail(404, "product_not_found", "Product is not available.");
        const current = await tx
          .select({ productId: favorites.productId })
          .from(favorites)
          .where(eq(favorites.userId, actor.id));
        if (current.length >= 1000 && !current.some((row) => row.productId === id))
          fail(409, "favorites_limit", "At most 1000 favorites may be saved.");
        await tx
          .insert(favorites)
          .values({ userId: actor.id, productId: id })
          .onConflictDoNothing({ target: [favorites.userId, favorites.productId] });
      } else {
        // Removal remains possible after archival or supplier suspension; scope is always the buyer.
        await tx
          .delete(favorites)
          .where(and(eq(favorites.userId, actor.id), eq(favorites.productId, id)));
      }
      return { userId: actor.id, productId: id, saved: desired };
    });
  }
  async profile(userId: string): Promise<CommerceProfile> {
    const c = await this.write((tx) => this.customer(tx, userId));
    const memberships = await this.db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(members)
      .innerJoin(suppliers, eq(suppliers.id, members.supplierId))
      .where(and(eq(members.userId, userId), eq(suppliers.active, true)));
    return {
      withdrawalsPaused: this.options.withdrawalsPaused ?? false,
      referralCode: c.referralCode,
      referrerId: c.referrerId,
      firstPaidAt: c.firstPaidAt?.toISOString() ?? null,
      wallet: await this.wallet(userId),
      suppliers: memberships,
    };
  }
  async referralSummary(userId: string): Promise<CommerceReferralSummary> {
    const owner = commerceId(userId);
    try {
      // One statement gives binding and current commission figures the same committed snapshot.
      const [row] = await this.db.execute<{
        directBuyers: string;
        ordersWithCommission: string;
        netCommissionCents: string;
      }>(sql`
        select
          (select count(*)::text from ${customers} where ${customers.referrerId}=${owner}::uuid) as "directBuyers",
          count(distinct ${orders.id})::text as "ordersWithCommission",
          coalesce(sum(${commissions.amountCents}),0)::text as "netCommissionCents"
        from ${commissions}
        inner join ${items} on ${items.id}=${commissions.orderItemId}
        inner join ${orders} on ${orders.id}=${items.orderId}
        where ${commissions.userId}=${owner}::uuid and ${orders.referrerId}=${owner}::uuid
          and ${orders.userId}<>${owner}::uuid and ${orders.paidAt} is not null
          and ${orders.status} in ('paid','refunded') and ${orders.mode}='test' and ${orders.currency}='CAD'
          and ${commissions.amountCents}>0
      `);
      return {
        mode: "test",
        currency: "CAD",
        directBuyers: referralAggregateInteger(row?.directBuyers),
        ordersWithCommission: referralAggregateInteger(row?.ordersWithCommission),
        netCommissionCents: referralAggregateInteger(row?.netCommissionCents),
      };
    } catch {
      return fail(
        503,
        "commerce_referral_summary_unavailable",
        "Referral statistics are unavailable.",
      );
    }
  }
  async bindReferral(actor: CommerceActor, code: unknown) {
    const referralCode = commerceText(code, "code", 40);
    await this.write(async (tx) => {
      const c = await this.customer(tx, actor.id);
      const unresolved = await tx
        .select({ id: schema.commercePaymentAttempts.id })
        .from(schema.commercePaymentAttempts)
        .innerJoin(orders, eq(orders.id, schema.commercePaymentAttempts.orderId))
        .where(
          and(
            eq(orders.userId, actor.id),
            inArray(schema.commercePaymentAttempts.status, [
              "creating",
              "open",
              "unknown",
              "cancel_requested",
              "requires_review",
            ]),
          ),
        )
        .limit(1);
      if (!c.referrerId && unresolved.length)
        fail(
          409,
          "commerce_payment_unresolved",
          "Finish or definitively cancel your pending payment before binding a recommendation. Eligibility is not permanently changed.",
        );
      const referrer = (
        await tx.select().from(customers).where(eq(customers.referralCode, referralCode))
      )[0];
      if (!referrer) fail(404, "referral_not_found", "Recommendation code not found.");
      const chain = await tx
        .select({ userId: customers.userId, referrerId: customers.referrerId })
        .from(customers);
      try {
        assertCommerceReferralBinding(
          {
            userId: c.userId,
            referrerId: referrer!.userId,
            currentReferrerId: c.referrerId,
            firstPaidAt: c.firstPaidAt,
          },
          new Map(chain.map((row) => [row.userId, row.referrerId])),
        );
      } catch (e) {
        fail(409, "referral_locked", e instanceof Error ? e.message : "Referral cannot be bound.");
      }
      if (!c.referrerId) {
        await tx
          .update(customers)
          .set({ referrerId: referrer!.userId })
          .where(eq(customers.userId, actor.id));
        await this.audit(tx, actor, "referral.bind", actor.id, { referrerId: referrer!.userId });
      }
    });
    return this.profile(actor.id);
  }
  private async orderIn(tx: Tx | DjlDatabase, id: string, userId?: string): Promise<CommerceOrder> {
    const rows = await tx
      .select({
        order: orders,
        item: items,
        // One SQL snapshot pairs the authoritative flag with narrowly correlated audit evidence.
        // Transaction timestamps/random audit IDs do not identify causal support rounds.
        afterSalesStatus: sql<CommerceBuyerAfterSalesStatus>`case
          when ${items.openCase} then 'open'
          when exists(select 1 from audit_events a
            where a.target_type='commerce' and a.target_id=${items.id}::text
              and a.action='commerce.item.case' and a.actor_type='admin'
              and btrim(a.actor_id)<>'' and jsonb_typeof(a.after)='object'
              and a.after->'open'='false'::jsonb) then 'closed'
          when exists(select 1 from audit_events a
            where a.target_type='commerce' and a.target_id=${items.id}::text and (
              (a.action='commerce.item.return-request' and a.actor_type='user' and a.actor_id=${orders.userId}::text)
              or (a.action='commerce.item.case' and a.actor_type='admin')
              or (a.action='commerce.supplier.issue' and a.actor_type='user')
            )) then 'unconfirmed'
          else 'none' end`,
      })
      .from(orders)
      .leftJoin(items, eq(items.orderId, orders.id))
      .where(userId ? and(eq(orders.id, id), eq(orders.userId, userId)) : eq(orders.id, id))
      .orderBy(items.id);
    const order = rows[0]?.order;
    if (!order) return fail(404, "order_not_found", "Order not found.");
    const lines = rows.flatMap((row) =>
      row.item ? [{ line: row.item, afterSalesStatus: row.afterSalesStatus }] : [],
    );
    return {
      ...order,
      createdAt: order.createdAt.toISOString(),
      expiresAt: order.expiresAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      items: lines.map(({ line, afterSalesStatus }) => ({
        id: line.id,
        productId: line.productId,
        sku: line.sku,
        name: line.name,
        quantity: line.quantity,
        priceCents: line.priceCents,
        lineCents: line.lineCents,
        refundedCents: line.refundedCents,
        status: line.status,
        carrier: line.carrier,
        trackingNumber: line.trackingNumber,
        deliveredAt: line.deliveredAt?.toISOString() ?? null,
        openCase: line.openCase,
        afterSalesStatus,
        returnDays: line.returnDays,
      })),
    };
  }
  private async supplierIssuesIn(tx: Tx | DjlDatabase, itemIds: readonly string[]) {
    const result = new Map<string, CommerceSupplierIssue>();
    if (!itemIds.length) return result;
    const rows = await tx
      .selectDistinctOn([schema.auditEvents.targetId], {
        itemId: schema.auditEvents.targetId,
        after: schema.auditEvents.after,
        createdAt: schema.auditEvents.createdAt,
      })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.action, "commerce.supplier.issue"),
          eq(schema.auditEvents.targetType, "commerce"),
          inArray(schema.auditEvents.targetId, [...new Set(itemIds)]),
        ),
      )
      .orderBy(
        schema.auditEvents.targetId,
        sql`${schema.auditEvents.createdAt} desc`,
        sql`${schema.auditEvents.id} desc`,
      );
    for (const row of rows) {
      if (!row.after || typeof row.after !== "object") continue;
      const after = row.after as Record<string, unknown>;
      if (
        (after.kind !== "out_of_stock" && after.kind !== "delay" && after.kind !== "other") ||
        typeof after.reason !== "string"
      )
        continue;
      result.set(row.itemId, {
        kind: after.kind,
        reason: after.reason,
        reportedAt: row.createdAt.toISOString(),
      });
    }
    return result;
  }
  private async supportContextIn(tx: Tx | DjlDatabase, itemIds: readonly string[]) {
    const result = new Map<
      string,
      { returnRequest?: CommerceBuyerReturnRequest; caseHandling?: CommerceCaseHandling }
    >();
    if (!itemIds.length) return result;
    const rows = await tx
      .selectDistinctOn([schema.auditEvents.targetId, schema.auditEvents.action], {
        itemId: schema.auditEvents.targetId,
        action: schema.auditEvents.action,
        actorType: schema.auditEvents.actorType,
        actorId: schema.auditEvents.actorId,
        reason: schema.auditEvents.reason,
        after: schema.auditEvents.after,
        createdAt: schema.auditEvents.createdAt,
      })
      .from(schema.auditEvents)
      .where(
        and(
          inArray(schema.auditEvents.action, [
            "commerce.item.return-request",
            "commerce.item.case",
          ]),
          eq(schema.auditEvents.targetType, "commerce"),
          inArray(schema.auditEvents.targetId, [...new Set(itemIds)]),
        ),
      )
      .orderBy(
        schema.auditEvents.targetId,
        schema.auditEvents.action,
        sql`${schema.auditEvents.createdAt} desc`,
        sql`${schema.auditEvents.id} desc`,
      );
    for (const row of rows) {
      if (!row.after || typeof row.after !== "object") continue;
      const after = row.after as Record<string, unknown>;
      const context = result.get(row.itemId) ?? {};
      if (row.action === "commerce.item.return-request" && row.actorType === "user") {
        if (typeof after.reason !== "string" || !after.reason.trim()) continue;
        context.returnRequest = {
          reason: after.reason,
          requestedAt: row.createdAt.toISOString(),
        };
      } else if (
        row.action === "commerce.item.case" &&
        row.actorType === "admin" &&
        row.actorId &&
        typeof after.open === "boolean"
      ) {
        context.caseHandling = {
          open: after.open,
          reason: row.reason?.trim() || null,
          handledBy: row.actorId,
          handledAt: row.createdAt.toISOString(),
        };
      }
      result.set(row.itemId, context);
    }
    return result;
  }
  async listOrders(userId: string, page: unknown = 0) {
    const current = commercePage(page);
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(sql`${orders.createdAt} desc`, sql`${orders.id} desc`)
      .limit(101)
      .offset(current * 100);
    return {
      orders: await Promise.all(
        rows.slice(0, 100).map((row) => this.orderIn(this.db, row.id, userId)),
      ),
      page: current,
      hasMore: rows.length > 100,
    };
  }
  async createOrder(actor: CommerceActor, body: Record<string, unknown>) {
    this.enabled();
    if (body.expectedUserId !== undefined && body.expectedUserId !== actor.id)
      fail(401, "commerce_account_changed", "Commerce account changed. Sign in again.");
    const address = commerceAddress(body.address);
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 50)
      fail(400, "bad_request", "Choose from 1 to 50 distinct SKUs.");
    const requested = (body.items as Record<string, unknown>[])
      .map((item) => ({
        productId: commerceId(item?.productId),
        quantity: commerceInteger(item?.quantity, "quantity", 1, 1000),
      }))
      .toSorted((a, b) => a.productId.localeCompare(b.productId));
    if (new Set(requested.map((i) => i.productId)).size !== requested.length)
      fail(400, "bad_request", "Duplicate SKU.");
    return this.write(async (tx) => {
      const id = await this.once(
        tx,
        actor,
        checkoutOperation,
        body.idempotencyKey,
        { requested, address },
        async () => {
          if (this.options.checkoutPaused)
            fail(
              503,
              "commerce_checkout_paused",
              "New orders are temporarily paused. Existing orders and support remain available.",
            );
          const c = await this.customer(tx, actor.id);
          const [open] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(orders)
            .where(and(eq(orders.userId, actor.id), eq(orders.status, "awaiting_payment")));
          if (open!.count >= 20) fail(429, "order_limit", "At most 20 unpaid orders are allowed.");
          const selected = await tx
            .select({ product: products })
            .from(products)
            .innerJoin(suppliers, eq(suppliers.id, products.supplierId))
            .where(
              and(
                inArray(
                  products.id,
                  requested.map((i) => i.productId),
                ),
                eq(products.status, "published"),
                eq(suppliers.active, true),
              ),
            );
          const snapshots = requested.map((input) => {
            const product = selected.find((row) => row.product.id === input.productId)?.product;
            if (!product || product.stock - product.reserved < input.quantity)
              return fail(409, "out_of_stock", "A selected product is unavailable.");
            return { product, input, lineCents: product.priceCents * input.quantity };
          });
          const totalCents = commerceMoney(
            snapshots.reduce((sum, line) => sum + line.lineCents, 0),
          );
          const [order] = await tx
            .insert(orders)
            .values({
              userId: actor.id,
              paymentProvider: this.options.paymentProvider ?? "simulation",
              referrerId: c.referrerId,
              totalCents,
              address,
              expiresAt: new Date(this.now().getTime() + 30 * 60_000),
            })
            .returning();
          for (const { product, input, lineCents } of snapshots) {
            await tx
              .update(products)
              .set({ reserved: product.reserved + input.quantity })
              .where(eq(products.id, product.id));
            await tx.insert(items).values({
              orderId: order!.id,
              productId: product.id,
              supplierId: product.supplierId,
              name: product.name,
              sku: product.sku,
              quantity: input.quantity,
              priceCents: product.priceCents,
              costCents: product.costCents,
              lineCents,
              commissionBps: product.commissionBps,
              returnDays: product.returnDays,
            });
          }
          await this.audit(tx, actor, "order.create", order!.id, { totalCents, mode: "test" });
          return order!.id;
        },
        async () => {
          // Check idempotency first. Closed keys and paused replays must not run maintenance.
          if (!this.options.checkoutPaused) {
            await this.expireIn(tx);
            await this.customer(tx, actor.id);
          }
        },
      );
      return { order: await this.orderIn(tx, id, actor.id) };
    });
  }
  async recoverOrder(
    actor: CommerceActor,
    body: Record<string, unknown>,
  ): Promise<CommerceOrderRecoveryResponse> {
    this.enabled();
    if (actor.type !== "user") fail(403, "forbidden", "Buyer account required.");
    const { expectedUserId, idempotencyKey } = body;
    if (
      Object.keys(body).length !== 2 ||
      !Object.hasOwn(body, "expectedUserId") ||
      !Object.hasOwn(body, "idempotencyKey") ||
      typeof expectedUserId !== "string" ||
      typeof idempotencyKey !== "string" ||
      idempotencyKey.length !== 36 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        idempotencyKey,
      )
    )
      return fail(400, "bad_request", "Recovery requires an account and a canonical checkout key.");
    if (expectedUserId !== actor.id)
      fail(401, "commerce_account_changed", "Commerce account changed. Sign in again.");
    return this.write(async (tx) => {
      const prior = await this.operation(tx, actor.id, checkoutOperation, idempotencyKey);
      if (prior)
        return prior.fingerprint === closedCheckoutFingerprint
          ? { status: "closed" }
          : { status: "found", order: await this.orderIn(tx, prior.resourceId, actor.id) };
      const now = this.now();
      const recent = await tx
        .select({ id: operations.id })
        .from(operations)
        .where(
          and(
            eq(operations.actorId, actor.id),
            eq(operations.kind, checkoutOperation),
            eq(operations.fingerprint, closedCheckoutFingerprint),
            gt(operations.createdAt, new Date(now.getTime() - 86_400_000)),
          ),
        )
        .limit(20);
      if (recent.length >= 20)
        fail(429, "checkout_recovery_limit", "Too many checkout attempts were closed today.");
      // The UUID column is required, but this marker does not reference or create an order.
      await tx.insert(operations).values({
        actorId: actor.id,
        kind: checkoutOperation,
        key: idempotencyKey,
        fingerprint: closedCheckoutFingerprint,
        resourceId: idempotencyKey,
        createdAt: now,
      });
      return { status: "closed" };
    });
  }
  async settleTestPaymentIn(
    tx: CommerceTransaction,
    actor: CommerceActor,
    id: string,
    choice: { provider: "simulation" } | { provider: "stripe_test"; referrerId: string | null },
  ) {
    this.enabled();
    const order = (await tx.select().from(orders).where(eq(orders.id, id)))[0]!;
    if (order.paymentProvider !== choice.provider)
      fail(
        409,
        "commerce_payment_provider_mismatch",
        "This payment must be settled by its configured provider.",
      );
    if (order.status === "paid" || order.status === "refunded") return id;
    if (
      order.status !== "awaiting_payment" ||
      (choice.provider === "simulation" && order.expiresAt <= this.now())
    )
      fail(409, "order_not_payable", "Order is no longer payable.");
    const c = await this.customer(tx, order.userId);
    // The last opportunity to bind is first successful payment, including an order created before binding.
    const referrerId = choice.provider === "stripe_test" ? choice.referrerId : c.referrerId;
    const lines = await tx.select().from(items).where(eq(items.orderId, id));
    const entries: JournalLine[] = [
      { ownerId: "platform", account: "cash_test", amountCents: order.totalCents },
      { ownerId: "platform", account: "sales_test", amountCents: -order.totalCents },
    ];
    for (const line of lines) {
      const p = (await tx.select().from(products).where(eq(products.id, line.productId)))[0]!;
      if (p.reserved < line.quantity || p.stock < line.quantity)
        fail(409, "inventory_conflict", "Reserved stock is not available.");
      await tx
        .update(products)
        .set({ stock: p.stock - line.quantity, reserved: p.reserved - line.quantity })
        .where(eq(products.id, p.id));
      const cost = line.costCents * line.quantity;
      entries.push(
        { ownerId: line.supplierId, account: "supplier_payable", amountCents: cost },
        { ownerId: "platform", account: "goods_cost_test", amountCents: -cost },
      );
      if (referrerId && referrerId !== order.userId) {
        const amount = calculateCommerceCommission(line.lineCents, line.commissionBps);
        await tx
          .insert(commissions)
          .values({ orderItemId: line.id, userId: referrerId, amountCents: amount });
        entries.push(
          { ownerId: referrerId, account: "pending", amountCents: amount },
          { ownerId: "platform", account: "commission_cost_test", amountCents: -amount },
        );
      }
    }
    await this.journal(tx, `paid:${id}`, id, entries);
    await tx
      .update(orders)
      .set({ status: "paid", paidAt: this.now(), referrerId })
      .where(eq(orders.id, id));
    if (!c.firstPaidAt)
      await tx
        .update(customers)
        .set({ firstPaidAt: this.now() })
        .where(eq(customers.userId, order.userId));
    await this.audit(tx, actor, "order.test-paid", id, {
      mode: "test",
      totalCents: order.totalCents,
    });
    return id;
  }
  async testPay(actor: CommerceActor, id: string, key: unknown) {
    this.enabled();
    commerceId(id);
    return this.write(async (tx) => {
      await this.orderIn(tx, id, actor.id);
      await this.once(tx, actor, "order.test-pay", key, { id }, async () => {
        return this.settleTestPaymentIn(tx, actor, id, { provider: "simulation" });
      });
      return { order: await this.orderIn(tx, id, actor.id) };
    });
  }
  async cancelOrder(actor: CommerceActor, id: string, key: unknown) {
    this.enabled();
    commerceId(id);
    return this.write(async (tx) => {
      const order = await this.orderIn(tx, id, actor.id);
      if (
        order.paymentProvider !== "simulation" &&
        (
          await tx
            .select({ id: schema.commercePaymentAttempts.id })
            .from(schema.commercePaymentAttempts)
            .where(eq(schema.commercePaymentAttempts.orderId, id))
            .limit(1)
        ).length
      )
        fail(
          409,
          "provider_cancel_required",
          "Cancel and reconcile the provider checkout before releasing this order's stock.",
        );
      await this.once(tx, actor, "order.cancel", key, { id }, async () => {
        if (order.status === "cancelled") return id;
        if (order.status !== "awaiting_payment")
          fail(409, "refund_required", "A paid order requires a reviewed refund.");
        for (const line of order.items)
          await tx
            .update(products)
            .set({ reserved: sql`${products.reserved}-${line.quantity}` })
            .where(eq(products.id, line.productId));
        await tx.update(orders).set({ status: "cancelled" }).where(eq(orders.id, id));
        await tx.update(items).set({ status: "cancelled" }).where(eq(items.orderId, id));
        await this.audit(tx, actor, "order.cancel", id, {});
        return id;
      });
      return { order: await this.orderIn(tx, id, actor.id) };
    });
  }
  async requestReturn(actor: CommerceActor, id: string, body: Record<string, unknown>) {
    this.enabled();
    if (actor.type !== "user") fail(403, "forbidden", "Buyer account required.");
    const orderId = commerceId(id).toLowerCase();
    let request = body;
    let operationKey: string | undefined;
    // Never interpret a malformed keyed request as a legacy mutation. Older APIs reject the
    // nested format because it deliberately has no top-level itemId or reason.
    if (
      Object.keys(body).length !== 2 ||
      !Object.hasOwn(body, "itemId") ||
      !Object.hasOwn(body, "reason")
    ) {
      const nested = body.request;
      if (
        Object.keys(body).length !== 3 ||
        !Object.hasOwn(body, "request") ||
        !Object.hasOwn(body, "idempotencyKey") ||
        !Object.hasOwn(body, "expectedUserId") ||
        !nested ||
        typeof nested !== "object" ||
        Array.isArray(nested) ||
        Object.keys(nested).length !== 2 ||
        !Object.hasOwn(nested, "itemId") ||
        !Object.hasOwn(nested, "reason")
      )
        return fail(400, "bad_request", "Invalid support request envelope.");
      const expectedUserId = commerceId(body.expectedUserId);
      operationKey = commerceId(body.idempotencyKey);
      if (
        expectedUserId.toLowerCase() !== body.expectedUserId ||
        operationKey.toLowerCase() !== body.idempotencyKey
      )
        return fail(400, "bad_request", "Support requests require canonical UUIDs.");
      if (expectedUserId !== actor.id)
        return fail(401, "commerce_account_changed", "Commerce account changed. Sign in again.");
      request = nested as Record<string, unknown>;
    }
    const itemId = commerceId(request.itemId).toLowerCase();
    const reason = commerceText(request.reason, "reason", 500);
    return this.write(async (tx) => {
      const openCase = async () => {
        const order = await this.orderIn(tx, orderId, actor.id);
        if (order.status !== "paid" && order.status !== "refunded")
          fail(409, "not_paid", "A paid order is required for a support request.");
        const line = order.items.find((item) => item.id === itemId);
        if (
          !line ||
          line.status === "cancelled" ||
          (line.refundedCents >= line.lineCents && !["shipped", "delivered"].includes(line.status))
        )
          fail(404, "not_found", "Order item not found.");
        await tx.update(items).set({ openCase: true }).where(eq(items.id, itemId));
        await this.audit(tx, actor, "item.return-request", itemId, { reason });
        return orderId;
      };
      const resourceId = operationKey
        ? await this.once(
            tx,
            actor,
            "item.return-request",
            operationKey,
            { orderId, itemId, reason },
            openCase,
          )
        : await openCase();
      return { order: await this.orderIn(tx, resourceId, actor.id) };
    });
  }
  private async offsetRecovery(tx: Tx, userId: string, eventKey: string, resourceId: string) {
    const wallet = await this.walletIn(tx, userId);
    const offset = Math.min(wallet.availableCents, wallet.recoveryCents);
    await this.journal(tx, eventKey, resourceId, [
      { ownerId: userId, account: "available", amountCents: -offset },
      { ownerId: userId, account: "recovery", amountCents: offset },
    ]);
  }
  private async withdrawalNeedsReview(tx: Tx, userId: string) {
    const rows = await tx
      .select({ id: commissions.id })
      .from(commissions)
      .innerJoin(items, eq(items.id, commissions.orderItemId))
      .leftJoin(
        schema.commercePaymentAttempts,
        eq(schema.commercePaymentAttempts.orderId, items.orderId),
      )
      .where(
        and(
          eq(commissions.userId, userId),
          eq(commissions.released, true),
          or(
            eq(items.openCase, true),
            eq(schema.commercePaymentAttempts.status, "requires_review"),
            sql`exists(select 1 from commerce_provider_refunds r where r.item_id=${items.id} and r.status in ('submitting','unknown','pending','requires_review'))`,
            sql`exists(select 1 from commerce_external_refunds e where e.order_id=${items.orderId} and e.allocation_state in ('unallocated','requires_review'))`,
          ),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
  async requestWithdrawal(actor: CommerceActor, key: unknown) {
    this.enabled();
    if (this.options.withdrawalsPaused)
      fail(
        503,
        "commerce_withdrawals_paused",
        "New withdrawals are temporarily paused. Wallet history and existing reviews remain available.",
      );
    return this.write(async (tx) => {
      await this.customer(tx, actor.id);
      const id = await this.once(tx, actor, "withdrawal.create", key, {}, async () => {
        if (await this.withdrawalNeedsReview(tx, actor.id))
          fail(
            409,
            "withdrawal_review_required",
            "A related refund or support case still requires review.",
          );
        const wallet = await this.walletIn(tx, actor.id);
        if (wallet.recoveryCents > 0 || wallet.availableCents < 2000)
          fail(
            409,
            "withdrawal_unavailable",
            "At least CAD 20 available, with no outstanding recovery, is required.",
          );
        const active = await tx
          .select()
          .from(withdrawals)
          .where(
            and(
              eq(withdrawals.userId, actor.id),
              inArray(withdrawals.status, [...COMMERCE_ACTIVE_WITHDRAWAL_STATUSES]),
            ),
          );
        if (active.length) fail(409, "withdrawal_pending", "A withdrawal is already processing.");
        const [w] = await tx
          .insert(withdrawals)
          .values({ userId: actor.id, amountCents: wallet.availableCents })
          .returning();
        await this.journal(tx, `withdraw:${w!.id}`, w!.id, [
          { ownerId: actor.id, account: "available", amountCents: -w!.amountCents },
          { ownerId: actor.id, account: "frozen", amountCents: w!.amountCents },
        ]);
        await this.audit(tx, actor, "withdrawal.request", w!.id, {
          amountCents: w!.amountCents,
          mode: "test",
        });
        return w!.id;
      });
      const row = (await tx.select().from(withdrawals).where(eq(withdrawals.id, id)))[0]!;
      return { withdrawal: this.withdrawalView(row), wallet: await this.walletIn(tx, actor.id) };
    });
  }
  private withdrawalView(row: typeof withdrawals.$inferSelect): CommerceWithdrawal {
    return {
      id: row.id,
      amountCents: row.amountCents,
      status: row.status,
      reference: row.reference,
      paymentOperationId: row.paymentOperationId,
      paymentStartedBy: row.paymentStartedBy,
      paymentStartedAt: row.paymentStartedAt?.toISOString() ?? null,
      paymentUnknownAt: row.paymentUnknownAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
  private adminWithdrawalView(row: typeof withdrawals.$inferSelect): CommerceAdminWithdrawal {
    return {
      ...this.withdrawalView(row),
      userId: row.userId,
      approvedBy: row.approvedBy,
      paymentConfirmedAt: row.paymentConfirmedAt?.toISOString() ?? null,
      paymentConfirmedBy: row.paymentConfirmedAt ? row.recordedBy : null,
      paymentEvidenceReference: row.paymentConfirmedAt ? row.paymentEvidenceReference : null,
      paymentConfirmationReason: row.paymentConfirmedAt ? row.reason : null,
    };
  }
  async listWithdrawals(userId?: string, page: unknown = 0, status: unknown = "all") {
    const current = commercePage(page);
    const statusFilter = status === undefined ? "all" : status;
    if (
      statusFilter !== "all" &&
      statusFilter !== "requested" &&
      statusFilter !== "approved" &&
      statusFilter !== "payment_pending" &&
      statusFilter !== "payment_unknown"
    )
      return fail(
        400,
        "bad_request",
        "Withdrawal status must be all or an active withdrawal state.",
      );
    const rows = await this.db
      .select()
      .from(withdrawals)
      .where(
        and(
          userId ? eq(withdrawals.userId, userId) : undefined,
          statusFilter === "all" ? undefined : eq(withdrawals.status, statusFilter),
        ),
      )
      .orderBy(sql`${withdrawals.createdAt} desc`, sql`${withdrawals.id} desc`)
      .limit(101)
      .offset(current * 100);
    return {
      statusFilter,
      page: current,
      hasMore: rows.length > 100,
      withdrawals: rows
        .slice(0, 100)
        .map((w) => (userId ? this.withdrawalView(w) : this.adminWithdrawalView(w))),
    };
  }

  async adminSuppliers() {
    return { suppliers: await this.db.select().from(suppliers).orderBy(suppliers.createdAt) };
  }
  async adminSupplierMembers(
    supplierId: string,
    page: unknown = 0,
  ): Promise<CommerceSupplierMemberList> {
    commerceId(supplierId);
    const current = commercePage(page);
    return this.db.transaction(
      async (tx) => {
        const [supplier] = await tx
          .select({ id: suppliers.id, name: suppliers.name, active: suppliers.active })
          .from(suppliers)
          .where(eq(suppliers.id, supplierId));
        if (!supplier) return fail(404, "not_found", "Supplier not found.");
        const rows = await tx
          .select({ userId: members.userId })
          .from(members)
          .where(eq(members.supplierId, supplierId))
          .orderBy(members.userId)
          .limit(101)
          .offset(current * 100);
        return { supplier, members: rows.slice(0, 100), page: current, hasMore: rows.length > 100 };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }
  async createSupplier(actor: CommerceActor, body: Record<string, unknown>) {
    if (actor.type !== "admin") fail(403, "forbidden", "Administrator authority required.");
    const name = commerceText(body.name, "name", 100);
    const returnAddress = commerceText(body.returnAddress, "returnAddress", 500);
    const reason = commerceText(body.reason, "reason", 500);
    return this.write(async (tx) => {
      const id = await this.once(
        tx,
        actor,
        "supplier.create",
        body.idempotencyKey,
        { name, returnAddress, reason },
        async () => {
          const [s] = await tx.insert(suppliers).values({ name, returnAddress }).returning();
          await this.audit(tx, actor, "supplier.create", s!.id, { name, reason }, reason);
          return s!.id;
        },
      );
      const [supplier] = await tx.select().from(suppliers).where(eq(suppliers.id, id));
      return { supplier: supplier! };
    });
  }
  async addSupplierMember(
    actor: CommerceActor,
    supplierId: string,
    userId: unknown,
    reason: unknown,
  ) {
    if (actor.type !== "admin") fail(403, "forbidden", "Administrator authority required.");
    commerceId(supplierId);
    const memberId = commerceId(userId);
    const auditReason = commerceText(reason, "reason", 500);
    return this.write(async (tx) => {
      if (!(await tx.select().from(suppliers).where(eq(suppliers.id, supplierId))).length)
        fail(404, "not_found", "Supplier not found.");
      if (!(await tx.select().from(schema.user).where(eq(schema.user.id, memberId))).length)
        fail(404, "not_found", "User not found.");
      await tx.insert(members).values({ supplierId, userId: memberId }).onConflictDoNothing();
      await this.audit(
        tx,
        actor,
        "supplier.member",
        supplierId,
        { userId: memberId, reason: auditReason },
        auditReason,
      );
      return { ok: true };
    });
  }
  async revokeSupplierMember(
    actor: CommerceActor,
    supplierId: string,
    userId: unknown,
    reason: unknown,
  ) {
    if (actor.type !== "admin") fail(403, "forbidden", "Administrator authority required.");
    commerceId(supplierId);
    const memberId = commerceId(userId);
    const auditReason = commerceText(reason, "reason", 500);
    return this.write(async (tx) => {
      const removed = await tx
        .delete(members)
        .where(and(eq(members.supplierId, supplierId), eq(members.userId, memberId)))
        .returning({ userId: members.userId });
      if (!removed.length) fail(404, "not_found", "Supplier membership not found.");
      await this.audit(
        tx,
        actor,
        "supplier.member.revoke",
        supplierId,
        { userId: memberId, reason: auditReason },
        auditReason,
      );
      return { ok: true };
    });
  }
  async setSupplierActive(
    actor: CommerceActor,
    supplierId: string,
    active: unknown,
    reason: unknown,
  ) {
    if (actor.type !== "admin") fail(403, "forbidden", "Administrator authority required.");
    commerceId(supplierId);
    if (typeof active !== "boolean") fail(400, "bad_request", "active must be boolean.");
    const activeValue = active as boolean;
    const auditReason = commerceText(reason, "reason", 500);
    return this.write(async (tx) => {
      const [before] = await tx
        .select({ active: suppliers.active })
        .from(suppliers)
        .where(eq(suppliers.id, supplierId));
      if (!before) return fail(404, "not_found", "Supplier not found.");
      await tx.update(suppliers).set({ active: activeValue }).where(eq(suppliers.id, supplierId));
      await this.audit(
        tx,
        actor,
        "supplier.status",
        supplierId,
        { active: activeValue, previousActive: before.active, reason: auditReason },
        auditReason,
      );
      return { ok: true };
    });
  }
  async adminCatalog(page: unknown = 0) {
    const current = commercePage(page);
    const rows = await this.db
      .select()
      .from(products)
      .orderBy(
        sql`case ${products.status} when 'draft' then 0 when 'published' then 1 else 2 end`,
        sql`${products.createdAt} desc`,
        sql`${products.id} desc`,
      )
      .limit(101)
      .offset(current * 100);
    return {
      products: rows.slice(0, 100),
      page: current,
      hasMore: rows.length > 100,
    };
  }
  async saveProduct(actor: CommerceActor, body: Record<string, unknown>, id?: string) {
    if (id) commerceId(id);
    const auditReason = commerceText(body.reason, "reason", 500);
    return this.write(async (tx) => {
      const before = id
        ? (
            await tx
              .select()
              .from(products)
              .where(eq(products.id, commerceId(id)))
          )[0]
        : null;
      if (id && !before) fail(404, "not_found", "Product not found.");
      const values = {
        ...productInput({ ...before, ...body }, this.options.mediaPolicy),
        updatedAt: this.now(),
      };
      const [supplier] = await tx
        .select({ active: suppliers.active })
        .from(suppliers)
        .where(eq(suppliers.id, values.supplierId));
      const archivesSameSupplier =
        before && before.supplierId === values.supplierId && values.status === "archived";
      if (!supplier || (!supplier.active && !archivesSameSupplier))
        fail(404, "not_found", "Active supplier required.");
      if (values.stock < (before?.reserved ?? 0))
        fail(409, "reserved_stock", "Stock cannot be below reserved quantity.");
      if (values.status === "published" && before?.status !== "published") {
        const [count] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(products)
          .where(eq(products.status, "published"));
        if (count!.count >= 1000)
          fail(409, "catalog_limit", "Pilot limit is 1,000 published SKUs.");
      }
      const [p] = id
        ? await tx.update(products).set(values).where(eq(products.id, id)).returning()
        : await tx.insert(products).values(values).returning();
      await this.audit(
        tx,
        actor,
        "product.save",
        p!.id,
        {
          sku: values.sku,
          status: p!.status,
          priceCents: p!.priceCents,
          reason: auditReason,
        },
        auditReason,
      );
      return { product: p! };
    });
  }
  async importCatalog(actor: CommerceActor, body: Record<string, unknown>) {
    const rows = parseCommerceCsv(body.csv).map((row) =>
      productInput(row, this.options.mediaPolicy),
    );
    if (new Set(rows.map((row) => row.sku)).size !== rows.length)
      fail(400, "invalid_csv", "Duplicate SKU in CSV.");
    return this.write(async (tx) => {
      const existing = await tx
        .select({ sku: products.sku })
        .from(products)
        .where(
          inArray(
            products.sku,
            rows.map((row) => row.sku),
          ),
        );
      if (existing.length)
        fail(
          409,
          "sku_conflict",
          "CSV contains a SKU already in the catalog; no rows were imported.",
        );
      const supplierIds = [...new Set(rows.map((row) => row.supplierId))];
      const active = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(inArray(suppliers.id, supplierIds), eq(suppliers.active, true)));
      if (active.length !== supplierIds.length)
        fail(
          400,
          "invalid_supplier",
          "Every row must name an active supplier; no rows were imported.",
        );
      if (body.confirm !== true) return { rows, imported: 0 };
      const reason = commerceText(body.reason, "reason", 500);
      const created = await tx.insert(products).values(rows).returning({ id: products.id });
      await this.audit(tx, actor, "catalog.import", "batch", { count: created.length, reason });
      return { rows, imported: created.length };
    });
  }
  private async supplierIds(tx: Tx | DjlDatabase, userId: string) {
    return (
      await tx
        .select({ id: members.supplierId })
        .from(members)
        .innerJoin(suppliers, eq(suppliers.id, members.supplierId))
        .where(and(eq(members.userId, userId), eq(suppliers.active, true)))
    ).map((m) => m.id);
  }
  private supplierPaymentDocumentMetadata(): CommerceSupplierPaymentDocumentMetadata {
    const recordingEnabled =
      this.mode === "test" && this.options.supplierPaymentDocumentsEnabled === true;
    return {
      mode: "test",
      currency: "CAD",
      supplierSettlement: "unsupported",
      recordingEnabled,
      disabledReason: recordingEnabled
        ? null
        : this.mode === "test"
          ? "New supplier TEST payment documents are disabled or paused. History remains readable."
          : "New supplier TEST payment documents require local/test commerce. History remains readable.",
    };
  }
  private supplierPaymentDocumentQuery(tx: Tx | DjlDatabase) {
    return tx
      .select({
        document: supplierPaymentDocuments,
        referenceShared: sql<boolean>`exists(select 1 from commerce_supplier_payment_documents shared where shared.reference=commerce_supplier_payment_documents.reference and shared.id<>commerce_supplier_payment_documents.id)`,
      })
      .from(supplierPaymentDocuments);
  }
  private supplierPaymentDocumentView(
    row: typeof supplierPaymentDocuments.$inferSelect,
    referenceShared: boolean,
  ): CommerceSupplierPaymentDocument {
    return {
      id: row.id,
      operationId: row.operationId,
      supplierId: row.supplierId,
      amountCents: row.amountCents,
      currency: row.currency,
      mode: row.mode,
      source: row.source,
      reference: row.reference,
      evidenceReference: row.evidenceReference,
      reason: row.reason,
      recordedBy: row.recordedBy,
      recordedAt: row.recordedAt.toISOString(),
      bankVerified: false,
      settlementApplied: false,
      referenceShared,
    };
  }
  async recordSupplierPaymentDocument(
    actor: CommerceActor,
    supplierId: string,
    body: Record<string, unknown>,
  ): Promise<CommerceSupplierPaymentDocumentResponse> {
    if (actor.type !== "admin") fail(403, "forbidden", "Administrator authority required.");
    const supplier = commerceId(supplierId).toLowerCase();
    if (body.currency !== "CAD") fail(400, "bad_request", "Document currency must be CAD.");
    const input: CommerceSupplierPaymentDocumentInput = {
      operationId: commerceId(body.operationId).toLowerCase(),
      amountCents: commerceInteger(body.amountCents, "amountCents", 1, Number.MAX_SAFE_INTEGER),
      currency: "CAD",
      reference: commerceText(body.reference, "reference", 150),
      evidenceReference: commerceText(body.evidenceReference, "evidenceReference", 500),
      reason: commerceText(body.reason, "reason", 500),
    };
    return this.write(async (tx) => {
      const [prior] = await this.supplierPaymentDocumentQuery(tx).where(
        eq(supplierPaymentDocuments.operationId, input.operationId),
      );
      if (prior) {
        const row = prior.document;
        if (
          row.supplierId !== supplier ||
          row.amountCents !== input.amountCents ||
          row.currency !== input.currency ||
          row.reference !== input.reference ||
          row.evidenceReference !== input.evidenceReference ||
          row.reason !== input.reason
        )
          fail(
            409,
            "idempotency_conflict",
            "This operation already identifies a different TEST document.",
          );
        return {
          ...this.supplierPaymentDocumentMetadata(),
          record: this.supplierPaymentDocumentView(row, prior.referenceShared),
        };
      }
      const [exists] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.id, supplier));
      if (!exists) fail(404, "not_found", "Supplier not found.");
      const metadata = this.supplierPaymentDocumentMetadata();
      if (!metadata.recordingEnabled)
        fail(503, "commerce_supplier_payment_documents_disabled", metadata.disabledReason!);
      const [created] = await tx
        .insert(supplierPaymentDocuments)
        .values({
          ...input,
          supplierId: supplier,
          recordedBy: actor.id,
          recordedAt: this.now(),
        })
        .returning();
      // A document is not a payment instruction, bank result, or settlement. Never post a journal here.
      await this.audit(
        tx,
        actor,
        "supplier.payment-document.record",
        created!.id,
        {
          supplierId: supplier,
          ...input,
          mode: "test",
          source: "unverified_manual_test_document",
          bankVerified: false,
          settlementApplied: false,
        },
        input.reason,
      );
      const [result] = await this.supplierPaymentDocumentQuery(tx).where(
        eq(supplierPaymentDocuments.id, created!.id),
      );
      return {
        ...metadata,
        record: this.supplierPaymentDocumentView(result!.document, result!.referenceShared),
      };
    });
  }
  async listSupplierPaymentDocuments(
    actor: CommerceActor,
    supplierId: string,
    page: unknown = 0,
  ): Promise<CommerceSupplierPaymentDocumentsResponse> {
    if (actor.type !== "admin") fail(403, "forbidden", "Administrator authority required.");
    const supplier = commerceId(supplierId).toLowerCase(),
      current = commercePage(page);
    const [exists] = await this.db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, supplier));
    if (!exists) fail(404, "not_found", "Supplier not found.");
    const rows = await this.supplierPaymentDocumentQuery(this.db)
      .where(eq(supplierPaymentDocuments.supplierId, supplier))
      .orderBy(
        sql`${supplierPaymentDocuments.recordedAt} desc`,
        sql`${supplierPaymentDocuments.id} desc`,
      )
      .limit(101)
      .offset(current * 100);
    return {
      ...this.supplierPaymentDocumentMetadata(),
      records: rows
        .slice(0, 100)
        .map((row) => this.supplierPaymentDocumentView(row.document, row.referenceShared)),
      page: current,
      pageSize: 100,
      hasMore: rows.length > 100,
    };
  }
  async getSupplierPaymentDocument(
    actor: CommerceActor,
    supplierId: string,
    operationId: string,
  ): Promise<CommerceSupplierPaymentDocumentResponse> {
    if (actor.type !== "admin") fail(403, "forbidden", "Administrator authority required.");
    const supplier = commerceId(supplierId).toLowerCase(),
      operation = commerceId(operationId).toLowerCase();
    const [row] = await this.supplierPaymentDocumentQuery(this.db).where(
      and(
        eq(supplierPaymentDocuments.supplierId, supplier),
        eq(supplierPaymentDocuments.operationId, operation),
      ),
    );
    if (!row)
      fail(
        404,
        "not_found",
        "TEST document not found. Absence does not establish a payment outcome.",
      );
    return {
      ...this.supplierPaymentDocumentMetadata(),
      record: this.supplierPaymentDocumentView(row!.document, row!.referenceShared),
    };
  }
  async supplierStatement(
    actor: CommerceActor,
    supplierId: string,
    query: { readonly from?: unknown; readonly to?: unknown; readonly page?: unknown } = {},
  ): Promise<CommerceSupplierStatement> {
    commerceId(supplierId);
    if (actor.type !== "user" && actor.type !== "admin")
      fail(403, "supplier_required", "Supplier access is required.");
    const from = statementInstant(query.from, "from"),
      to = statementInstant(query.to, "to"),
      page = commercePage(query.page);
    type Raw = {
      supplier: CommerceSupplierStatement["supplier"];
      generatedAt: string;
      from: string | null;
      to: string;
      invalidRange: boolean;
      opening: string;
      accrued: string;
      reversed: string;
      unclassified: string;
      closing: string;
      unclassifiedEntries: string;
      unresolved: boolean;
      totalRows: string;
      rows: {
        eventKey: string;
        resourceId: string;
        ledgerEntryIds: string[];
        createdAt: string;
        kind: "cost_accrual" | "refund_reversal" | "unclassified";
        amount: string;
        orderId: string | null;
        orderItemId: string | null;
        items: {
          itemId: string;
          sku: string | null;
          name: string;
          quantity: number;
          unitCost: string;
          totalCost: string;
        }[];
      }[];
    };
    // Authorization, immutable snapshots, all-period totals, and the current page share one MVCC statement.
    // This is a live ledger view, not a persistent contractual settlement statement across HTTP requests.
    const result = await this.db.execute<{ data: Raw }>(sql`
      with context as (
        select ${from}::timestamptz from_at,coalesce(${to}::timestamptz,statement_timestamp()) to_at,statement_timestamp() generated_at
      ), authorized as (
        select s.id,s.name,s.active from commerce_suppliers s where s.id=${supplierId}::uuid
        and (${actor.type === "admin"}::boolean or (s.active and exists(select 1 from commerce_supplier_members m where m.supplier_id=s.id and m.user_id=${actor.type === "user" ? actor.id : null}::uuid)))
      ), postings as (
        select l.id,l.event_key,l.resource_id,l.amount_cents,l.created_at,
          case when o.id is not null and l.amount_cents>0 and exists(select 1 from commerce_order_items ci where ci.order_id=o.id and ci.supplier_id=a.id) then 'cost_accrual'
               when i.id is not null and l.amount_cents<0 then 'refund_reversal' else 'unclassified' end kind,
          coalesce(o.id,i.order_id) order_id,i.id item_id
        from commerce_ledger l join authorized a on l.owner_id=a.id::text cross join context c
        left join commerce_orders o on o.id::text=l.resource_id and l.event_key='paid:'||o.id::text
        left join commerce_order_items i on i.id::text=l.resource_id and i.supplier_id=a.id and l.event_key like 'refund:'||i.id::text||':%'
        where l.account='supplier_payable' and l.currency='CAD' and l.mode='test' and l.created_at<c.to_at
      ), totals as (
        select coalesce(sum(p.amount_cents) filter(where c.from_at is not null and p.created_at<c.from_at),0)::text opening,
          coalesce(sum(p.amount_cents) filter(where (c.from_at is null or p.created_at>=c.from_at) and p.kind='cost_accrual'),0)::text accrued,
          (-coalesce(sum(p.amount_cents) filter(where (c.from_at is null or p.created_at>=c.from_at) and p.kind='refund_reversal'),0))::text reversed,
          coalesce(sum(p.amount_cents) filter(where (c.from_at is null or p.created_at>=c.from_at) and p.kind='unclassified'),0)::text unclassified,
          coalesce(sum(p.amount_cents),0)::text closing,count(*) filter(where p.kind='unclassified')::text unclassified_count
        from postings p cross join context c
      ), grouped as (
        select p.event_key,p.resource_id,max(p.created_at) created_at,sum(p.amount_cents)::text amount,
          array_agg(p.id::text order by p.created_at,p.id) entry_ids,
          case when min(p.kind)=max(p.kind) then min(p.kind) else 'unclassified' end kind,
          max(p.order_id::text)::uuid order_id,max(p.item_id::text)::uuid item_id
        from postings p cross join context c where c.from_at is null or p.created_at>=c.from_at
        group by p.event_key,p.resource_id
      ), page_rows as (
        select * from grouped order by created_at desc,event_key desc,resource_id desc limit 100 offset ${page * 100}
      )
      select jsonb_build_object(
        'supplier',jsonb_build_object('id',a.id,'name',a.name,'active',a.active),
        'generatedAt',to_char(c.generated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'from',case when c.from_at is null then null else to_char(c.from_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'to',to_char(c.to_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'invalidRange',c.from_at is not null and c.from_at>=c.to_at,
        'opening',t.opening,'accrued',t.accrued,'reversed',t.reversed,'unclassified',t.unclassified,'closing',t.closing,'unclassifiedEntries',t.unclassified_count,
        'totalRows',(select count(*)::text from grouped),
        'unresolved',exists(select 1 from commerce_order_items h where h.supplier_id=a.id and (
          h.open_case or exists(select 1 from commerce_payment_attempts p where p.order_id=h.order_id and p.status in ('creating','unknown','cancel_requested','requires_review'))
          or exists(select 1 from commerce_provider_refunds r where r.order_id=h.order_id and r.status in ('submitting','unknown','pending','requires_review'))
          or exists(select 1 from commerce_external_refunds e where e.order_id=h.order_id and (e.allocation_state in ('unallocated','requires_review') or (e.allocation_state='allocated' and e.provider_status<>'succeeded')))
        )),
        'rows',coalesce((select jsonb_agg(jsonb_build_object(
          'eventKey',p.event_key,'resourceId',p.resource_id,'ledgerEntryIds',p.entry_ids,
          'createdAt',to_char(p.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'kind',p.kind,'amount',p.amount,'orderId',p.order_id,'orderItemId',p.item_id,
          'items',coalesce((select jsonb_agg(jsonb_build_object('itemId',si.id,'sku',si.sku,'name',si.name,'quantity',si.quantity,'unitCost',si.cost_cents::text,'totalCost',(si.cost_cents*si.quantity)::text) order by si.id)
            from commerce_order_items si where si.supplier_id=a.id and si.order_id=p.order_id and (p.item_id is null or si.id=p.item_id)),'[]'::jsonb)
        ) order by p.created_at desc,p.event_key desc,p.resource_id desc) from page_rows p),'[]'::jsonb)
      ) data from authorized a cross join context c cross join totals t
    `);
    const raw = result[0]?.data;
    if (!raw)
      return fail(
        actor.type === "user" ? 403 : 404,
        "supplier_required",
        "Supplier statement access is not available.",
      );
    if (raw.invalidRange) fail(400, "bad_request", "Statement from must be earlier than to.");
    const openingCents = statementInteger(raw.opening),
      accruedCents = statementInteger(raw.accrued),
      reversedCents = statementInteger(raw.reversed),
      unclassifiedCents = statementInteger(raw.unclassified),
      closingCents = statementInteger(raw.closing),
      unclassifiedEntries = statementInteger(raw.unclassifiedEntries),
      totalRows = statementInteger(raw.totalRows);
    const difference =
      BigInt(closingCents) - BigInt(openingCents) - BigInt(accruedCents) + BigInt(reversedCents);
    const equationDifferenceCents = statementInteger(String(difference));
    return {
      supplier: raw.supplier,
      currency: "CAD",
      mode: "test",
      settlementAssessment: "not_assessed",
      generatedAt: raw.generatedAt,
      period: { from: raw.from, to: raw.to },
      summary: {
        openingCents,
        accruedCents,
        reversedCents,
        unclassifiedCents,
        closingCents,
        equationDifferenceCents,
        reconciliationOk: equationDifferenceCents === 0 && unclassifiedEntries === 0,
        unclassifiedEntries,
        hasUnresolvedRefunds: raw.unresolved,
      },
      rows: raw.rows.map((row) => ({
        eventKey: row.eventKey,
        resourceId: row.resourceId,
        ledgerEntryIds: row.ledgerEntryIds,
        createdAt: row.createdAt,
        kind: row.kind,
        amountCents: statementInteger(row.amount),
        orderId: row.orderId,
        orderItemId: row.orderItemId,
        items: row.items.map((item) => ({
          itemId: item.itemId,
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitCostCents: statementInteger(item.unitCost),
          totalCostCents: statementInteger(item.totalCost),
        })),
      })),
      page,
      pageSize: 100,
      hasMore: (page + 1) * 100 < totalRows,
      totalRows,
    };
  }
  async supplierProducts(userId: string, page: unknown = 0) {
    const current = commercePage(page);
    const ids = await this.supplierIds(this.db, userId);
    if (!ids.length) fail(403, "supplier_required", "Supplier membership required.");
    const rows = await this.db
      .select()
      .from(products)
      .where(inArray(products.supplierId, ids))
      .orderBy(
        sql`case ${products.status} when 'published' then 0 when 'draft' then 1 else 2 end`,
        sql`${products.createdAt} desc`,
        sql`${products.id} desc`,
      )
      .limit(101)
      .offset(current * 100);
    return { products: rows.slice(0, 100), page: current, hasMore: rows.length > 100 };
  }
  async supplierOrders(userId: string, page: unknown = 0) {
    const current = commercePage(page);
    const ids = await this.supplierIds(this.db, userId);
    if (!ids.length) fail(403, "supplier_required", "Supplier membership required.");
    const rows = await this.db
      .select({ item: items, address: orders.address })
      .from(items)
      .innerJoin(orders, eq(orders.id, items.orderId))
      .where(and(inArray(items.supplierId, ids), inArray(orders.status, ["paid", "refunded"])))
      .orderBy(
        sql`case when ${items.status} in ('pending','accepted','shipped') and ${orders.status}='paid' and ${items.refundedCents}<${items.lineCents} then 0 else 1 end`,
        sql`${orders.createdAt} desc`,
        sql`${items.id} desc`,
      )
      .limit(101)
      .offset(current * 100);
    const visible = rows.slice(0, 100);
    const issues = await this.supplierIssuesIn(
      this.db,
      visible.map((row) => row.item.id),
    );
    return {
      page: current,
      hasMore: rows.length > 100,
      orders: visible.map(({ item, address }) => ({
        id: item.id,
        orderId: item.orderId,
        productId: item.productId,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        priceCents: item.priceCents,
        lineCents: item.lineCents,
        refundedCents: item.refundedCents,
        status: item.status,
        carrier: item.carrier,
        trackingNumber: item.trackingNumber,
        deliveredAt: item.deliveredAt?.toISOString() ?? null,
        openCase: item.openCase,
        returnDays: item.returnDays,
        address,
        supplierIssue: issues.get(item.id) ?? null,
      })),
    };
  }
  async updateStock(actor: CommerceActor, id: string, stock: unknown) {
    const quantity = commerceInteger(stock, "stock", 0, 1000000);
    commerceId(id);
    return this.write(async (tx) => {
      const ids = await this.supplierIds(tx, actor.id);
      const p = (await tx.select().from(products).where(eq(products.id, id)))[0];
      if (!p || !ids.includes(p.supplierId)) fail(404, "not_found", "Product not found.");
      if (quantity < p!.reserved)
        fail(409, "reserved_stock", "Stock cannot be below reservations.");
      await tx
        .update(products)
        .set({ stock: quantity, updatedAt: this.now() })
        .where(eq(products.id, id));
      await this.audit(tx, actor, "stock.update", id, { stock: quantity });
      return { ok: true };
    });
  }
  async ship(actor: CommerceActor, id: string, body: Record<string, unknown>) {
    commerceId(id);
    const carrier = commerceText(body.carrier, "carrier", 100);
    const trackingNumber = commerceText(body.trackingNumber, "trackingNumber", 150);
    return this.write(async (tx) => {
      const ids = await this.supplierIds(tx, actor.id);
      const line = (await tx.select().from(items).where(eq(items.id, id)))[0];
      if (!line || !ids.includes(line.supplierId)) fail(404, "not_found", "Fulfillment not found.");
      const order = (await tx.select().from(orders).where(eq(orders.id, line!.orderId)))[0]!;
      if (
        order.status !== "paid" ||
        line!.refundedCents >= line!.lineCents ||
        line!.openCase ||
        !["pending", "accepted"].includes(line!.status)
      )
        fail(409, "not_shippable", "Item cannot be shipped.");
      await tx
        .update(items)
        .set({ status: "shipped", carrier, trackingNumber })
        .where(eq(items.id, id));
      await this.audit(tx, actor, "item.ship", id, { carrier, trackingNumber });
      return { ok: true };
    });
  }
  async accept(actor: CommerceActor, id: string) {
    commerceId(id);
    return this.write(async (tx) => {
      const ids = await this.supplierIds(tx, actor.id);
      const line = (await tx.select().from(items).where(eq(items.id, id)))[0];
      if (!line || !ids.includes(line.supplierId)) fail(404, "not_found", "Fulfillment not found.");
      const order = (await tx.select().from(orders).where(eq(orders.id, line!.orderId)))[0]!;
      if (
        order.status !== "paid" ||
        line!.status !== "pending" ||
        line!.openCase ||
        line!.refundedCents === line!.lineCents
      )
        fail(409, "not_acceptable", "Item cannot be accepted.");
      await tx.update(items).set({ status: "accepted" }).where(eq(items.id, id));
      await this.audit(tx, actor, "item.accept", id, {});
      return { ok: true };
    });
  }
  async reportSupplierIssue(actor: CommerceActor, id: string, body: Record<string, unknown>) {
    commerceId(id);
    if (actor.type !== "user") fail(403, "supplier_required", "Supplier user access is required.");
    const kind = body.kind,
      reason = commerceText(body.reason, "reason", 500);
    if (kind !== "out_of_stock" && kind !== "delay" && kind !== "other")
      return fail(400, "bad_request", "Choose out_of_stock, delay, or other.");
    return this.write(async (tx) => {
      const ids = await this.supplierIds(tx, actor.id);
      const [line] = await tx.select().from(items).where(eq(items.id, id));
      if (!line || !ids.includes(line.supplierId))
        return fail(404, "not_found", "Fulfillment not found.");
      await this.once(
        tx,
        actor,
        "supplier.issue",
        body.idempotencyKey,
        { id, kind, reason },
        async () => {
          const [order] = await tx.select().from(orders).where(eq(orders.id, line.orderId));
          if (
            !["paid", "refunded"].includes(order!.status) ||
            (kind !== "other" &&
              (order!.status !== "paid" || line.refundedCents >= line.lineCents)) ||
            line.status === "cancelled" ||
            (kind === "out_of_stock" && !["pending", "accepted"].includes(line.status)) ||
            (kind === "delay" && !["pending", "accepted", "shipped"].includes(line.status))
          )
            fail(
              409,
              "supplier_issue_not_allowed",
              "This issue cannot be reported for the current fulfillment state.",
            );
          await tx.update(items).set({ openCase: true }).where(eq(items.id, id));
          await this.audit(tx, actor, "supplier.issue", id, { kind, reason });
          return id;
        },
      );
      return { ok: true };
    });
  }
  private orderAttentionReasons() {
    // Keep the outer qualifier: Drizzle unqualifies Column chunks in single-table SELECT fields.
    const orderId = sql`${orders}.${sql.identifier("id")}`;
    return sql<CommerceOrderAttentionReason[]>`array_remove(array[
      case when exists(select 1 from commerce_order_items i where i.order_id=${orderId} and i.open_case) then 'open_case' end,
      case when exists(select 1 from commerce_payment_attempts p where p.order_id=${orderId} and p.status in ('creating','unknown','cancel_requested')) then 'payment_unresolved' end,
      case when exists(select 1 from commerce_payment_attempts p where p.order_id=${orderId} and p.status='requires_review') then 'payment_review' end,
      case when exists(select 1 from commerce_provider_refunds r where r.order_id=${orderId} and r.status in ('submitting','unknown','pending','requires_review')) then 'refund_unresolved' end,
      case when exists(select 1 from commerce_external_refunds e where e.order_id=${orderId} and (e.allocation_state in ('unallocated','requires_review') or (e.allocation_state='allocated' and e.provider_status<>'succeeded'))) then 'external_refund_unresolved' end
    ]::text[],null)`;
  }
  private async caseRevisionsIn(tx: Tx, itemIds: readonly string[]) {
    if (!itemIds.length) return new Map<string, string>();
    const itemId = sql`${items}.${sql.identifier("id")}`;
    const rows = await tx
      .select({
        id: items.id,
        openCase: items.openCase,
        // Provider review can write an already-open item without any item-target support audit.
        version: sql<string>`${items}.${sql.identifier("xmin")}::text`,
        eventCount: sql<string>`(select count(*)::text from audit_events a
          where a.target_type='commerce' and a.target_id=${itemId}::text and (
            (a.actor_type='user' and a.action in ('commerce.item.return-request','commerce.supplier.issue'))
            or (a.actor_type='admin' and a.action='commerce.item.case')
          ))`,
      })
      .from(items)
      .where(inArray(items.id, [...new Set(itemIds)]));
    return new Map(
      rows.map(({ id, openCase, version, eventCount }) => [
        id,
        createHash("sha256")
          .update(JSON.stringify(["commerce-case-review-v1", id, openCase, version, eventCount]))
          .digest("hex"),
      ]),
    );
  }
  async adminOrder(id: string) {
    commerceId(id);
    return this.db.transaction(
      async (tx) => {
        const [row] = await tx
          .select({ reasons: this.orderAttentionReasons() })
          .from(orders)
          .where(eq(orders.id, id));
        const base = await this.orderIn(tx, id);
        const itemIds = base.items.map((item) => item.id);
        const issues = await this.supplierIssuesIn(tx, itemIds);
        const support = await this.supportContextIn(tx, itemIds);
        const caseRevisions = await this.caseRevisionsIn(tx, itemIds);
        const order: CommerceAdminOrder = {
          ...base,
          items: base.items.map((item) =>
            Object.assign({}, item, {
              supplierIssue: issues.get(item.id) ?? null,
              returnRequest: support.get(item.id)?.returnRequest ?? null,
              caseHandling: support.get(item.id)?.caseHandling ?? null,
              caseRevision: caseRevisions.get(item.id)!,
            }),
          ),
          attentionReasons: row!.reasons,
        };
        return { order };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }
  async adminWithdrawal(id: string) {
    commerceId(id);
    const [row] = await this.db.select().from(withdrawals).where(eq(withdrawals.id, id));
    if (!row) return fail(404, "not_found", "Withdrawal not found.");
    return { withdrawal: this.adminWithdrawalView(row) };
  }
  async adminOrders(page: unknown = 0, attention: unknown = "all") {
    const current = commercePage(page);
    const filter = attention === undefined ? "all" : attention;
    if (filter !== "all" && filter !== "needs_attention")
      return fail(400, "bad_request", "Attention must be all or needs_attention.");
    const reasons = this.orderAttentionReasons();
    return this.db.transaction(
      async (tx) => {
        const rows = await tx
          .select({ id: orders.id, reasons })
          .from(orders)
          .where(filter === "needs_attention" ? sql`cardinality(${reasons})>0` : undefined)
          .orderBy(sql`${orders.createdAt} desc`, sql`${orders.id} desc`)
          .limit(101)
          .offset(current * 100);
        const result: CommerceAdminOrder[] = await Promise.all(
          rows.slice(0, 100).map(async (row) =>
            Object.assign(await this.orderIn(tx, row.id), {
              attentionReasons: row.reasons,
            }),
          ),
        );
        const itemIds = result.flatMap((order) => order.items.map((item) => item.id));
        const issues = await this.supplierIssuesIn(tx, itemIds);
        const support = await this.supportContextIn(tx, itemIds);
        const caseRevisions = await this.caseRevisionsIn(tx, itemIds);
        return {
          orders: result.map((order) =>
            Object.assign({}, order, {
              items: order.items.map((item) =>
                Object.assign({}, item, {
                  supplierIssue: issues.get(item.id) ?? null,
                  returnRequest: support.get(item.id)?.returnRequest ?? null,
                  caseHandling: support.get(item.id)?.caseHandling ?? null,
                  caseRevision: caseRevisions.get(item.id)!,
                }),
              ),
            }),
          ),
          page: current,
          hasMore: rows.length > 100,
          attention: filter,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }
  async deliver(actor: CommerceActor, id: string, reason: unknown) {
    commerceId(id);
    const auditReason = commerceText(reason, "reason", 500);
    return this.write(async (tx) => {
      const line = (await tx.select().from(items).where(eq(items.id, id)))[0];
      if (!line) fail(404, "not_found", "Item not found.");
      if (line!.status === "delivered") return { ok: true };
      if (line!.status !== "shipped") fail(409, "not_shipped", "Item must be shipped first.");
      await tx
        .update(items)
        .set({ status: "delivered", deliveredAt: this.now() })
        .where(eq(items.id, id));
      await this.audit(tx, actor, "item.deliver", id, { reason: auditReason }, auditReason);
      return { ok: true };
    });
  }
  async setOpenCase(
    actor: CommerceActor,
    id: string,
    open: unknown,
    reason: unknown,
    revision?: unknown,
  ) {
    if (actor.type !== "admin") fail(403, "forbidden", "Administrator authority required.");
    commerceId(id);
    if (typeof open !== "boolean") fail(400, "bad_request", "open must be boolean.");
    const auditReason = commerceText(reason, "reason", 500);
    if (open === false) {
      if (revision === undefined)
        fail(409, "commerce_case_review_required", "Read the current case before closing it.");
      if (
        typeof revision !== "string" ||
        revision.length !== 64 ||
        !/^[a-f0-9]{64}$/.test(revision)
      )
        fail(400, "bad_request", "Invalid case review revision.");
    }
    return this.write(async (tx) => {
      const line = (await tx.select().from(items).where(eq(items.id, id)).for("update"))[0];
      if (!line) fail(404, "not_found", "Item not found.");
      if (open === false) {
        const current = (await this.caseRevisionsIn(tx, [line!.id])).get(line!.id);
        if (!line!.openCase || current !== revision)
          fail(
            409,
            "commerce_case_review_stale",
            "The case changed. Read it again before closing.",
          );
        const unresolved = await tx
          .select({ id: schema.commerceProviderRefunds.id })
          .from(schema.commerceProviderRefunds)
          .where(
            and(
              eq(schema.commerceProviderRefunds.itemId, id),
              inArray(schema.commerceProviderRefunds.status, [
                "submitting",
                "unknown",
                "pending",
                "requires_review",
              ]),
            ),
          )
          .limit(1);
        const review = await tx
          .select({ id: schema.commercePaymentAttempts.id })
          .from(schema.commercePaymentAttempts)
          .where(
            and(
              eq(schema.commercePaymentAttempts.orderId, line!.orderId),
              eq(schema.commercePaymentAttempts.status, "requires_review"),
            ),
          )
          .limit(1);
        const external = await tx
          .select({ id: schema.commerceExternalRefunds.id })
          .from(schema.commerceExternalRefunds)
          .where(
            and(
              eq(schema.commerceExternalRefunds.orderId, line!.orderId),
              inArray(schema.commerceExternalRefunds.allocationState, [
                "unallocated",
                "requires_review",
              ]),
            ),
          )
          .limit(1);
        if (unresolved.length || review.length || external.length)
          fail(
            409,
            "commerce_refund_unresolved",
            "Payment or refund uncertainty must be reconciled before closing this case.",
          );
      }
      await tx
        .update(items)
        .set({ openCase: open as boolean })
        .where(eq(items.id, id));
      await this.audit(tx, actor, "item.case", id, { open, reason: auditReason }, auditReason);
      return { ok: true };
    });
  }
  async releaseCommissions(actor: CommerceActor, reason: unknown) {
    this.enabled();
    const auditReason = commerceText(reason, "reason", 500);
    return this.write(async (tx) => {
      const pending = await tx
        .select({ commission: commissions, item: items })
        .from(commissions)
        .innerJoin(items, eq(items.id, commissions.orderItemId))
        .where(eq(commissions.released, false));
      let count = 0;
      for (const { commission: c, item } of pending) {
        const unresolved = await tx
          .select({ id: schema.commerceProviderRefunds.id })
          .from(schema.commerceProviderRefunds)
          .where(
            and(
              eq(schema.commerceProviderRefunds.itemId, item.id),
              inArray(schema.commerceProviderRefunds.status, [
                "submitting",
                "unknown",
                "pending",
                "requires_review",
              ]),
            ),
          )
          .limit(1);
        const review = await tx
          .select({ id: schema.commercePaymentAttempts.id })
          .from(schema.commercePaymentAttempts)
          .where(
            and(
              eq(schema.commercePaymentAttempts.orderId, item.orderId),
              eq(schema.commercePaymentAttempts.status, "requires_review"),
            ),
          )
          .limit(1);
        const external = await tx
          .select({ id: schema.commerceExternalRefunds.id })
          .from(schema.commerceExternalRefunds)
          .where(
            and(
              eq(schema.commerceExternalRefunds.orderId, item.orderId),
              inArray(schema.commerceExternalRefunds.allocationState, [
                "unallocated",
                "requires_review",
              ]),
            ),
          )
          .limit(1);
        if (unresolved.length || review.length || external.length) continue;
        if (
          !canReleaseCommerceCommission({
            deliveredAt: item.deliveredAt,
            returnDays: item.returnDays,
            now: this.now(),
            hasOpenCase: item.openCase,
          })
        )
          continue;
        await this.journal(tx, `release:${c.id}`, c.id, [
          { ownerId: c.userId, account: "pending", amountCents: -c.amountCents },
          { ownerId: c.userId, account: "available", amountCents: c.amountCents },
        ]);
        await tx.update(commissions).set({ released: true }).where(eq(commissions.id, c.id));
        await this.offsetRecovery(tx, c.userId, `release-recovery:${c.id}`, c.id);
        count++;
      }
      await this.audit(
        tx,
        actor,
        "commission.release",
        "batch",
        { count, mode: "test", reason: auditReason },
        auditReason,
      );
      return { released: count };
    });
  }
  async refund(actor: CommerceActor, id: string, body: Record<string, unknown>) {
    return this.write((tx) => this.refundIn(tx, actor, id, body, "simulation"));
  }
  async settleStripeRefundIn(
    tx: CommerceTransaction,
    actor: CommerceActor,
    id: string,
    body: Record<string, unknown>,
  ) {
    return this.refundIn(tx, actor, id, body, "stripe_test");
  }
  private async refundIn(
    tx: CommerceTransaction,
    actor: CommerceActor,
    id: string,
    body: Record<string, unknown>,
    provider: "simulation" | "stripe_test",
  ) {
    this.enabled();
    commerceId(id);
    const total = commerceInteger(body.refundTotalCents, "refundTotalCents", 1, 5000000000000);
    const reason = commerceText(body.reason, "reason", 500);
    const line = (await tx.select().from(items).where(eq(items.id, id)))[0];
    if (!line) fail(404, "not_found", "Item not found.");
    const order = (await tx.select().from(orders).where(eq(orders.id, line!.orderId)))[0]!;
    if (order.paymentProvider !== provider)
      fail(
        409,
        "commerce_payment_provider_mismatch",
        "This refund requires the configured payment provider.",
      );
    await this.once(tx, actor, "refund", body.idempotencyKey, { id, total, reason }, async () => {
      if (!["paid", "refunded"].includes(order.status))
        fail(409, "not_paid", "Only a paid test order can be refunded.");
      if (total < line!.refundedCents || total > line!.lineCents)
        fail(
          409,
          "refund_conflict",
          "Refund total must increase and stay within the original goods amount.",
        );
      const delta = total - line!.refundedCents;
      if (!delta) return id;
      const entries: JournalLine[] = [
        { ownerId: "platform", account: "cash_test", amountCents: -delta },
        { ownerId: "platform", account: "sales_test", amountCents: delta },
      ];
      const costBefore = commerceRemainingSupplierCost(
        line!.lineCents,
        line!.refundedCents,
        line!.priceCents,
        line!.costCents,
      );
      const costAfter = commerceRemainingSupplierCost(
        line!.lineCents,
        total,
        line!.priceCents,
        line!.costCents,
      );
      entries.push(
        {
          ownerId: line!.supplierId,
          account: "supplier_payable",
          amountCents: -(costBefore - costAfter),
        },
        { ownerId: "platform", account: "goods_cost_test", amountCents: costBefore - costAfter },
      );
      const c = (await tx.select().from(commissions).where(eq(commissions.orderItemId, id)))[0];
      if (c) {
        const reversal = commerceRefundCommission({
          goodsCents: line!.lineCents,
          basisPoints: line!.commissionBps,
          refundedBeforeCents: line!.refundedCents,
          refundedTotalCents: total,
        });
        if (!c.released)
          entries.push({
            ownerId: c.userId,
            account: "pending",
            amountCents: -reversal.reversalCents,
          });
        else {
          const wallet = await this.walletIn(tx, c.userId);
          const available = Math.min(wallet.availableCents, reversal.reversalCents);
          entries.push(
            { ownerId: c.userId, account: "available", amountCents: -available },
            {
              ownerId: c.userId,
              account: "recovery",
              amountCents: -(reversal.reversalCents - available),
            },
          );
        }
        entries.push({
          ownerId: "platform",
          account: "commission_cost_test",
          amountCents: reversal.reversalCents,
        });
        await tx
          .update(commissions)
          .set({ amountCents: reversal.remainingCommissionCents })
          .where(eq(commissions.id, c.id));
      }
      await this.journal(tx, `refund:${id}:${total}`, id, entries);
      await tx
        .update(items)
        .set({
          refundedCents: total,
          // Financial settlement never confirms completion of a return or an existing support case.
          ...(total === line!.lineCents && ["pending", "accepted"].includes(line!.status)
            ? { status: "cancelled" as const }
            : {}),
        })
        .where(eq(items.id, id));
      const refunded = order.refundedCents + delta;
      await tx
        .update(orders)
        .set({
          refundedCents: refunded,
          status: refunded === order.totalCents ? "refunded" : "paid",
        })
        .where(eq(orders.id, order.id));
      // firstPaidAt is intentionally never cleared, and physical stock is not restored by a financial refund.
      await this.audit(tx, actor, "item.refund", id, {
        refundTotalCents: total,
        reason,
        mode: "test",
      });
      return id;
    });
    return { order: await this.orderIn(tx, order.id) };
  }
  async reviewWithdrawal(
    actor: CommerceActor,
    id: string,
    action:
      | "approve"
      | "record"
      | "reject"
      | "start_payment"
      | "mark_unknown"
      | "confirm_payment_success",
    body: Record<string, unknown>,
  ) {
    this.enabled();
    commerceId(id);
    return this.write(async (tx) => {
      const w = (await tx.select().from(withdrawals).where(eq(withdrawals.id, id)))[0];
      if (!w) fail(404, "not_found", "Withdrawal not found.");
      if (w!.userId === actor.id) fail(403, "self_approval", "Cannot review your own withdrawal.");
      if (action === "confirm_payment_success") {
        if (actor.type !== "admin") fail(403, "forbidden", "Administrator review is required.");
        if (body.currency !== "CAD") fail(400, "bad_request", "Payment currency must be CAD.");
        const input: CommerceConfirmWithdrawalPaymentInput = {
          operationId: commerceId(body.operationId).toLowerCase(),
          amountCents: commerceInteger(body.amountCents, "amountCents", 1, Number.MAX_SAFE_INTEGER),
          currency: "CAD",
          reference: commerceText(body.reference, "reference", 150),
          evidenceReference: commerceText(body.evidenceReference, "evidenceReference", 500),
          reason: commerceText(body.reason, "reason", 500),
        };
        if (
          !w!.approvedBy ||
          w!.approvedBy === actor.id ||
          w!.paymentOperationId !== input.operationId ||
          w!.amountCents !== input.amountCents
        )
          fail(
            409,
            "withdrawal_payment_conflict",
            "The original independently approved payment is required.",
          );
        let transition: ReturnType<typeof commerceWithdrawalPaymentTransition>;
        try {
          transition = commerceWithdrawalPaymentTransition({
            status: w!.status,
            action,
            operationId: input.operationId,
            existingOperationId: w!.paymentOperationId,
          });
        } catch {
          return fail(
            409,
            "withdrawal_payment_conflict",
            "The original payment result cannot be confirmed.",
          );
        }
        if (!transition.changed) {
          if (
            !w!.paymentConfirmedAt ||
            w!.reference !== input.reference ||
            w!.paymentEvidenceReference !== input.evidenceReference ||
            w!.reason !== input.reason
          )
            fail(
              409,
              "withdrawal_payment_conflict",
              "A different payment result is already recorded.",
            );
          return { withdrawal: this.adminWithdrawalView(w!) };
        }
        if (
          (await tx.select().from(withdrawals).where(eq(withdrawals.reference, input.reference)))
            .length
        )
          fail(409, "duplicate_reference", "Payment reference was already used.");
        if ((await this.walletIn(tx, w!.userId)).frozenCents < w!.amountCents)
          fail(409, "withdrawal_payment_conflict", "The original frozen amount is unavailable.");
        const confirmedAt = this.now();
        // This TEST result may follow a refund or open case. Preserve those debts and review flags.
        // No bank request, automatic retry, or recovery offset occurs here.
        await this.journal(tx, `payout:${id}`, id, [
          { ownerId: w!.userId, account: "frozen", amountCents: -w!.amountCents },
          { ownerId: w!.userId, account: "paid", amountCents: w!.amountCents },
        ]);
        await tx
          .update(withdrawals)
          .set({
            status: "paid_test",
            reference: input.reference,
            reason: input.reason,
            recordedBy: actor.id,
            paymentConfirmedAt: confirmedAt,
            paymentEvidenceReference: input.evidenceReference,
            updatedAt: confirmedAt,
          })
          .where(eq(withdrawals.id, id));
        await this.audit(
          tx,
          actor,
          "withdrawal.confirm_payment_success",
          id,
          { ...input, mode: "test" },
          input.reason,
        );
        return {
          withdrawal: this.adminWithdrawalView(
            (await tx.select().from(withdrawals).where(eq(withdrawals.id, id)))[0]!,
          ),
        };
      } else if (action === "start_payment" || action === "mark_unknown") {
        if (actor.type !== "admin") fail(403, "forbidden", "Administrator review is required.");
        const operationId = commerceId(body.operationId).toLowerCase();
        const reason = commerceText(body.reason, "reason", 500);
        if (action === "start_payment" && (!w!.approvedBy || w!.approvedBy === actor.id))
          fail(
            409,
            "withdrawal_conflict",
            "An independent administrator must start the approved payment.",
          );
        let transition: ReturnType<typeof commerceWithdrawalPaymentTransition>;
        try {
          transition = commerceWithdrawalPaymentTransition({
            status: w!.status,
            action,
            operationId,
            existingOperationId: w!.paymentOperationId,
          });
        } catch {
          return fail(
            409,
            "withdrawal_payment_conflict",
            "The manual payment operation is not valid for this withdrawal.",
          );
        }
        if (!transition.changed) return { withdrawal: this.adminWithdrawalView(w!) };
        if (action === "start_payment") {
          if (
            (await this.walletIn(tx, w!.userId)).recoveryCents > 0 ||
            (await this.withdrawalNeedsReview(tx, w!.userId))
          )
            fail(
              409,
              "withdrawal_conflict",
              "Outstanding recovery or review prevents starting payment.",
            );
          if (
            (
              await tx
                .select({ id: withdrawals.id })
                .from(withdrawals)
                .where(eq(withdrawals.paymentOperationId, operationId))
            ).length
          )
            fail(
              409,
              "withdrawal_payment_conflict",
              "The operation already belongs to another withdrawal.",
            );
          await tx
            .update(withdrawals)
            .set({
              status: transition.status,
              paymentOperationId: operationId,
              paymentStartedBy: actor.id,
              paymentStartedAt: this.now(),
              updatedAt: this.now(),
            })
            .where(eq(withdrawals.id, id));
        } else {
          await tx
            .update(withdrawals)
            .set({
              status: transition.status,
              paymentUnknownAt: this.now(),
              updatedAt: this.now(),
            })
            .where(eq(withdrawals.id, id));
        }
        // Neither action moves money or proves a bank outcome. Unknown stays frozen.
        await this.audit(
          tx,
          actor,
          `withdrawal.${action}`,
          id,
          {
            operationId,
            reason,
            mode: "test",
          },
          reason,
        );
        return {
          withdrawal: this.adminWithdrawalView(
            (await tx.select().from(withdrawals).where(eq(withdrawals.id, id)))[0]!,
          ),
        };
      } else if (action === "approve") {
        if (w!.status === "approved") return { withdrawal: this.adminWithdrawalView(w!) };
        if (
          w!.status !== "requested" ||
          (await this.walletIn(tx, w!.userId)).recoveryCents > 0 ||
          (await this.withdrawalNeedsReview(tx, w!.userId))
        )
          fail(409, "withdrawal_conflict", "Withdrawal requires review.");
        await tx
          .update(withdrawals)
          .set({ status: "approved", approvedBy: actor.id, updatedAt: this.now() })
          .where(eq(withdrawals.id, id));
      } else if (action === "record") {
        const reference = commerceText(body.reference, "reference", 150);
        const reason = commerceText(body.reason, "reason", 500);
        if (w!.status === "paid_test") {
          if (w!.reference !== reference)
            fail(
              409,
              "payout_reference_conflict",
              "A different payment reference is already recorded.",
            );
          return { withdrawal: this.adminWithdrawalView(w!) };
        }
        if (
          w!.status !== "approved" ||
          !w!.approvedBy ||
          w!.approvedBy === actor.id ||
          (await this.walletIn(tx, w!.userId)).recoveryCents > 0 ||
          (await this.withdrawalNeedsReview(tx, w!.userId))
        )
          fail(
            409,
            "withdrawal_conflict",
            "An independent recorder and no outstanding recovery are required.",
          );
        if (
          (await tx.select().from(withdrawals).where(eq(withdrawals.reference, reference))).length
        )
          fail(409, "duplicate_reference", "Payment reference was already used.");
        await this.journal(tx, `payout:${id}`, id, [
          { ownerId: w!.userId, account: "frozen", amountCents: -w!.amountCents },
          { ownerId: w!.userId, account: "paid", amountCents: w!.amountCents },
        ]);
        await tx
          .update(withdrawals)
          .set({
            status: "paid_test",
            reference,
            reason,
            recordedBy: actor.id,
            updatedAt: this.now(),
          })
          .where(eq(withdrawals.id, id));
      } else if (action === "reject") {
        const reason = commerceText(body.reason, "reason", 500);
        if (w!.status === "rejected") return { withdrawal: this.adminWithdrawalView(w!) };
        if (!["requested", "approved"].includes(w!.status))
          fail(409, "withdrawal_conflict", "A recorded payment cannot be rejected.");
        await this.journal(tx, `reject:${id}`, id, [
          { ownerId: w!.userId, account: "frozen", amountCents: -w!.amountCents },
          { ownerId: w!.userId, account: "available", amountCents: w!.amountCents },
        ]);
        await tx
          .update(withdrawals)
          .set({ status: "rejected", reason, updatedAt: this.now() })
          .where(eq(withdrawals.id, id));
        await this.offsetRecovery(tx, w!.userId, `reject-recovery:${id}`, id);
      } else {
        fail(400, "bad_request", "Unknown withdrawal review action.");
      }
      await this.audit(tx, actor, `withdrawal.${action}`, id, { mode: "test" });
      return {
        withdrawal: this.adminWithdrawalView(
          (await tx.select().from(withdrawals).where(eq(withdrawals.id, id)))[0]!,
        ),
      };
    });
  }
}
