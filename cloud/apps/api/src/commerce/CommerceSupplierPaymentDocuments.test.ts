import { eq, sql } from "drizzle-orm";
import { schema } from "@djl/db";
import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";

import { LedgerService } from "../credits/LedgerService.ts";
import { seedOrg } from "../testing/db.ts";
import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";
import { CommerceService, type CommerceActor } from "./CommerceService.ts";

const conn = await isolatedCommerceTestDatabase();
const now = new Date("2026-10-28T12:00:00Z");
const core = new CommerceService(conn.db, {
  mode: "test",
  environment: "test",
  supplierPaymentDocumentsEnabled: true,
  now: () => now,
});
const key = () => crypto.randomUUID();
const admin: CommerceActor = { id: key(), type: "admin", traceId: "supplier-payment-document" };
const otherAdmin: CommerceActor = { ...admin, id: key() };
const reason = "Synthetic TEST document, not a transfer or bank confirmation";
afterAll(() => conn.close());

async function supplier() {
  return (
    await core.createSupplier(admin, {
      name: "Synthetic document supplier",
      returnAddress: "Toronto, ON, Canada",
      reason,
      idempotencyKey: key(),
    })
  ).supplier;
}
function input() {
  return {
    operationId: key(),
    amountCents: 1,
    currency: "CAD" as const,
    reference: "Synthetic reference " + key(),
    evidenceReference: "Synthetic document reference " + key(),
    reason,
  };
}
const documents = () =>
  conn.db
    .select()
    .from(schema.commerceSupplierPaymentDocuments)
    .orderBy(schema.commerceSupplierPaymentDocuments.id);
const documentAudit = () =>
  conn.db
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.action, "commerce.supplier.payment-document.record"))
    .orderBy(schema.auditEvents.id);

async function financialState(supplierId: string) {
  const statement = await core.supplierStatement(admin, supplierId, { to: "2099-01-01T00:00:00Z" });
  const { generatedAt: _observedAt, ...statementFacts } = statement;
  return {
    ledger: await conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id),
    aiLedger: await conn.db.select().from(schema.creditLedger).orderBy(schema.creditLedger.id),
    aiBalances: await conn.db
      .select()
      .from(schema.creditBalances)
      .orderBy(schema.creditBalances.orgId),
    orders: await conn.db.select().from(schema.commerceOrders).orderBy(schema.commerceOrders.id),
    items: await conn.db
      .select()
      .from(schema.commerceOrderItems)
      .orderBy(schema.commerceOrderItems.id),
    commissions: await conn.db
      .select()
      .from(schema.commerceCommissions)
      .orderBy(schema.commerceCommissions.id),
    withdrawals: await conn.db
      .select()
      .from(schema.commerceWithdrawals)
      .orderBy(schema.commerceWithdrawals.id),
    statementFacts,
  };
}

describe("supplier unverified TEST payment documents", () => {
  it("records only documents and audit without changing existing supplier, buyer or AI accounting", async () => {
    const s = await supplier();
    const buyer = await seedOrg(conn.db, "document-buyer"),
      referrer = await seedOrg(conn.db, "document-referrer");
    const buyerActor: CommerceActor = { ...admin, id: buyer.userId, type: "user" };
    await core.profile(buyer.userId);
    await core.bindReferral(buyerActor, (await core.profile(referrer.userId)).referralCode);
    const { product } = await core.saveProduct(admin, {
      supplierId: s.id,
      sku: key(),
      name: "Synthetic tote",
      description: "Document isolation fixture",
      category: "Bags",
      imageUrl: "/shop/media/test-tote.png",
      priceCents: 3900,
      costCents: 1000,
      commissionBps: 1000,
      returnDays: 30,
      stock: 5,
      status: "published",
      reason,
    });
    const { order } = await core.createOrder(buyerActor, {
      items: [{ productId: product.id, quantity: 1 }],
      address: {
        name: "Synthetic buyer",
        line1: "100 Test Street",
        city: "Toronto",
        province: "ON",
        postalCode: "M5V 2T6",
        country: "CA",
      },
      idempotencyKey: key(),
    });
    await core.testPay(buyerActor, order.id, key());
    await new LedgerService(conn.db).grant({
      orgId: buyer.orgId,
      type: "admin_grant",
      bucket: "topup",
      amount: 1000n,
      idempotencyKey: key(),
      actor: admin.id,
      reason,
    });
    const before = await financialState(s.id),
      wallet = await core.wallet(referrer.userId);
    expect(before.statementFacts.summary.closingCents).toBe(1000);
    expect(wallet.pendingCents).toBe(390);
    const body = input();
    const result = await core.recordSupplierPaymentDocument(admin, s.id, body);
    expect(result).toMatchObject({
      mode: "test",
      currency: "CAD",
      supplierSettlement: "unsupported",
      recordingEnabled: true,
      disabledReason: null,
      record: {
        ...body,
        supplierId: s.id,
        mode: "test",
        source: "unverified_manual_test_document",
        recordedBy: admin.id,
        recordedAt: now.toISOString(),
        bankVerified: false,
        settlementApplied: false,
        referenceShared: false,
      },
    });
    expect(result.record.id).not.toBe(body.operationId);
    expect(result.record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await financialState(s.id)).toEqual(before);
    expect(await core.wallet(referrer.userId)).toEqual(wallet);
    const audit = (await documentAudit()).find((row) => row.targetId === result.record.id);
    expect(audit).toMatchObject({
      actorId: admin.id,
      reason,
      after: {
        ...body,
        supplierId: s.id,
        mode: "test",
        source: "unverified_manual_test_document",
        bankVerified: false,
        settlementApplied: false,
      },
    });
  });

  it("replays the complete canonical operation across administrators without a new row or audit", async () => {
    const s = await supplier(),
      body = input();
    const first = await core.recordSupplierPaymentDocument(admin, s.id, body);
    const before = await documents(),
      audit = await documentAudit();
    const replay = await core.recordSupplierPaymentDocument(otherAdmin, s.id.toUpperCase(), {
      ...body,
      operationId: body.operationId.toUpperCase(),
      reference: " " + body.reference + " ",
      evidenceReference: " " + body.evidenceReference + " ",
      reason: " " + body.reason + " ",
    });
    expect(replay).toEqual(first);
    expect(await documents()).toEqual(before);
    expect(await documentAudit()).toEqual(audit);
    for (const changed of [
      { amountCents: 2 },
      { reference: "Other reference" },
      { evidenceReference: "Other document" },
      { reason: "Other reason" },
    ])
      await expect(
        core.recordSupplierPaymentDocument(admin, s.id, { ...body, ...changed }),
      ).rejects.toHaveProperty("status", 409);
    const other = await supplier();
    await expect(core.recordSupplierPaymentDocument(admin, other.id, body)).rejects.toHaveProperty(
      "status",
      409,
    );
    expect(await documents()).toEqual(before);
    expect(await documentAudit()).toEqual(audit);
  });

  it("allows repeated reference text under different operations and derives a nonfinancial shared hint", async () => {
    const a = await supplier(),
      b = await supplier(),
      firstInput = input();
    const first = await core.recordSupplierPaymentDocument(admin, a.id, firstInput);
    expect(first.record.referenceShared).toBe(false);
    const second = await core.recordSupplierPaymentDocument(admin, b.id, {
      ...input(),
      reference: firstInput.reference,
    });
    expect(second.record.id).not.toBe(first.record.id);
    expect(second.record.referenceShared).toBe(true);
    expect(
      (await core.getSupplierPaymentDocument(admin, a.id, firstInput.operationId)).record
        .referenceShared,
    ).toBe(true);
    expect((await core.listSupplierPaymentDocuments(admin, a.id)).records[0]?.referenceShared).toBe(
      true,
    );
  });

  it("never accepts claimed bank verification, settlement or recording identity from input", async () => {
    const s = await supplier();
    const result = await core.recordSupplierPaymentDocument(admin, s.id, {
      ...input(),
      bankVerified: true,
      settlementApplied: true,
      mode: "live",
      source: "bank_verified",
      recordedBy: otherAdmin.id,
      recordedAt: "2000-01-01T00:00:00Z",
    });
    expect(result.record).toMatchObject({
      mode: "test",
      source: "unverified_manual_test_document",
      bankVerified: false,
      settlementApplied: false,
      recordedBy: admin.id,
      recordedAt: now.toISOString(),
    });
  });

  it("serializes an identical global operation race and rejects a conflicting race", async () => {
    const s = await supplier(),
      same = input();
    const results = await Promise.all([
      core.recordSupplierPaymentDocument(admin, s.id, same),
      core.recordSupplierPaymentDocument(otherAdmin, s.id, same),
    ]);
    expect(results[0].record).toEqual(results[1].record);
    expect((await documents()).filter((row) => row.operationId === same.operationId)).toHaveLength(
      1,
    );
    expect(
      (await documentAudit()).filter((row) => row.targetId === results[0].record.id),
    ).toHaveLength(1);
    const conflicting = input();
    const race = await Promise.allSettled([
      core.recordSupplierPaymentDocument(admin, s.id, conflicting),
      core.recordSupplierPaymentDocument(otherAdmin, s.id, { ...conflicting, amountCents: 2 }),
    ]);
    expect(race.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((row) => row.status === "rejected")).toHaveLength(1);
    const rejected = race.find((row) => row.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toHaveProperty("status", 409);
    expect(
      (await documents()).filter((row) => row.operationId === conflicting.operationId),
    ).toHaveLength(1);
  });

  it("keeps history and identical replay readable while new registration is disabled", async () => {
    const s = await supplier(),
      body = input();
    const first = await core.recordSupplierPaymentDocument(admin, s.id, body);
    const before = await documents(),
      audit = await documentAudit();
    for (const options of [
      { mode: "test" as const, environment: "test" as const },
      {
        mode: "test" as const,
        environment: "local" as const,
        supplierPaymentDocumentsEnabled: false,
      },
      {
        mode: "test" as const,
        environment: "production" as const,
        supplierPaymentDocumentsEnabled: true,
      },
      {
        mode: "disabled" as const,
        environment: "test" as const,
        supplierPaymentDocumentsEnabled: true,
      },
      {
        mode: "test" as const,
        environment: "staging" as const,
        supplierPaymentDocumentsEnabled: true,
      },
    ]) {
      const paused = new CommerceService(conn.db, options);
      await expect(
        paused.recordSupplierPaymentDocument(admin, s.id, input()),
      ).rejects.toHaveProperty("status", 503);
      const replay = await paused.recordSupplierPaymentDocument(otherAdmin, s.id, body);
      expect(replay.record).toEqual(first.record);
      expect(replay.recordingEnabled).toBe(false);
      expect(replay.disabledReason).toEqual(expect.any(String));
      expect(
        (await paused.getSupplierPaymentDocument(admin, s.id, body.operationId)).record,
      ).toEqual(first.record);
      expect(
        (await paused.listSupplierPaymentDocuments(admin, s.id)).records.some(
          (row) => row.id === first.record.id,
        ),
      ).toBe(true);
      await expect(
        paused.recordSupplierPaymentDocument(admin, s.id, { ...body, amountCents: 2 }),
      ).rejects.toHaveProperty("status", 409);
    }
    expect(await documents()).toEqual(before);
    expect(await documentAudit()).toEqual(audit);
  });

  it("can register an inactive supplier without inventing payable eligibility or funds", async () => {
    const s = await supplier();
    await core.setSupplierActive(admin, s.id, false, reason);
    const before = await financialState(s.id);
    const result = await core.recordSupplierPaymentDocument(admin, s.id, {
      ...input(),
      amountCents: Number.MAX_SAFE_INTEGER,
    });
    expect(result.record.amountCents).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.record.settlementApplied).toBe(false);
    expect(await financialState(s.id)).toEqual(before);
  });

  it.each([
    ["operationId", "not-a-uuid"],
    ["amountCents", 0],
    ["amountCents", -1],
    ["amountCents", 1.5],
    ["amountCents", Number.MAX_SAFE_INTEGER + 1],
    ["amountCents", "1"],
    ["currency", "USD"],
    ["reference", " "],
    ["reference", "x".repeat(151)],
    ["evidenceReference", " "],
    ["evidenceReference", "x".repeat(501)],
    ["reason", " "],
    ["reason", "x".repeat(501)],
  ])("rejects invalid %s without inserting a document", async (field, value) => {
    const s = await supplier(),
      before = await documents(),
      audit = await documentAudit();
    await expect(
      core.recordSupplierPaymentDocument(admin, s.id, { ...input(), [field]: value }),
    ).rejects.toHaveProperty("status", 400);
    expect(await documents()).toEqual(before);
    expect(await documentAudit()).toEqual(audit);
  });

  it("requires administrator authority on every direct service method and scopes operation lookup", async () => {
    const s = await supplier(),
      other = await supplier(),
      body = input();
    await core.recordSupplierPaymentDocument(admin, s.id, body);
    for (const type of ["user", "system"] as const) {
      const actor = { ...admin, type };
      await expect(core.recordSupplierPaymentDocument(actor, s.id, input())).rejects.toHaveProperty(
        "status",
        403,
      );
      await expect(core.listSupplierPaymentDocuments(actor, s.id)).rejects.toHaveProperty(
        "status",
        403,
      );
      await expect(
        core.getSupplierPaymentDocument(actor, s.id, body.operationId),
      ).rejects.toHaveProperty("status", 403);
    }
    await expect(
      core.getSupplierPaymentDocument(admin, other.id, body.operationId),
    ).rejects.toHaveProperty("status", 404);
    await expect(core.getSupplierPaymentDocument(admin, s.id, key())).rejects.toHaveProperty(
      "status",
      404,
    );
    await expect(core.recordSupplierPaymentDocument(admin, key(), input())).rejects.toHaveProperty(
      "status",
      404,
    );
    await expect(core.listSupplierPaymentDocuments(admin, s.id, -1)).rejects.toHaveProperty(
      "status",
      400,
    );
  });

  it("returns stable supplier-scoped pages without treating reference matches as payments", async () => {
    const s = await supplier(),
      other = await supplier();
    const ids: string[] = [];
    for (let i = 0; i < 101; i++)
      ids.push((await core.recordSupplierPaymentDocument(admin, s.id, input())).record.id);
    const unrelated = await core.recordSupplierPaymentDocument(admin, other.id, input());
    const first = await core.listSupplierPaymentDocuments(admin, s.id);
    const second = await core.listSupplierPaymentDocuments(admin, s.id, "1");
    expect(first).toMatchObject({
      page: 0,
      pageSize: 100,
      hasMore: true,
      supplierSettlement: "unsupported",
    });
    expect(second).toMatchObject({ page: 1, pageSize: 100, hasMore: false });
    expect(first.records).toHaveLength(100);
    expect(second.records).toHaveLength(1);
    expect([...first.records, ...second.records].map((row) => row.id)).toEqual(
      ids.toSorted().toReversed(),
    );
    expect(first.records.some((row) => row.id === unrelated.record.id)).toBe(false);
  });

  it("rolls back the record when its complete audit cannot be written", async () => {
    const s = await supplier(),
      body = input(),
      before = await documents(),
      audit = await documentAudit();
    await conn.db.execute(
      sql.raw(`CREATE FUNCTION supplier_document_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.trace_id='supplier-document-audit-fault' AND NEW.action='commerce.supplier.payment-document.record'
      THEN RAISE EXCEPTION 'Synthetic supplier document audit fault'; END IF; RETURN NEW; END $$`),
    );
    await conn.db.execute(
      sql.raw(
        "CREATE TRIGGER supplier_document_audit_fault BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION supplier_document_audit_fault()",
      ),
    );
    try {
      await expect(
        core.recordSupplierPaymentDocument(
          { ...admin, traceId: "supplier-document-audit-fault" },
          s.id,
          body,
        ),
      ).rejects.toMatchObject({ status: 500, code: "commerce_write_failed" });
      expect(await documents()).toEqual(before);
      expect(await documentAudit()).toEqual(audit);
    } finally {
      await conn.db.execute(sql.raw("DROP TRIGGER supplier_document_audit_fault ON audit_events"));
      await conn.db.execute(sql.raw("DROP FUNCTION supplier_document_audit_fault()"));
    }
    expect((await core.recordSupplierPaymentDocument(admin, s.id, body)).record.operationId).toBe(
      body.operationId,
    );
  });

  it("makes operation identity and document history immutable even to the table owner", async () => {
    const s = await supplier(),
      body = input();
    const { record } = await core.recordSupplierPaymentDocument(admin, s.id, body);
    const before = await documents();
    for (const patch of [
      { operationId: key() },
      { reference: "Other" },
      { amountCents: 2 },
      { recordedBy: otherAdmin.id },
      { reason: "Other" },
    ])
      await expect(
        conn.db
          .update(schema.commerceSupplierPaymentDocuments)
          .set(patch)
          .where(eq(schema.commerceSupplierPaymentDocuments.id, record.id)),
      ).rejects.toMatchObject({
        cause: { code: "P0001", message: "Commerce financial history is append-only" },
      });
    await expect(
      conn.db
        .delete(schema.commerceSupplierPaymentDocuments)
        .where(eq(schema.commerceSupplierPaymentDocuments.id, record.id)),
    ).rejects.toMatchObject({ cause: { code: "P0001" } });
    await expect(
      conn.db.execute(sql.raw("TRUNCATE commerce_supplier_payment_documents")),
    ).rejects.toMatchObject({ cause: { code: "P0001" } });
    await expect(
      conn.db
        .insert(schema.commerceSupplierPaymentDocuments)
        .values({ ...body, supplierId: s.id, recordedBy: admin.id }),
    ).rejects.toMatchObject({
      cause: {
        code: "23505",
        constraint_name: "commerce_supplier_payment_documents_operation_id_unique",
      },
    });
    expect(await documents()).toEqual(before);
  });

  it("applies the named uniqueness, supplier and TEST-only database constraints", async () => {
    const s = await supplier();
    const constraints = await conn.db.execute<{ conname: string }>(
      sql`select conname from pg_constraint where conrelid='commerce_supplier_payment_documents'::regclass order by conname`,
    );
    expect(constraints.map((row) => row.conname)).toEqual([
      "commerce_supplier_payment_document_amount",
      "commerce_supplier_payment_document_scope",
      "commerce_supplier_payment_document_text",
      "commerce_supplier_payment_documents_operation_id_unique",
      "commerce_supplier_payment_documents_pkey",
      "commerce_supplier_payment_documents_supplier_fk",
    ]);
    for (const patch of [
      { amountCents: 0 },
      { currency: "USD" as never },
      { mode: "live" as never },
      { source: "bank_verified" as never },
      { reference: "" },
      { evidenceReference: "" },
      { reason: "" },
    ])
      await expect(
        conn.db
          .insert(schema.commerceSupplierPaymentDocuments)
          .values({ ...input(), supplierId: s.id, recordedBy: admin.id, ...patch }),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
    await expect(
      conn.db
        .insert(schema.commerceSupplierPaymentDocuments)
        .values({ ...input(), supplierId: key(), recordedBy: admin.id }),
    ).rejects.toMatchObject({
      cause: { code: "23503", constraint_name: "commerce_supplier_payment_documents_supplier_fk" },
    });
  });

  it("gives the inherited application role only SELECT and INSERT on document history", async () => {
    await conn.sql.unsafe(
      "DO $$ BEGIN CREATE ROLE djl_app NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$",
    );
    await conn.sql.unsafe(
      await readFile(new URL("../../../../infra/postgres/policies.sql", import.meta.url), "utf8"),
    );
    const role = "djl_doc_permission_" + key().replaceAll("-", "");
    expect(role).toMatch(/^djl_doc_permission_[a-f0-9]{32}$/);
    await conn.sql.unsafe(`CREATE ROLE "${role}" NOLOGIN IN ROLE djl_app`);
    try {
      const rights = await conn.db.execute(
        sql`select has_table_privilege(${role},'commerce_supplier_payment_documents','SELECT') r,has_table_privilege(${role},'commerce_supplier_payment_documents','INSERT') i,has_table_privilege(${role},'commerce_supplier_payment_documents','UPDATE') u,has_table_privilege(${role},'commerce_supplier_payment_documents','DELETE') d,has_table_privilege(${role},'commerce_supplier_payment_documents','TRUNCATE') t`,
      );
      expect(rights[0]).toMatchObject({ r: true, i: true, u: false, d: false, t: false });
      for (const statement of [
        "UPDATE commerce_supplier_payment_documents SET reason=reason WHERE false",
        "DELETE FROM commerce_supplier_payment_documents WHERE false",
        "TRUNCATE commerce_supplier_payment_documents",
      ])
        await expect(
          conn.db.transaction(async (tx) => {
            await tx.execute(sql.raw(`SET LOCAL ROLE "${role}"`));
            await tx.execute(sql.raw(statement));
          }),
        ).rejects.toMatchObject({ cause: { code: "42501" } });
    } finally {
      await conn.sql.unsafe(`DROP ROLE "${role}"`);
    }
  });
});
