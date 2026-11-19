/** Default real PostgreSQL suite; only its newly owned, fully migrated synthetic database is used. */
import { eq, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { afterAll, describe, expect, it, vi } from "vitest";
import { COMMERCE_RECONCILIATION_CSV_HEADER as header } from "@synara/contracts/cloud";
import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";
import {
  CommerceService,
  type CommerceActor,
  type CommerceTransaction,
} from "./CommerceService.ts";
import { CommerceReconciliationService } from "./CommerceReconciliationService.ts";

const conn = await isolatedCommerceTestDatabase();
afterAll(() => conn.close());
const options = { mode: "test", environment: "test" } as const;
const comparison = new CommerceReconciliationService(conn.db, options);
const admin: CommerceActor = { id: crypto.randomUUID(), type: "admin", traceId: "comparison-sql" };
const recorder: CommerceActor = { ...admin, id: crypto.randomUUID() };
const key = () => crypto.randomUUID();
const externalId = (prefix: string) => `${prefix}_${key().replaceAll("-", "")}`;
const at = "2026-10-26T00:00:00Z";
const csv = (...rows: string[]) => `${header}\n${rows.join("\n")}`;
const line = (type: string, business: string, reference: string, amount: number) =>
  `${type},${business},${reference},${amount},CAD,${at}`;

async function fixture(quantity = 1, paid = true) {
  let now = new Date("2026-01-01T00:00:00Z");
  const core = new CommerceService(conn.db, {
    ...options,
    paymentProvider: "stripe_test",
    now: () => now,
  });
  const users = await Promise.all(
    Array.from({ length: 3 }, async () => {
      const id = key();
      await conn.db.insert(schema.user).values({
        id,
        name: "Comparison synthetic account",
        email: `${id}@test.invalid`,
        emailVerified: true,
      });
      await core.profile(id);
      return { id, type: "user", traceId: "comparison-sql" } as const;
    }),
  );
  const [buyer, referrer, supplierUser] = users as [CommerceActor, CommerceActor, CommerceActor];
  await core.bindReferral(buyer, (await core.profile(referrer.id)).referralCode);
  const { supplier } = await core.createSupplier(admin, {
    name: "Comparison fixture",
    returnAddress: "Test Canada",
    reason: "Synthetic comparison fixture",
    idempotencyKey: key(),
  });
  await core.addSupplierMember(
    admin,
    supplier.id,
    supplierUser.id,
    "Synthetic comparison membership",
  );
  const products = [];
  for (let i = 0; i < quantity; i++)
    products.push(
      (
        await core.saveProduct(admin, {
          supplierId: supplier.id,
          sku: key(),
          name: "Synthetic SKU",
          description: "No real goods",
          category: "Test",
          imageUrl: "/shop/media/test.png",
          priceCents: 30000,
          costCents: 12000,
          commissionBps: 1000,
          returnDays: 30,
          stock: 20,
          status: "published",
          reason: "Synthetic comparison catalog",
        })
      ).product,
    );
  const { order } = await core.createOrder(buyer, {
    items: products.map((p) => ({ productId: p.id, quantity: 1 })),
    address: {
      name: "Synthetic",
      line1: "100 Test Street",
      city: "Toronto",
      province: "ON",
      postalCode: "M5V 2T6",
      country: "CA",
    },
    idempotencyKey: key(),
  });
  const pi = externalId("pi");
  const [attempt] = await conn.db
    .insert(schema.commercePaymentAttempts)
    .values({
      orderId: order.id,
      referrerId: referrer.id,
      requestKey: key(),
      amountCents: order.totalCents,
      paymentIntentId: pi,
      sessionId: externalId("cs_test"),
      status: paid ? "paid" : "open",
      expiresAt: new Date(now.getTime() + 31 * 60000),
    })
    .returning();
  if (paid)
    await core.paymentTransaction((tx) =>
      core.settleTestPaymentIn(tx, admin, order.id, {
        provider: "stripe_test",
        referrerId: referrer.id,
      }),
    );
  return {
    core,
    buyer,
    referrer,
    supplierUser,
    supplier,
    order,
    attempt: attempt!,
    pi,
    advance: () => {
      now = new Date("2026-02-02T00:00:00Z");
    },
  };
}
async function refund(f: Awaited<ReturnType<typeof fixture>>, total = 1000) {
  const item = f.order.items[0]!;
  await f.core.paymentTransaction((tx) =>
    f.core.settleStripeRefundIn(tx, admin, item.id, {
      refundTotalCents: total,
      reason: "Synthetic successful refund",
      idempotencyKey: key(),
    }),
  );
  const [r] = await conn.db
    .insert(schema.commerceProviderRefunds)
    .values({
      orderId: f.order.id,
      itemId: item.id,
      attemptId: f.attempt.id,
      actorId: admin.id,
      requestKey: key(),
      reason: "Synthetic only",
      amountCents: total,
      refundTotalCents: total,
      providerRefundId: externalId("re"),
      status: "succeeded",
      appliedAt: new Date(),
    })
    .returning();
  return r!;
}
async function outsideRefund(
  f: Awaited<ReturnType<typeof fixture>>,
  parts: { itemId: string; amount: number; before: number }[],
) {
  for (const p of parts)
    await f.core.paymentTransaction((tx) =>
      f.core.settleStripeRefundIn(tx, admin, p.itemId, {
        refundTotalCents: p.before + p.amount,
        reason: "Synthetic external allocation",
        idempotencyKey: key(),
      }),
    );
  const re = externalId("re"),
    event = externalId("evt");
  await conn.db.insert(schema.commercePaymentEvents).values({
    id: event,
    type: "refund.updated",
    objectId: re,
    payloadHash: "synthetic-local-proof",
    processedAt: new Date(),
    outcome: "processed",
  });
  return conn.db.transaction(async (tx) => {
    const [record] = await tx
      .insert(schema.commerceExternalRefunds)
      .values({
        orderId: f.order.id,
        attemptId: f.attempt.id,
        providerRefundId: re,
        sourceEventId: event,
        paymentIntentId: f.pi,
        amountCents: parts.reduce((sum, p) => sum + p.amount, 0),
        providerStatus: "succeeded",
        allocationState: "allocated",
        allocatedAt: new Date(),
        allocatedBy: admin.id,
        allocationFingerprint: "synthetic",
        allocationReason: "No provider request",
        version: 2,
      })
      .returning();
    await tx.insert(schema.commerceExternalRefundAllocations).values(
      parts.map((p) => ({
        externalRefundId: record!.id,
        itemId: p.itemId,
        amountCents: p.amount,
        refundedBeforeCents: p.before,
        refundedAfterCents: p.before + p.amount,
      })),
    );
    return record!;
  });
}
async function payout(record = true) {
  const f = await fixture();
  const id = f.order.items[0]!.id;
  await f.core.accept(f.supplierUser, id);
  await f.core.ship(f.supplierUser, id, { carrier: "Synthetic courier", trackingNumber: key() });
  await f.core.deliver(admin, id, "Synthetic delivery only");
  f.advance();
  await f.core.releaseCommissions(admin, "Synthetic elapsed clock, not real waiting");
  const { withdrawal } = await f.core.requestWithdrawal(f.referrer, key());
  await f.core.reviewWithdrawal(admin, withdrawal.id, "approve", {});
  const reference = `TEST-${key()}`;
  const recordPayment = () =>
    f.core.reviewWithdrawal(recorder, withdrawal.id, "record", {
      reference,
      reason: "Synthetic manual reference; no bank transfer",
    });
  if (record) await recordPayment();
  return { ...f, withdrawal, reference, recordPayment };
}
async function supplierDocument(
  f: Awaited<ReturnType<typeof fixture>>,
  reference = `TEST-SUPPLIER-${key()}`,
) {
  const documents = new CommerceService(conn.db, {
    ...options,
    supplierPaymentDocumentsEnabled: true,
  });
  return (
    await documents.recordSupplierPaymentDocument(admin, f.supplier.id, {
      operationId: key(),
      amountCents: 12000,
      currency: "CAD",
      reference,
      evidenceReference: "Synthetic unverified supplier document; no bank receipt",
      reason: "Synthetic TEST metadata only; no settlement applied",
    })
  ).record;
}
async function fingerprints() {
  const tables = await conn.db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname='public' order by tablename`,
  );
  const rows = [];
  for (const t of tables) {
    if (!/^[a-z0-9_]+$/.test(t.tablename)) throw new Error("Unexpected test table name");
    const [r] = await conn.db.execute<{ count: string; hash: string }>(
      sql.raw(
        `select count(*)::text count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\n' order by to_jsonb(t)::text),'')) hash from public."${t.tablename}" t`,
      ),
    );
    rows.push({ name: t.tablename, ...r });
  }
  return rows;
}
describe("manual TEST comparison against immutable PostgreSQL business records", () => {
  it("matches exact payment and partial-refund operation IDs and committed gross journals, not net settlement", async () => {
    const f = await fixture();
    const r = await refund(f, 1234);
    const report = await comparison.compare(
      csv(
        line("payment", f.order.id, f.pi, 30000),
        line("refund", f.order.id, r.providerRefundId!, 1234),
      ),
    );
    expect(report).toMatchObject({
      mode: "test",
      source: "unverified_manual_test_statement",
      fileCompleteness: "not_assessed",
      bankBalance: "not_assessed",
      supplierSettlement: "unsupported",
      summary: { rows: 2, matched: 2, exceptions: 0 },
    });
    expect(report.rows.map((r) => [r.status, r.expectedAmountCents, r.differenceCents])).toEqual([
      ["matched", 30000, 0],
      ["matched", 1234, 0],
    ]);
    expect(report.rows.every((r) => r.ledgerEntryIds.length > 1)).toBe(true);
    expect(JSON.stringify(report)).not.toContain(f.pi);
  });
  it("counts an allocated external refund once at the parent amount across multiple item journals", async () => {
    const f = await fixture(2);
    const local = await refund(f, 1000);
    const e = await outsideRefund(f, [
      { itemId: f.order.items[0]!.id, amount: 1000, before: 1000 },
      { itemId: f.order.items[1]!.id, amount: 3000, before: 0 },
    ]);
    const report = await comparison.compare(
      csv(
        line("refund", f.order.id, local.providerRefundId!, 1000),
        line("refund", f.order.id, e.providerRefundId, 4000),
      ),
    );
    expect(report.summary.matched).toBe(2);
    expect(report.rows[1]?.expectedAmountCents).toBe(4000);
    expect(new Set(report.rows[1]!.ledgerEntryIds).size).toBe(
      report.rows[1]!.ledgerEntryIds.length,
    );
    const repeated = await comparison.compare(
      csv(
        line("refund", f.order.id, e.providerRefundId, 1000),
        line("refund", f.order.id, e.providerRefundId, 3000),
      ),
    );
    expect(repeated.rows.map((r) => r.status)).toEqual(["duplicate", "duplicate"]);
    expect(
      repeated.rows.every((r) => r.differenceCents === null && r.ledgerEntryIds.length === 0),
    ).toBe(true);
  });
  it("matches recorded paid_test withdrawals only with the exact internal ID, reference and frozen-to-paid journal", async () => {
    const f = await payout();
    const report = await comparison.compare(
      csv(line("commission_payout", f.withdrawal.id, f.reference, 3000)),
    );
    expect(report.rows[0]).toMatchObject({
      status: "matched",
      expectedAmountCents: 3000,
      differenceCents: 0,
    });
    const wrong = await comparison.compare(
      csv(line("commission_payout", f.withdrawal.id, "wrong-reference", 3000)),
    );
    expect(wrong.rows[0]).toMatchObject({
      status: "identifier_mismatch",
      expectedAmountCents: null,
      differenceCents: null,
    });
    const open = await payout(false);
    expect(
      (
        await comparison.compare(
          csv(line("commission_payout", open.withdrawal.id, open.reference, 3000)),
        )
      ).rows[0]?.status,
    ).toBe("unresolved");
  });
  it("reports exact amount differences and unknown identifiers without guessing supplier document IDs", async () => {
    const f = await fixture();
    const report = await comparison.compare(
      csv(
        line("payment", f.order.id, f.pi, 29900),
        line("payment", key(), externalId("pi"), 30000),
        line("supplier_payout", f.supplier.id, "synthetic-bank-reference", 12000),
      ),
    );
    expect(report.rows.map((r) => r.status)).toEqual(["amount_mismatch", "not_found", "not_found"]);
    expect(report.rows[0]).toMatchObject({ expectedAmountCents: 30000, differenceCents: -100 });
    expect(
      report.rows
        .slice(1)
        .every((r) => r.differenceCents === null && r.expectedAmountCents === null),
    ).toBe(true);
    const wrongBusiness = await comparison.compare(csv(line("payment", key(), f.pi, 30000)));
    expect(wrongBusiness.rows[0]?.status).toBe("identifier_mismatch");
  });
  it("compares immutable supplier document fields without calling them financially matched or inventing ledger entries", async () => {
    const f = await fixture();
    const r = await refund(f, 1234);
    const p = await payout();
    const record = await supplierDocument(f);
    expect(record).toMatchObject({
      supplierId: f.supplier.id,
      mode: "test",
      currency: "CAD",
      source: "unverified_manual_test_document",
      bankVerified: false,
      settlementApplied: false,
      referenceShared: false,
    });
    const before = await fingerprints();
    const report = await comparison.compare(
      csv(
        line("payment", f.order.id, f.pi, 30000),
        line("refund", f.order.id, r.providerRefundId!, 1234),
        line("commission_payout", p.withdrawal.id, p.reference, 3000),
        line("supplier_payout", record.id.toUpperCase(), record.reference, 12000),
      ),
    );
    expect(report).toMatchObject({
      source: "unverified_manual_test_statement",
      supplierSettlement: "unsupported",
      bankBalance: "not_assessed",
      fileCompleteness: "not_assessed",
      summary: { rows: 4, matched: 3, exceptions: 1 },
    });
    expect(report.rows.map((row) => row.status)).toEqual([
      "matched",
      "matched",
      "matched",
      "manual_record_fields_match",
    ]);
    expect(report.rows[3]).toMatchObject({
      businessId: record.id,
      supplierPaymentDocumentId: record.id,
      expectedAmountCents: 12000,
      differenceCents: 0,
      ledgerEntryIds: [],
    });
    expect(report.rows.slice(0, 3).every((row) => row.supplierPaymentDocumentId === null)).toBe(
      true,
    );
    expect(report.rows.slice(0, 3).every((row) => row.ledgerEntryIds.length > 1)).toBe(true);
    expect(JSON.stringify(report)).not.toContain(record.reference);
    expect(JSON.stringify(report)).not.toContain(record.evidenceReference);
    expect(await fingerprints()).toEqual(before);
  });
  it("requires the exact supplier document ID, reference and amount without falling back to supplier, operation or reference lookup", async () => {
    const f = await fixture();
    const record = await supplierDocument(f);
    const before = await fingerprints();
    for (const businessId of [key(), f.supplier.id, record.operationId]) {
      const report = await comparison.compare(
        csv(line("supplier_payout", businessId, record.reference, 12000)),
      );
      expect(report.rows[0]).toMatchObject({
        status: "not_found",
        supplierPaymentDocumentId: null,
        expectedAmountCents: null,
        differenceCents: null,
        ledgerEntryIds: [],
      });
    }
    const wrongReference = await comparison.compare(
      csv(line("supplier_payout", record.id, "unrelated-reference", 12000)),
    );
    expect(wrongReference.rows[0]).toMatchObject({
      status: "identifier_mismatch",
      supplierPaymentDocumentId: record.id,
      expectedAmountCents: null,
      differenceCents: null,
      ledgerEntryIds: [],
    });
    const wrongAmount = await comparison.compare(
      csv(line("supplier_payout", record.id, record.reference, 11900)),
    );
    expect(wrongAmount.rows[0]).toMatchObject({
      status: "amount_mismatch",
      supplierPaymentDocumentId: record.id,
      expectedAmountCents: 12000,
      differenceCents: -100,
      ledgerEntryIds: [],
    });
    await expect(
      comparison.compare(
        csv(line("supplier_payout", record.id, record.reference, 12000).replace(",CAD,", ",USD,")),
      ),
    ).rejects.toMatchObject({ status: 400, code: "commerce_reconciliation_csv_invalid" });
    expect(await fingerprints()).toEqual(before);
  });
  it("leaves globally shared references ambiguous and detects repeated CSV document IDs without treating references as unique bank IDs", async () => {
    const f = await fixture();
    const other = await fixture();
    const reference = `TEST-SHARED-${key()}`;
    const first = await supplierDocument(f, reference);
    const second = await supplierDocument(other, reference);
    expect(second.referenceShared).toBe(true);
    const unique = await supplierDocument(f);
    const before = await fingerprints();
    for (const records of [[first], [first, second]]) {
      const report = await comparison.compare(
        csv(...records.map((record) => line("supplier_payout", record.id, reference, 12000))),
      );
      expect(report.summary).toEqual({
        rows: records.length,
        matched: 0,
        exceptions: records.length,
      });
      expect(report.rows.map((row) => row.status)).toEqual(records.map(() => "ambiguous"));
      expect(report.rows.map((row) => row.supplierPaymentDocumentId)).toEqual(
        records.map((record) => record.id),
      );
      expect(report.rows.every((row) => row.ledgerEntryIds.length === 0)).toBe(true);
    }
    expect(
      (await comparison.compare(csv(line("supplier_payout", first.id, "wrong-shared-ref", 12000))))
        .rows[0]?.status,
    ).toBe("identifier_mismatch");
    const duplicate = await comparison.compare(
      csv(
        line("supplier_payout", unique.id, unique.reference, 12000),
        line("supplier_payout", unique.id, "different-uploaded-reference", 12000),
      ),
    );
    expect(duplicate.rows.map((row) => row.status)).toEqual(["duplicate", "duplicate"]);
    expect(
      duplicate.rows.every(
        (row) =>
          row.supplierPaymentDocumentId === unique.id &&
          row.expectedAmountCents === null &&
          row.differenceCents === null &&
          row.ledgerEntryIds.length === 0,
      ),
    ).toBe(true);
    expect(await fingerprints()).toEqual(before);
  });
  it("does not match duplicate payment/withdrawal operations even when every amount individually agrees", async () => {
    const f = await fixture();
    const r = await comparison.compare(
      csv(
        line("payment", f.order.id, f.pi, 30000),
        line("payment", f.order.id, externalId("pi"), 30000),
      ),
    );
    expect(r.rows.map((r) => r.status)).toEqual(["duplicate", "duplicate"]);
    const p = await payout();
    const w = await comparison.compare(
      csv(
        line("commission_payout", p.withdrawal.id, p.reference, 3000),
        line("commission_payout", p.withdrawal.id, "other-reference", 3000),
      ),
    );
    expect(w.rows.map((r) => r.status)).toEqual(["duplicate", "duplicate"]);
  });
  it("keeps unknown, pending and contradictory refund ownership unresolved or ambiguous rather than matched", async () => {
    const f = await fixture();
    const r = await refund(f);
    await conn.db
      .update(schema.commercePaymentAttempts)
      .set({ status: "unknown" })
      .where(eq(schema.commercePaymentAttempts.id, f.attempt.id));
    expect(
      (await comparison.compare(csv(line("payment", f.order.id, f.pi, 30000)))).rows[0]?.status,
    ).toBe("unresolved");
    await conn.db
      .update(schema.commercePaymentAttempts)
      .set({ status: "paid" })
      .where(eq(schema.commercePaymentAttempts.id, f.attempt.id));
    await conn.db
      .update(schema.commerceProviderRefunds)
      .set({ status: "requires_review" })
      .where(eq(schema.commerceProviderRefunds.id, r.id));
    expect(
      (await comparison.compare(csv(line("refund", f.order.id, r.providerRefundId!, 1000)))).rows[0]
        ?.status,
    ).toBe("unresolved");
    const event = externalId("evt");
    await conn.db.insert(schema.commercePaymentEvents).values({
      id: event,
      type: "refund.updated",
      objectId: r.providerRefundId!,
      payloadHash: "synthetic",
      processedAt: new Date(),
    });
    await conn.db.insert(schema.commerceExternalRefunds).values({
      orderId: f.order.id,
      attemptId: f.attempt.id,
      providerRefundId: r.providerRefundId!,
      sourceEventId: event,
      paymentIntentId: f.pi,
      amountCents: 1000,
      providerStatus: "succeeded",
      allocationState: "unallocated",
    });
    expect(
      (await comparison.compare(csv(line("refund", f.order.id, r.providerRefundId!, 1000)))).rows[0]
        ?.status,
    ).toBe("ambiguous");
  });
  it("recognizes excluded-owned provenance without double counting and re-flags a later failed external refund", async () => {
    const f = await fixture();
    const r = await refund(f);
    const event = externalId("evt");
    await conn.db.insert(schema.commercePaymentEvents).values({
      id: event,
      type: "refund.updated",
      objectId: r.providerRefundId!,
      payloadHash: "synthetic",
      processedAt: new Date(),
    });
    await conn.db.insert(schema.commerceExternalRefunds).values({
      orderId: f.order.id,
      attemptId: f.attempt.id,
      providerRefundId: r.providerRefundId!,
      sourceEventId: event,
      paymentIntentId: f.pi,
      amountCents: 1000,
      providerStatus: "succeeded",
      allocationState: "excluded_owned",
    });
    expect(
      (await comparison.compare(csv(line("refund", f.order.id, r.providerRefundId!, 1000)))).rows[0]
        ?.status,
    ).toBe("matched");
    const g = await fixture();
    const e = await outsideRefund(g, [{ itemId: g.order.items[0]!.id, amount: 2000, before: 0 }]);
    await conn.db
      .update(schema.commerceExternalRefunds)
      .set({ providerStatus: "failed", version: 3 })
      .where(eq(schema.commerceExternalRefunds.id, e.id));
    expect(
      (await comparison.compare(csv(line("refund", g.order.id, e.providerRefundId, 2000)))).rows[0]
        ?.status,
    ).toBe("unresolved");
  });
  it("rejects apparently confirmed records with no actual committed matching journal", async () => {
    const f = await fixture(1, false);
    await conn.db
      .update(schema.commerceOrders)
      .set({ status: "paid", paidAt: new Date() })
      .where(eq(schema.commerceOrders.id, f.order.id));
    await conn.db
      .update(schema.commercePaymentAttempts)
      .set({ status: "paid" })
      .where(eq(schema.commercePaymentAttempts.id, f.attempt.id));
    const report = await comparison.compare(csv(line("payment", f.order.id, f.pi, 30000)));
    expect(report.rows[0]).toMatchObject({
      status: "inconsistent",
      expectedAmountCents: null,
      differenceCents: null,
    });
  });
  it("runs an actual read-only repeatable-read snapshot and leaves every public table fingerprint identical", async () => {
    const f = await fixture();
    const r = await refund(f);
    const before = await fingerprints();
    let settings: unknown;
    const db = {
      transaction: (
        work: (tx: CommerceTransaction) => Promise<unknown>,
        config: Parameters<DjlDatabase["transaction"]>[1],
      ) =>
        conn.db.transaction(async (tx) => {
          settings = (
            await tx.execute(
              sql`select current_setting('transaction_isolation') isolation,current_setting('transaction_read_only') read_only`,
            )
          )[0];
          return work(tx);
        }, config),
    } as unknown as DjlDatabase;
    const report = await new CommerceReconciliationService(db, options).compare(
      csv(line("refund", f.order.id, r.providerRefundId!, 1000)),
    );
    expect(report.rows[0]?.status).toBe("matched");
    expect(settings).toMatchObject({ isolation: "repeatable read", read_only: "on" });
    expect(await fingerprints()).toEqual(before);
  });
  it.skipIf(process.env.COMMERCE_TEST_PGLITE === "true")(
    "keeps one consistent view while another PostgreSQL connection records a payout",
    async () => {
      const f = await payout(false);
      const db = {
        transaction: (
          work: (tx: CommerceTransaction) => Promise<unknown>,
          config: Parameters<DjlDatabase["transaction"]>[1],
        ) =>
          conn.db.transaction(async (tx) => {
            await tx.execute(sql`select 1`); // establish the read snapshot before the other connection commits
            await f.recordPayment();
            return work(tx);
          }, config),
      } as unknown as DjlDatabase;
      const statement = csv(line("commission_payout", f.withdrawal.id, f.reference, 3000));
      expect(
        (await new CommerceReconciliationService(db, options).compare(statement)).rows[0]?.status,
      ).toBe("unresolved");
      expect((await comparison.compare(statement)).rows[0]?.status).toBe("matched");
    },
  );
  it.skipIf(process.env.COMMERCE_TEST_PGLITE === "true")(
    "keeps shared-reference detection in the same read-only snapshot as supplier document lookup",
    async () => {
      const f = await fixture();
      const reference = `TEST-SNAPSHOT-${key()}`;
      const record = await supplierDocument(f, reference);
      const ledgerBefore = await conn.db
        .select()
        .from(schema.commerceLedger)
        .orderBy(schema.commerceLedger.id);
      const db = {
        transaction: (
          work: (tx: CommerceTransaction) => Promise<unknown>,
          config: Parameters<DjlDatabase["transaction"]>[1],
        ) =>
          conn.db.transaction(async (tx) => {
            await tx.execute(sql`select 1`);
            await supplierDocument(f, reference);
            return work(tx);
          }, config),
      } as unknown as DjlDatabase;
      const statement = csv(line("supplier_payout", record.id, reference, 12000));
      expect(
        (await new CommerceReconciliationService(db, options).compare(statement)).rows[0]?.status,
      ).toBe("manual_record_fields_match");
      expect((await comparison.compare(statement)).rows[0]?.status).toBe("ambiguous");
      expect(
        await conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
      ).toEqual(ledgerBefore);
    },
  );
  it("does not convert a database failure into an empty or zero-difference report, or log private diagnostics", async () => {
    const f = await fixture();
    const before = await fingerprints();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = {
      transaction: () =>
        Promise.reject(new Error("synthetic private bank account or SQL bind diagnostic")),
    } as unknown as DjlDatabase;
    await expect(
      new CommerceReconciliationService(db, options).compare(
        csv(line("payment", f.order.id, f.pi, 30000)),
      ),
    ).rejects.toMatchObject({ status: 503, code: "commerce_reconciliation_unavailable" });
    expect(errorLog).not.toHaveBeenCalled();
    errorLog.mockRestore();
    expect(await fingerprints()).toEqual(before);
  });
  it("returns only supplied rows at the1000-row limit and never declares absent transactions missing", async () => {
    const report = await comparison.compare(
      csv(...Array.from({ length: 1000 }, () => line("payment", key(), externalId("pi"), 1))),
    );
    expect(report.summary).toEqual({ rows: 1000, matched: 0, exceptions: 1000 });
    expect(report.rows.every((r) => r.status === "not_found" && r.differenceCents === null)).toBe(
      true,
    );
    expect(report.fileCompleteness).toBe("not_assessed");
  });
});
