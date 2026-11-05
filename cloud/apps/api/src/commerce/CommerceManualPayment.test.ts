import { eq, sql } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, describe, expect, it } from "vitest";
import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";
import { CommerceService, type CommerceActor } from "./CommerceService.ts";

const conn = await isolatedCommerceTestDatabase();
const service = new CommerceService(conn.db, { mode: "test", environment: "test" });
const approver: CommerceActor = {
  id: crypto.randomUUID(),
  type: "admin",
  traceId: "manual-payment",
};
const recorder: CommerceActor = { ...approver, id: crypto.randomUUID() };
const reason = "Synthetic manual operation, no bank request or real money";
const key = () => crypto.randomUUID();
afterAll(() => conn.close());

async function credit(userId: string) {
  const eventKey = `manual-fixture:${key()}`;
  await conn.db.insert(schema.commerceLedger).values([
    {
      eventKey,
      line: 0,
      ownerId: userId,
      account: "available",
      amountCents: 3000,
      resourceId: userId,
    },
    {
      eventKey,
      line: 1,
      ownerId: "platform",
      account: "commission_cost_test",
      amountCents: -3000,
      resourceId: userId,
    },
  ]);
}
async function fixture(approved = true) {
  const user: CommerceActor = { id: key(), type: "user", traceId: "manual-payment" };
  await conn.db.insert(schema.user).values({
    id: user.id,
    name: "Synthetic payout buyer",
    email: `${user.id}@test.invalid`,
    emailVerified: true,
  });
  await service.profile(user.id);
  await credit(user.id);
  const { withdrawal } = await service.requestWithdrawal(user, key());
  if (approved) await service.reviewWithdrawal(approver, withdrawal.id, "approve", {});
  return { user, id: withdrawal.id, operationId: key() };
}
const review = (id: string, action: string, operationId: string, actor = recorder) =>
  service.reviewWithdrawal(actor, id, action as never, { operationId, reason });
const ledger = () => conn.db.select().from(schema.commerceLedger).orderBy(schema.commerceLedger.id);

describe("manual payout uncertainty keeps money frozen", () => {
  it.each(["start_payment", "mark_unknown"])(
    "rolls the entire %s transition back when its audit cannot be written",
    async (action) => {
      const f = await fixture();
      if (action === "mark_unknown") await review(f.id, "start_payment", f.operationId);
      const before = (
        await conn.db
          .select()
          .from(schema.commerceWithdrawals)
          .where(eq(schema.commerceWithdrawals.id, f.id))
      )[0];
      const beforeLedger = await ledger();
      await conn.db.execute(
        sql.raw(`CREATE FUNCTION commerce_manual_payment_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.trace_id='manual-payment-audit-fault' AND NEW.action IN ('commerce.withdrawal.start_payment','commerce.withdrawal.mark_unknown')
        THEN RAISE EXCEPTION 'Synthetic manual payment audit fault'; END IF;
        RETURN NEW;
      END $$`),
      );
      await conn.db.execute(
        sql.raw(`CREATE TRIGGER commerce_manual_payment_audit_fault BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION commerce_manual_payment_audit_fault()`),
      );
      try {
        await expect(
          review(f.id, action, f.operationId, {
            ...recorder,
            traceId: "manual-payment-audit-fault",
          }),
        ).rejects.toMatchObject({ status: 500, code: "commerce_write_failed" });
        expect(
          (
            await conn.db
              .select()
              .from(schema.commerceWithdrawals)
              .where(eq(schema.commerceWithdrawals.id, f.id))
          )[0],
        ).toEqual(before);
        expect(await ledger()).toEqual(beforeLedger);
        const audit = await conn.db
          .select()
          .from(schema.auditEvents)
          .where(eq(schema.auditEvents.targetId, f.id));
        expect(audit.filter((row) => row.action === `commerce.withdrawal.${action}`)).toHaveLength(
          0,
        );
      } finally {
        await conn.db.execute(
          sql.raw("DROP TRIGGER commerce_manual_payment_audit_fault ON audit_events"),
        );
        await conn.db.execute(sql.raw("DROP FUNCTION commerce_manual_payment_audit_fault()"));
      }
      const result = await review(f.id, action, f.operationId);
      expect(result.withdrawal.status).toBe(
        action === "start_payment" ? "payment_pending" : "payment_unknown",
      );
      expect(result.withdrawal.paymentOperationId).toBe(f.operationId);
      const audit = await conn.db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.targetId, f.id));
      expect(audit.filter((row) => row.action === `commerce.withdrawal.${action}`)).toHaveLength(1);
      expect(await ledger()).toEqual(beforeLedger);
    },
  );

  it("does not let rejection release an approved withdrawal once external action starts", async () => {
    const f = await fixture(),
      before = await ledger();
    const started = await review(f.id, "start_payment", f.operationId);
    expect(await service.wallet(f.user.id)).toMatchObject({ availableCents: 0, frozenCents: 3000 });
    expect(started.withdrawal.status).toBe("payment_pending");
    await expect(review(f.id, "reject", f.operationId)).rejects.toHaveProperty("status", 409);
    const unknown = await review(f.id, "mark_unknown", f.operationId);
    expect(unknown.withdrawal.status).toBe("payment_unknown");
    await expect(review(f.id, "reject", f.operationId)).rejects.toHaveProperty("status", 409);
    await expect(
      service.reviewWithdrawal(recorder, f.id, "record", { reference: key(), reason }),
    ).rejects.toHaveProperty("status", 409);
    expect(await ledger()).toEqual(before);
    expect(await service.wallet(f.user.id)).toMatchObject({
      availableCents: 0,
      frozenCents: 3000,
      paidCents: 0,
    });
  });

  it("persists one operation, actor and timestamps and retries without duplicate audit or ledger writes", async () => {
    const f = await fixture(),
      before = await ledger();
    const first = (await review(f.id, "start_payment", f.operationId)).withdrawal;
    expect(first).toMatchObject({
      status: "payment_pending",
      paymentOperationId: f.operationId,
      paymentStartedBy: recorder.id,
      paymentUnknownAt: null,
    });
    expect(first.paymentStartedAt).toEqual(expect.any(String));
    expect((await review(f.id, "start_payment", f.operationId)).withdrawal).toEqual(first);
    await expect(review(f.id, "start_payment", key())).rejects.toHaveProperty("status", 409);
    await expect(review(f.id, "mark_unknown", key())).rejects.toHaveProperty("status", 409);
    const unknown = (await review(f.id, "mark_unknown", f.operationId)).withdrawal;
    expect(unknown.paymentUnknownAt).toEqual(expect.any(String));
    expect((await review(f.id, "mark_unknown", f.operationId)).withdrawal).toEqual(unknown);
    expect((await review(f.id, "start_payment", f.operationId)).withdrawal).toEqual(unknown);
    expect(await ledger()).toEqual(before);
    const audit = await conn.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.targetId, f.id));
    expect(audit.filter((row) => row.action === "commerce.withdrawal.start_payment")).toHaveLength(
      1,
    );
    expect(audit.filter((row) => row.action === "commerce.withdrawal.mark_unknown")).toHaveLength(
      1,
    );
    for (const event of audit.filter((row) =>
      ["commerce.withdrawal.start_payment", "commerce.withdrawal.mark_unknown"].includes(
        row.action,
      ),
    )) {
      expect(event.reason).toBe(reason);
      expect(event.after).toMatchObject({ operationId: f.operationId, reason, mode: "test" });
    }
  });

  it("requires approval, an independent administrator, a UUID, and a review reason", async () => {
    const requested = await fixture(false);
    await expect(
      review(requested.id, "start_payment", requested.operationId),
    ).rejects.toHaveProperty("status", 409);
    await expect(
      review(requested.id, "mark_unknown", requested.operationId),
    ).rejects.toHaveProperty("status", 409);
    const f = await fixture();
    await expect(review(f.id, "start_payment", f.operationId, approver)).rejects.toHaveProperty(
      "status",
      409,
    );
    await expect(review(f.id, "start_payment", f.operationId, f.user)).rejects.toHaveProperty(
      "status",
      403,
    );
    await expect(review(f.id, "start_payment", "not-a-uuid")).rejects.toHaveProperty("status", 400);
    await expect(
      service.reviewWithdrawal(recorder, f.id, "start_payment" as never, {
        operationId: f.operationId,
        reason: " ",
      }),
    ).rejects.toHaveProperty("status", 400);
  });

  it("serializes start against rejection so only one branch can win", async () => {
    for (let i = 0; i < 4; i++) {
      const f = await fixture();
      const results = await Promise.allSettled([
        review(f.id, "start_payment", f.operationId),
        review(f.id, "reject", f.operationId),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const { withdrawal } = await service.adminWithdrawal(f.id);
      const wallet = await service.wallet(f.user.id);
      if (withdrawal.status === "payment_pending")
        expect(wallet).toMatchObject({ availableCents: 0, frozenCents: 3000 });
      else {
        expect(withdrawal.status).toBe("rejected");
        expect(wallet).toMatchObject({ availableCents: 3000, frozenCents: 0 });
      }
    }
  });

  it.each(["payment_pending", "payment_unknown"])(
    "keeps %s active for new applications, filters and database uniqueness",
    async (status) => {
      const f = await fixture();
      await review(f.id, "start_payment", f.operationId);
      if (status === "payment_unknown") await review(f.id, "mark_unknown", f.operationId);
      await credit(f.user.id);
      await expect(service.requestWithdrawal(f.user, key())).rejects.toMatchObject({
        status: 409,
        code: "withdrawal_pending",
      });
      expect(
        (await service.listWithdrawals(f.user.id, 0, status)).withdrawals.map((row) => row.id),
      ).toContain(f.id);
      await expect(
        conn.db.insert(schema.commerceWithdrawals).values({ userId: f.user.id, amountCents: 2000 }),
      ).rejects.toThrow();
    },
  );

  it("does not reuse an internal operation for another withdrawal and never enables production", async () => {
    const f = await fixture(),
      other = await fixture();
    await review(f.id, "start_payment", f.operationId);
    await expect(review(other.id, "start_payment", f.operationId)).rejects.toHaveProperty(
      "status",
      409,
    );
    const production = new CommerceService(conn.db, { mode: "test", environment: "production" });
    await expect(
      production.reviewWithdrawal(recorder, other.id, "start_payment" as never, {
        operationId: other.operationId,
        reason,
      }),
    ).rejects.toHaveProperty("status", 503);
  });

  it("serializes repeated and conflicting start intents without duplicating their audit", async () => {
    const f = await fixture();
    const same = await Promise.all([
      review(f.id, "start_payment", f.operationId),
      review(f.id, "start_payment", f.operationId),
    ]);
    expect(same[0]).toEqual(same[1]);
    const other = await fixture();
    const different = await Promise.allSettled([
      review(other.id, "start_payment", key()),
      review(other.id, "start_payment", key()),
    ]);
    expect(different.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const audit = await conn.db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.targetId, f.id));
    expect(audit.filter((row) => row.action === "commerce.withdrawal.start_payment")).toHaveLength(
      1,
    );
  });

  it("database guards keep unresolved intent identities and frozen obligations from being erased", async () => {
    const f = await fixture();
    await review(f.id, "start_payment", f.operationId);
    await expect(
      conn.db
        .update(schema.commerceWithdrawals)
        .set({ paymentOperationId: key() })
        .where(eq(schema.commerceWithdrawals.id, f.id)),
    ).rejects.toThrow();
    await expect(
      conn.db
        .update(schema.commerceWithdrawals)
        .set({
          status: "rejected",
          paymentOperationId: null,
          paymentStartedBy: null,
          paymentStartedAt: null,
        })
        .where(eq(schema.commerceWithdrawals.id, f.id)),
    ).rejects.toThrow();
    await review(f.id, "mark_unknown", f.operationId);
    await expect(
      conn.db
        .update(schema.commerceWithdrawals)
        .set({ paymentUnknownAt: null })
        .where(eq(schema.commerceWithdrawals.id, f.id)),
    ).rejects.toThrow();
    expect(await service.wallet(f.user.id)).toMatchObject({ frozenCents: 3000, availableCents: 0 });
  });
});
