/** Executes the checked-in read-only invariants on a fresh, owned PostgreSQL database. */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, expect, it } from "vitest";
import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";
import { CommerceService } from "../commerce/CommerceService.ts";

const conn = await isolatedCommerceTestDatabase();
const key = () => crypto.randomUUID();
afterAll(() => conn.close());
const source = readFileSync(
  new URL("../../../../infra/vps/recovery-verify.sql", import.meta.url),
  "utf8",
);
function statement(name: string) {
  const match = source.match(
    new RegExp(`\\('${name}',[\\s\\S]*?\\$query\\$([\\s\\S]*?)\\$query\\$\\)`),
  );
  if (!match) throw new Error("Missing fixed recovery invariant.");
  return sql.raw(match[1]!);
}
const family = statement("commerce_schema_families");
const consistency = statement("commerce_alert_email_delivery_consistency");
function result(rows: readonly Record<string, unknown>[]) {
  expect(rows).toHaveLength(1);
  return JSON.parse(String(Object.values(rows[0]!)[0])) as { name: string; violations: string };
}

it.each(["payment_pending", "payment_unknown"] as const)(
  "includes %s in the actual frozen-obligation recovery query",
  async (status) => {
    const service = new CommerceService(conn.db, { mode: "test", environment: "test" });
    const buyer = { id: key(), type: "user" as const, traceId: "recovery-manual-payment" };
    const approver = { id: key(), type: "admin" as const, traceId: buyer.traceId };
    const recorder = { ...approver, id: key() };
    await conn.db.insert(schema.user).values({
      id: buyer.id,
      name: "Synthetic frozen obligation",
      email: `${buyer.id}@test.invalid`,
      emailVerified: true,
    });
    await service.profile(buyer.id);
    await conn.db.insert(schema.commerceLedger).values([
      {
        eventKey: buyer.id,
        line: 0,
        ownerId: buyer.id,
        account: "available",
        amountCents: 3000,
        resourceId: buyer.id,
      },
      {
        eventKey: buyer.id,
        line: 1,
        ownerId: "platform",
        account: "commission_cost_test",
        amountCents: -3000,
        resourceId: buyer.id,
      },
    ]);
    const { withdrawal } = await service.requestWithdrawal(buyer, key());
    await service.reviewWithdrawal(approver, withdrawal.id, "approve", {});
    const intent = { operationId: key(), reason: "Synthetic recovery verification only" };
    await service.reviewWithdrawal(recorder, withdrawal.id, "start_payment", intent);
    if (status === "payment_unknown")
      await service.reviewWithdrawal(recorder, withdrawal.id, "mark_unknown", intent);
    const frozen = statement("commerce_withdrawal_frozen");
    expect(result(await conn.db.execute(frozen))).toMatchObject({ violations: "0" });

    const rollback = new Error("rollback owned frozen mismatch fixture only");
    await expect(
      conn.db.transaction(async (tx) => {
        const eventKey = key();
        await tx.insert(schema.commerceLedger).values([
          {
            eventKey,
            line: 0,
            ownerId: buyer.id,
            account: "frozen",
            amountCents: -1,
            resourceId: withdrawal.id,
          },
          {
            eventKey,
            line: 1,
            ownerId: buyer.id,
            account: "available",
            amountCents: 1,
            resourceId: withdrawal.id,
          },
        ]);
        expect(result(await tx.execute(frozen))).toMatchObject({ violations: "1" });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(result(await conn.db.execute(frozen))).toMatchObject({ violations: "0" });
  },
);

it("accepts current durable receipts with the actual fixed PostgreSQL recovery queries", async () => {
  const at = new Date("2030-01-01T00:00:00Z");
  for (const mode of ["mock", "resend"] as const) {
    const [incident] = await conn.db
      .insert(schema.commerceAlertIncidents)
      .values({
        kind: "withdrawal_requested",
        resourceType: "withdrawal",
        resourceId: crypto.randomUUID(),
        sourceStatus: "requested",
        state: "open",
        firstDetectedAt: at,
        openedAt: at,
        lastSeenAt: at,
        lastTransitionAt: at,
      })
      .returning();
    await conn.db.insert(schema.commerceAlertEmailDeliveries).values({
      incidentId: incident!.id,
      mode,
      recipient: "ops@test.invalid",
      createdAt: at,
      ...(mode === "resend"
        ? {
            state: "accepted" as const,
            claimToken: crypto.randomUUID(),
            attemptedAt: at,
            completedAt: at,
            providerId: "synthetic_provider_receipt",
          }
        : {}),
    });
  }
  expect(result(await conn.db.execute(family))).toMatchObject({
    name: "commerce_schema_families",
    violations: "0",
  });
  expect(result(await conn.db.execute(consistency))).toMatchObject({
    name: "commerce_alert_email_delivery_consistency",
    violations: "0",
  });
});

it("still accepts the pre-email schema family, without committing fixture schema changes", async () => {
  const rollback = new Error("rollback owned fixture only");
  await expect(
    conn.db.transaction(async (tx) => {
      await tx.execute(sql`drop table public.commerce_alert_email_deliveries`);
      expect(result(await tx.execute(family))).toMatchObject({ violations: "0" });
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});

it("rejects an email family without incident history, without committing fixture schema changes", async () => {
  const rollback = new Error("rollback owned fixture only");
  await expect(
    conn.db.transaction(async (tx) => {
      await tx.execute(sql`drop table public.commerce_alert_incidents cascade`);
      expect(result(await tx.execute(family))).toMatchObject({ violations: "1" });
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
