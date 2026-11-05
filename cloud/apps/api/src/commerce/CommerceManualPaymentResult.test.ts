import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { createDatabase, schema } from "@djl/db";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";
import { CommerceService, type CommerceActor } from "./CommerceService.ts";

const conn = await isolatedCommerceTestDatabase();
const confirmationTime = new Date("2026-10-28T12:00:00Z");
const service = new CommerceService(conn.db, {
  mode: "test",
  environment: "test",
  now: () => confirmationTime,
});
const approver: CommerceActor = {
  id: crypto.randomUUID(),
  type: "admin",
  traceId: "manual-payment-result",
};
const recorder: CommerceActor = { ...approver, id: crypto.randomUUID() };
const reason = "Synthetic manual result; no bank request or real money";
const key = () => crypto.randomUUID();
afterAll(() => conn.close());

async function fixture(start = true) {
  const user: CommerceActor = { id: key(), type: "user", traceId: "manual-payment-result" };
  await conn.db.insert(schema.user).values({
    id: user.id,
    name: "Synthetic manual result buyer",
    email: user.id + "@test.invalid",
    emailVerified: true,
  });
  await service.profile(user.id);
  await conn.db.insert(schema.commerceLedger).values([
    {
      eventKey: "manual-result-fixture:" + user.id,
      line: 0,
      ownerId: user.id,
      account: "available",
      amountCents: 3000,
      resourceId: user.id,
    },
    {
      eventKey: "manual-result-fixture:" + user.id,
      line: 1,
      ownerId: "platform",
      account: "commission_cost_test",
      amountCents: -3000,
      resourceId: user.id,
    },
  ]);
  const { withdrawal } = await service.requestWithdrawal(user, key());
  await service.reviewWithdrawal(approver, withdrawal.id, "approve", {});
  const input = {
    operationId: key(),
    amountCents: 3000,
    currency: "CAD",
    reference: "synthetic-result-" + key(),
    evidenceReference: "Synthetic receipt reference " + key(),
    reason,
  };
  if (start)
    await service.reviewWithdrawal(recorder, withdrawal.id, "start_payment", {
      operationId: input.operationId,
      reason,
    });
  return { user, id: withdrawal.id, input };
}

const confirm = (id: string, input: Record<string, unknown>, actor = recorder) =>
  service.reviewWithdrawal(actor, id, "confirm_payment_success" as never, input);

const payoutEntries = (id: string) =>
  conn.db
    .select()
    .from(schema.commerceLedger)
    .where(eq(schema.commerceLedger.eventKey, "payout:" + id));

const confirmationAudit = async (id: string) =>
  (
    await conn.db.select().from(schema.auditEvents).where(eq(schema.auditEvents.targetId, id))
  ).filter((row) => row.action === "commerce.withdrawal.confirm_payment_success");

async function legacyDatabase(
  work: (db: ReturnType<typeof createDatabase>["db"]) => Promise<void>,
) {
  const base = new URL(process.env.DATABASE_URL ?? "postgres://djl:djl@localhost:54329/djl");
  if (
    (process.env.DJL_ENV && !["local", "test"].includes(process.env.DJL_ENV)) ||
    !["postgres:", "postgresql:"].includes(base.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
  )
    throw new Error("Manual result upgrade requires loopback test PostgreSQL.");
  const name = "djl_commerce_upgrade_" + key().replaceAll("-", "");
  const owned = () => /^djl_commerce_upgrade_[0-9a-f]{32}$/.test(name);
  const temporary = await mkdtemp(join(tmpdir(), "djl-manual-result-upgrade-"));
  const migrations = fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url));
  const admin = postgres(base.href, { max: 1, prepare: false, connect_timeout: 10 });
  let created = false;
  let connection: ReturnType<typeof createDatabase> | undefined;
  try {
    const journal = JSON.parse(await readFile(join(migrations, "meta/_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries).toHaveLength(23);
    expect(journal.entries[18]).toMatchObject({ idx: 18, tag: "0018_commerce_favorites" });
    expect(journal.entries[19]).toMatchObject({ idx: 19, tag: "0019_commerce_staff" });
    expect(journal.entries[20]).toMatchObject({ idx: 20, tag: "0020_commerce_auth_realm" });
    expect(journal.entries[21]).toMatchObject({ idx: 21, tag: "0021_commerce_photo_lifecycle" });
    expect(journal.entries[22]).toMatchObject({
      idx: 22,
      tag: "0022_commerce_image_cleanup_retry",
    });
    journal.entries = journal.entries.filter((entry) => entry.idx < 16);
    await mkdir(join(temporary, "meta"));
    await writeFile(join(temporary, "meta/_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries)
      await copyFile(join(migrations, entry.tag + ".sql"), join(temporary, entry.tag + ".sql"));
    if (!owned()) throw new Error("Invalid owned upgrade database name.");
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    created = true;
    const target = new URL(base.href);
    target.pathname = "/" + name;
    connection = createDatabase(target.href, { max: 4 });
    await migrate(connection.db, { migrationsFolder: temporary });
    expect(
      (
        await connection.db.execute(sql`select count(*)::int n from drizzle.__drizzle_migrations`)
      )[0]?.n,
    ).toBe(16);
    await work(connection.db);
  } finally {
    try {
      await connection?.close();
      if (created) {
        assert(owned(), "Refusing to drop an unowned upgrade database.");
        await admin.unsafe(`DROP DATABASE "${name}"`);
      }
    } finally {
      await admin.end({ timeout: 5 });
      assert(
        resolve(dirname(temporary)) === resolve(tmpdir()) &&
          temporary.startsWith(join(tmpdir(), "djl-manual-result-upgrade-")),
        "Refusing to remove an unowned migration directory.",
      );
      await rm(temporary, { recursive: true });
    }
  }
}

describe("manual TEST payment success result", () => {
  it("confirms the original pending operation exactly once", async () => {
    const f = await fixture();
    const before = (await service.adminWithdrawal(f.id)).withdrawal;
    const first = (await confirm(f.id, f.input)).withdrawal;
    expect(first).toMatchObject({
      status: "paid_test",
      paymentOperationId: f.input.operationId,
      paymentStartedBy: recorder.id,
      paymentStartedAt: before.paymentStartedAt,
      paymentUnknownAt: null,
      reference: f.input.reference,
      paymentConfirmedAt: confirmationTime.toISOString(),
      paymentConfirmedBy: recorder.id,
      paymentEvidenceReference: f.input.evidenceReference,
      paymentConfirmationReason: f.input.reason,
    });
    expect(await service.wallet(f.user.id)).toMatchObject({
      availableCents: 0,
      frozenCents: 0,
      paidCents: 3000,
      recoveryCents: 0,
    });
    const entries = await payoutEntries(f.id);
    expect(entries).toHaveLength(2);
    expect(entries.map((row) => [row.account, row.amountCents]).toSorted()).toEqual([
      ["frozen", -3000],
      ["paid", 3000],
    ]);
    expect((await confirm(f.id, f.input)).withdrawal).toEqual(first);
    expect(await payoutEntries(f.id)).toEqual(entries);
    const audit = await confirmationAudit(f.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: recorder.id,
      reason,
      after: { ...f.input, mode: "test" },
    });
  });

  it("confirms an unknown result without erasing its original operation history", async () => {
    const f = await fixture();
    await service.reviewWithdrawal(recorder, f.id, "mark_unknown", {
      operationId: f.input.operationId,
      reason,
    });
    const before = (await service.adminWithdrawal(f.id)).withdrawal;
    expect(before.paymentUnknownAt).toEqual(expect.any(String));
    const result = (await confirm(f.id, f.input)).withdrawal;
    expect(result).toMatchObject({
      status: "paid_test",
      paymentOperationId: before.paymentOperationId,
      paymentStartedBy: before.paymentStartedBy,
      paymentStartedAt: before.paymentStartedAt,
      paymentUnknownAt: before.paymentUnknownAt,
    });
    expect(await payoutEntries(f.id)).toHaveLength(2);
  });

  it("rolls back a confirmation clock earlier than the existing unknown registration", async () => {
    const f = await fixture();
    const unknownTime = new Date(confirmationTime.getTime() + 60_000);
    const later = new CommerceService(conn.db, { ...service.options, now: () => unknownTime });
    await later.reviewWithdrawal(recorder, f.id, "mark_unknown", {
      operationId: f.input.operationId,
      reason,
    });
    const before = (await service.adminWithdrawal(f.id)).withdrawal;
    expect(before.paymentUnknownAt).toBe(unknownTime.toISOString());
    await expect(confirm(f.id, f.input)).rejects.toMatchObject({
      status: 500,
      code: "commerce_write_failed",
    });
    expect((await service.adminWithdrawal(f.id)).withdrawal).toEqual(before);
    expect(await payoutEntries(f.id)).toHaveLength(0);
    expect(await confirmationAudit(f.id)).toHaveLength(0);
    expect(await service.wallet(f.user.id)).toMatchObject({ frozenCents: 3000, paidCents: 0 });
    await expect(
      conn.db
        .update(schema.commerceWithdrawals)
        .set({
          status: "paid_test",
          reference: f.input.reference,
          reason,
          recordedBy: recorder.id,
          paymentConfirmedAt: confirmationTime,
          paymentEvidenceReference: f.input.evidenceReference,
        })
        .where(eq(schema.commerceWithdrawals.id, f.id)),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "commerce_withdrawal_payment_identity" },
    });
    expect((await service.adminWithdrawal(f.id)).withdrawal).toEqual(before);
    const confirmed = await later.reviewWithdrawal(
      recorder,
      f.id,
      "confirm_payment_success",
      f.input,
    );
    expect(confirmed.withdrawal).toMatchObject({
      status: "paid_test",
      paymentUnknownAt: unknownTime.toISOString(),
      paymentConfirmedAt: unknownTime.toISOString(),
    });
    expect(await payoutEntries(f.id)).toHaveLength(2);
    expect(await confirmationAudit(f.id)).toHaveLength(1);
  });

  it("exposes the approver and confirmation evidence only through administrator projections", async () => {
    const f = await fixture();
    await confirm(f.id, f.input);
    for (const result of [
      (await service.adminWithdrawal(f.id)).withdrawal,
      (await service.listWithdrawals()).withdrawals.find((row) => row.id === f.id),
    ]) {
      expect(result).toMatchObject({
        approvedBy: approver.id,
        paymentConfirmedAt: confirmationTime.toISOString(),
        paymentConfirmedBy: recorder.id,
        paymentEvidenceReference: f.input.evidenceReference,
        paymentConfirmationReason: reason,
      });
    }
    const publicRow = (await service.listWithdrawals(f.user.id)).withdrawals[0]!;
    for (const field of [
      "approvedBy",
      "paymentConfirmedAt",
      "paymentConfirmedBy",
      "paymentEvidenceReference",
      "paymentConfirmationReason",
    ])
      expect(publicRow).not.toHaveProperty(field);
    expect(JSON.stringify(publicRow)).not.toContain(f.input.evidenceReference);
  });

  it("does not record a legacy TEST payment when an approved row has no approving actor", async () => {
    const f = await fixture(false);
    await conn.db
      .update(schema.commerceWithdrawals)
      .set({ approvedBy: null })
      .where(eq(schema.commerceWithdrawals.id, f.id));
    await expect(
      service.reviewWithdrawal(recorder, f.id, "record", { reference: f.input.reference, reason }),
    ).rejects.toMatchObject({ status: 409, code: "withdrawal_conflict" });
    expect(await payoutEntries(f.id)).toHaveLength(0);
    expect(await service.wallet(f.user.id)).toMatchObject({ frozenCents: 3000, paidCents: 0 });
  });

  it.each([
    ["operationId", "invalid-uuid", 400],
    ["operationId", "00000000-0000-4000-8000-000000000009", 409],
    ["amountCents", 2999, 409],
    ["amountCents", 3000.5, 400],
    ["amountCents", "3000", 400],
    ["currency", "USD", 400],
    ["reference", " ", 400],
    ["reference", "x".repeat(151), 400],
    ["evidenceReference", " ", 400],
    ["evidenceReference", "x".repeat(501), 400],
    ["reason", " ", 400],
    ["reason", "x".repeat(501), 400],
  ])("rejects invalid %s without changing frozen money", async (field, value, status) => {
    const f = await fixture();
    const before = (await service.adminWithdrawal(f.id)).withdrawal;
    await expect(confirm(f.id, { ...f.input, [field]: value })).rejects.toHaveProperty(
      "status",
      status,
    );
    expect((await service.adminWithdrawal(f.id)).withdrawal).toEqual(before);
    expect(await payoutEntries(f.id)).toHaveLength(0);
    expect(await confirmationAudit(f.id)).toHaveLength(0);
    expect(await service.wallet(f.user.id)).toMatchObject({ frozenCents: 3000, paidCents: 0 });
  });

  it("requires an independent administrator even when called without HTTP", async () => {
    const f = await fixture();
    for (const [actor, status] of [
      [f.user, 403],
      [{ ...recorder, type: "user" as const }, 403],
      [{ ...recorder, type: "system" as const }, 403],
      [approver, 409],
    ] as const)
      await expect(confirm(f.id, f.input, actor)).rejects.toHaveProperty("status", status);
    expect(await payoutEntries(f.id)).toHaveLength(0);
    expect(await confirmationAudit(f.id)).toHaveLength(0);
  });

  it("canonically replays the full result and rejects altered confirmation facts", async () => {
    const f = await fixture();
    const first = (await confirm(f.id, f.input)).withdrawal;
    expect(
      (
        await confirm(f.id, {
          ...f.input,
          operationId: f.input.operationId.toUpperCase(),
          reference: " " + f.input.reference + " ",
          evidenceReference: " " + f.input.evidenceReference + " ",
          reason: " " + f.input.reason + " ",
        })
      ).withdrawal,
    ).toEqual(first);
    for (const change of [
      { operationId: key() },
      { amountCents: 2999 },
      { reference: "another-reference" },
      { evidenceReference: "another-evidence" },
      { reason: "another-reason" },
    ])
      await expect(confirm(f.id, { ...f.input, ...change })).rejects.toHaveProperty("status", 409);
    expect(await payoutEntries(f.id)).toHaveLength(2);
    expect(await confirmationAudit(f.id)).toHaveLength(1);
  });

  it("serializes simultaneous identical confirmations without a second journal or audit", async () => {
    const f = await fixture();
    const results = await Promise.all([confirm(f.id, f.input), confirm(f.id, f.input)]);
    expect(results[1]).toEqual(results[0]);
    expect(await payoutEntries(f.id)).toHaveLength(2);
    expect(await confirmationAudit(f.id)).toHaveLength(1);
  });

  it("allows only one conflicting result for the same operation", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      confirm(f.id, f.input),
      confirm(f.id, { ...f.input, reference: "conflict-" + key() }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await payoutEntries(f.id)).toHaveLength(2);
    expect(await confirmationAudit(f.id)).toHaveLength(1);
  });

  it("does not share a payment reference between concurrent withdrawals", async () => {
    const a = await fixture();
    const b = await fixture();
    const results = await Promise.allSettled([
      confirm(a.id, a.input),
      confirm(b.id, { ...b.input, reference: a.input.reference }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toHaveProperty("status", 409);
    expect([...(await payoutEntries(a.id)), ...(await payoutEntries(b.id))]).toHaveLength(2);
    expect([...(await confirmationAudit(a.id)), ...(await confirmationAudit(b.id))]).toHaveLength(
      1,
    );
  });

  it("rolls back result, journal and evidence when the same-transaction audit fails", async () => {
    const f = await fixture();
    const before = (await service.adminWithdrawal(f.id)).withdrawal;
    await conn.db.execute(
      sql.raw(`CREATE FUNCTION commerce_manual_result_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.trace_id='manual-result-audit-fault' AND NEW.action='commerce.withdrawal.confirm_payment_success'
        THEN RAISE EXCEPTION 'Synthetic result audit failure'; END IF;
        RETURN NEW;
      END $$`),
    );
    await conn.db.execute(
      sql.raw(`CREATE TRIGGER commerce_manual_result_audit_fault BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION commerce_manual_result_audit_fault()`),
    );
    try {
      await expect(
        confirm(f.id, f.input, { ...recorder, traceId: "manual-result-audit-fault" }),
      ).rejects.toMatchObject({
        status: 500,
        code: "commerce_write_failed",
      });
      expect((await service.adminWithdrawal(f.id)).withdrawal).toEqual(before);
      expect(await payoutEntries(f.id)).toHaveLength(0);
      expect(await confirmationAudit(f.id)).toHaveLength(0);
      expect(await service.wallet(f.user.id)).toMatchObject({ frozenCents: 3000, paidCents: 0 });
    } finally {
      await conn.db.execute(
        sql.raw("DROP TRIGGER commerce_manual_result_audit_fault ON audit_events"),
      );
      await conn.db.execute(sql.raw("DROP FUNCTION commerce_manual_result_audit_fault()"));
    }
    expect((await confirm(f.id, f.input)).withdrawal.status).toBe("paid_test");
  });

  it("retains the operation identity permanently after success", async () => {
    const f = await fixture();
    await confirm(f.id, f.input);
    const other = await fixture(false);
    await expect(
      service.reviewWithdrawal(recorder, other.id, "start_payment", {
        operationId: f.input.operationId,
        reason,
      }),
    ).rejects.toHaveProperty("status", 409);
    expect((await service.adminWithdrawal(other.id)).withdrawal.status).toBe("approved");
  });

  it("keeps legacy record and rejection blocked for unresolved operations", async () => {
    const f = await fixture();
    for (const status of ["payment_pending", "payment_unknown"]) {
      if (status === "payment_unknown")
        await service.reviewWithdrawal(recorder, f.id, "mark_unknown", {
          operationId: f.input.operationId,
          reason,
        });
      await expect(
        service.reviewWithdrawal(recorder, f.id, "record", {
          reference: f.input.reference,
          reason,
        }),
      ).rejects.toHaveProperty("status", 409);
      await expect(
        service.reviewWithdrawal(recorder, f.id, "reject", { reason }),
      ).rejects.toHaveProperty("status", 409);
    }
    expect(await payoutEntries(f.id)).toHaveLength(0);
    expect(await service.wallet(f.user.id)).toMatchObject({ frozenCents: 3000, paidCents: 0 });
  });

  it("does not reinterpret a legacy recorded payment as a confirmed operation", async () => {
    const f = await fixture(false);
    await service.reviewWithdrawal(recorder, f.id, "record", {
      reference: f.input.reference,
      reason,
    });
    await expect(confirm(f.id, f.input)).rejects.toHaveProperty("status", 409);
    expect((await service.adminWithdrawal(f.id)).withdrawal).toMatchObject({
      status: "paid_test",
      paymentOperationId: null,
      paymentConfirmedAt: null,
      paymentConfirmedBy: null,
      paymentEvidenceReference: null,
      paymentConfirmationReason: null,
    });
  });

  it("does not enable result recording in disabled or production commerce", async () => {
    const f = await fixture();
    for (const options of [
      { mode: "disabled" as const, environment: "test" as const },
      { mode: "test" as const, environment: "production" as const },
    ]) {
      const disabled = new CommerceService(conn.db, options);
      await expect(
        disabled.reviewWithdrawal(recorder, f.id, "confirm_payment_success", f.input),
      ).rejects.toHaveProperty("status", 503);
    }
    expect(await payoutEntries(f.id)).toHaveLength(0);
  });

  it("makes the confirmed result and original tuple immutable in SQL", async () => {
    const f = await fixture();
    await confirm(f.id, f.input);
    const before = (await service.adminWithdrawal(f.id)).withdrawal;
    for (const change of [
      { paymentOperationId: key() },
      { amountCents: 3001 },
      { paymentStartedBy: key() },
      { paymentStartedAt: new Date("2026-10-27T00:00:00Z") },
      { paymentUnknownAt: confirmationTime },
      { paymentConfirmedAt: new Date("2026-10-29T00:00:00Z") },
      { paymentEvidenceReference: "Replacement evidence" },
      { recordedBy: key() },
      { reference: "Replacement reference" },
      { reason: "Replacement reason" },
      { status: "approved" as const },
    ])
      await expect(
        conn.db
          .update(schema.commerceWithdrawals)
          .set(change)
          .where(eq(schema.commerceWithdrawals.id, f.id)),
      ).rejects.toThrow();
    expect((await service.adminWithdrawal(f.id)).withdrawal).toEqual(before);
  });

  it("rejects incomplete or mismatched SQL confirmation tuples", async () => {
    const f = await fixture();
    const before = (await service.adminWithdrawal(f.id)).withdrawal;
    const valid = {
      status: "paid_test" as const,
      reference: f.input.reference,
      reason,
      recordedBy: recorder.id,
      paymentConfirmedAt: confirmationTime,
      paymentEvidenceReference: f.input.evidenceReference,
    };
    for (const change of [
      { paymentOperationId: key() },
      { amountCents: 3001 },
      { paymentUnknownAt: confirmationTime },
      { paymentConfirmedAt: null },
      { paymentEvidenceReference: "" },
      { recordedBy: approver.id },
      { recordedBy: f.user.id },
      { reference: "" },
      { reason: "" },
    ])
      await expect(
        conn.db
          .update(schema.commerceWithdrawals)
          .set({ ...valid, ...change })
          .where(eq(schema.commerceWithdrawals.id, f.id)),
      ).rejects.toThrow();
    expect((await service.adminWithdrawal(f.id)).withdrawal).toEqual(before);
    expect(await payoutEntries(f.id)).toHaveLength(0);
  });

  it("preserves later refund recovery and open review flags when confirming the paid result", async () => {
    let now = new Date("2026-10-01T00:00:00Z");
    const actual = new CommerceService(conn.db, {
      mode: "test",
      environment: "test",
      now: () => now,
    });
    const user = async (): Promise<CommerceActor> => {
      const id = key();
      await conn.db.insert(schema.user).values({
        id,
        name: "Synthetic refund buyer",
        email: id + "@test.invalid",
        emailVerified: true,
      });
      await actual.profile(id);
      return { id, type: "user", traceId: "manual-payment-result" };
    };
    const buyer = await user(),
      referrer = await user(),
      supplierUser = await user();
    const { supplier } = await actual.createSupplier(approver, {
      name: "Synthetic result supplier",
      returnAddress: "Toronto, ON, Canada",
      reason,
      idempotencyKey: key(),
    });
    await actual.addSupplierMember(approver, supplier.id, supplierUser.id, reason);
    const { product } = await actual.saveProduct(approver, {
      supplierId: supplier.id,
      sku: key(),
      name: "Synthetic tote",
      description: "Test refund item",
      category: "Bags",
      imageUrl: "/shop/media/test-tote.png",
      priceCents: 10000,
      costCents: 4000,
      commissionBps: 1000,
      returnDays: 30,
      stock: 3,
      status: "published",
      reason,
    });
    await actual.bindReferral(buyer, (await actual.profile(referrer.id)).referralCode);
    const { order } = await actual.createOrder(buyer, {
      items: [{ productId: product.id, quantity: 3 }],
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
    await actual.testPay(buyer, order.id, key());
    const itemId = order.items[0]!.id;
    await actual.accept(supplierUser, itemId);
    await actual.ship(supplierUser, itemId, {
      carrier: "Synthetic courier",
      trackingNumber: key(),
    });
    await actual.deliver(approver, itemId, reason);
    now = new Date("2026-11-01T00:00:00Z");
    await actual.releaseCommissions(approver, reason);
    const { withdrawal } = await actual.requestWithdrawal(referrer, key());
    await actual.reviewWithdrawal(approver, withdrawal.id, "approve", {});
    const input = {
      operationId: key(),
      amountCents: 3000,
      currency: "CAD",
      reference: "synthetic-refund-result-" + key(),
      evidenceReference: "Synthetic receipt " + key(),
      reason,
    };
    await actual.reviewWithdrawal(recorder, withdrawal.id, "start_payment", {
      operationId: input.operationId,
      reason,
    });
    await actual.refund(approver, itemId, {
      refundTotalCents: 10000,
      reason,
      idempotencyKey: key(),
    });
    await actual.setOpenCase(approver, itemId, true, reason);
    await actual.reviewWithdrawal(recorder, withdrawal.id, "mark_unknown", {
      operationId: input.operationId,
      reason,
    });
    expect(await actual.wallet(referrer.id)).toMatchObject({
      frozenCents: 3000,
      recoveryCents: 1000,
      paidCents: 0,
    });
    const itemBefore = (await actual.adminOrder(order.id)).order;
    const recoveryBefore = (await actual.ledgerEntries(referrer.id)).entries.filter(
      (row) => row.account === "recovery",
    );
    const result = await actual.reviewWithdrawal(
      recorder,
      withdrawal.id,
      "confirm_payment_success",
      input,
    );
    expect(result.withdrawal.status).toBe("paid_test");
    expect(await actual.wallet(referrer.id)).toMatchObject({
      availableCents: 0,
      frozenCents: 0,
      recoveryCents: 1000,
      paidCents: 3000,
    });
    expect((await actual.adminOrder(order.id)).order).toEqual(itemBefore);
    expect(
      (await actual.ledgerEntries(referrer.id)).entries.filter((row) => row.account === "recovery"),
    ).toEqual(recoveryBefore);
    expect(await payoutEntries(withdrawal.id)).toHaveLength(2);
  });

  it("upgrades nonempty migration16 records without rewriting their original payment identity", async () => {
    await legacyDatabase(async (db) => {
      const prior: { id: string; userId: string; status: string; operationId: string | null }[] =
        [];
      const startedAt = new Date("2026-10-28T10:00:00Z");
      for (const status of [
        "requested",
        "approved",
        "paid_test",
        "rejected",
        "payment_pending",
        "payment_unknown",
      ]) {
        const userId = key(),
          id = key();
        // Seed the historical schema, not today's Drizzle columns.
        await db.execute(sql`insert into "user" (id,name,email,email_verified)
          values (${userId}::uuid,'Synthetic upgrade buyer',${userId + "@test.invalid"},true)`);
        await db.insert(schema.commerceCustomers).values({ userId, referralCode: key() });
        const unresolved = status === "payment_pending" || status === "payment_unknown";
        const initial = unresolved ? "approved" : status;
        const reference = status === "paid_test" ? "synthetic-legacy-" + key() : null;
        await db.execute(sql`insert into commerce_withdrawals (id,user_id,amount_cents,status,approved_by,reference,recorded_by)
          values (${id}::uuid,${userId}::uuid,3000,${initial},${status === "requested" ? null : approver.id}::uuid,${reference},${status === "paid_test" ? recorder.id : null}::uuid)`);
        const operationId = unresolved ? key() : null;
        if (unresolved) {
          await db.execute(
            sql`update commerce_withdrawals set status='payment_pending',payment_operation_id=${operationId}::uuid,payment_started_by=${recorder.id}::uuid,payment_started_at=${startedAt.toISOString()}::timestamptz where id=${id}::uuid`,
          );
          if (status === "payment_unknown")
            await db.execute(
              sql`update commerce_withdrawals set status='payment_unknown',payment_unknown_at=${startedAt.toISOString()}::timestamptz where id=${id}::uuid`,
            );
          await db.insert(schema.commerceLedger).values([
            {
              eventKey: "upgrade-fixture:" + id,
              line: 0,
              ownerId: userId,
              account: "frozen",
              amountCents: 3000,
              resourceId: id,
            },
            {
              eventKey: "upgrade-fixture:" + id,
              line: 1,
              ownerId: "platform",
              account: "commission_cost_test",
              amountCents: -3000,
              resourceId: id,
            },
          ]);
        }
        prior.push({ id, userId, status, operationId });
      }
      const before = await db.execute<{ data: Record<string, unknown> }>(
        sql`select to_jsonb(w) data from commerce_withdrawals w order by id`,
      );
      const migrations = fileURLToPath(new URL("../../../../packages/db/drizzle", import.meta.url));
      await migrate(db, { migrationsFolder: migrations });
      expect(
        (await db.execute(sql`select count(*)::int n from drizzle.__drizzle_migrations`))[0]?.n,
      ).toBe(23);
      expect(await db.execute(sql`select * from commerce_favorites`)).toHaveLength(0);
      expect(
        await db.execute(sql`select id from "user" where commerce_auth_generation <> 0`),
      ).toHaveLength(0);
      const after = await db.execute<{ data: Record<string, unknown> }>(
        sql`select to_jsonb(w) data from commerce_withdrawals w order by id`,
      );
      expect(after.map((row) => row.data)).toEqual(
        before.map((row) =>
          Object.assign({}, row.data, {
            payment_confirmed_at: null,
            payment_evidence_reference: null,
          }),
        ),
      );
      const upgraded = new CommerceService(db, {
        mode: "test",
        environment: "test",
        now: () => confirmationTime,
      });
      for (const row of prior.filter((row) => row.operationId)) {
        const input = {
          operationId: row.operationId!,
          amountCents: 3000,
          currency: "CAD",
          reference: "synthetic-upgrade-" + key(),
          evidenceReference: "Synthetic upgrade receipt",
          reason,
        };
        const result = await upgraded.reviewWithdrawal(
          recorder,
          row.id,
          "confirm_payment_success",
          input,
        );
        expect(result.withdrawal).toMatchObject({
          status: "paid_test",
          paymentOperationId: row.operationId,
          paymentStartedAt: startedAt.toISOString(),
          paymentUnknownAt: row.status === "payment_unknown" ? startedAt.toISOString() : null,
        });
        await expect(
          db.execute(
            sql`update commerce_withdrawals set payment_operation_id=null where id=${row.id}::uuid`,
          ),
        ).rejects.toThrow();
      }
    });
  });
});
