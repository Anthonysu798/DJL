import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, describe, expect, it } from "vitest";
import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";

const conn = await isolatedCommerceTestDatabase();
const key = () => crypto.randomUUID();
const approver = key(),
  starter = key();
const startedAt = new Date("2026-10-27T20:00:00Z");
const guardMessage = "First manual payment must preserve its approved withdrawal";
afterAll(() => conn.close());

async function customer() {
  const id = key();
  await conn.db
    .insert(schema.user)
    .values({ id, name: "Synthetic SQL guard customer", email: `${id}@test.invalid` });
  await conn.db.insert(schema.commerceCustomers).values({ userId: id, referralCode: key() });
  return id;
}
async function fixture(
  status: "requested" | "approved" | "paid_test" | "rejected" = "approved",
  history: Record<string, unknown> = {},
) {
  const userId = await customer();
  const [row] = await conn.db
    .insert(schema.commerceWithdrawals)
    .values({
      userId,
      amountCents: 2000,
      status,
      approvedBy: status === "requested" ? null : approver,
      reference: status === "paid_test" ? `synthetic-paid-${key()}` : null,
      recordedBy: status === "paid_test" ? starter : null,
      ...history,
    })
    .returning();
  return row!;
}
function payment(status: "payment_pending" | "payment_unknown") {
  return {
    status,
    paymentOperationId: key(),
    paymentStartedBy: starter,
    paymentStartedAt: startedAt,
    paymentUnknownAt: status === "payment_unknown" ? startedAt : null,
    approvedBy: approver,
    reference: null,
    recordedBy: null,
  };
}
async function rejectByGuard(
  row: typeof schema.commerceWithdrawals.$inferSelect,
  patch: Partial<typeof schema.commerceWithdrawals.$inferInsert>,
) {
  await expect(
    conn.db
      .update(schema.commerceWithdrawals)
      .set(patch)
      .where(eq(schema.commerceWithdrawals.id, row.id)),
  ).rejects.toMatchObject({ cause: { code: "P0001", message: guardMessage } });
  expect(
    (
      await conn.db
        .select()
        .from(schema.commerceWithdrawals)
        .where(eq(schema.commerceWithdrawals.id, row.id))
    )[0],
  ).toEqual(row);
}

describe("first manual payment database backstop", () => {
  it.each(["payment_pending", "payment_unknown"] as const)(
    "rejects direct INSERT into %s even with a complete valid operation tuple",
    async (status) => {
      const userId = await customer();
      await expect(
        conn.db
          .insert(schema.commerceWithdrawals)
          .values({ userId, amountCents: 2000, ...payment(status) }),
      ).rejects.toMatchObject({
        cause: {
          code: "P0001",
          message: "Manual payment operation requires an existing approved withdrawal",
        },
      });
      expect(
        await conn.db
          .select()
          .from(schema.commerceWithdrawals)
          .where(eq(schema.commerceWithdrawals.userId, userId)),
      ).toHaveLength(0);
    },
  );

  it.each([
    ["requested", "payment_pending"],
    ["requested", "payment_unknown"],
    ["paid_test", "payment_pending"],
    ["paid_test", "payment_unknown"],
    ["rejected", "payment_pending"],
    ["rejected", "payment_unknown"],
  ] as const)(
    "rejects %s to %s even when the new tuple satisfies the shape constraint",
    async (status, next) => {
      await rejectByGuard(await fixture(status), payment(next));
    },
  );

  it("rejects approved directly to unknown without first recording pending", async () => {
    await rejectByGuard(await fixture(), payment("payment_unknown"));
  });

  it.each(["id", "userId", "amountCents", "approvedBy", "createdAt"] as const)(
    "does not change %s while first introducing the operation",
    async (field) => {
      const row = await fixture();
      const replacement =
        field === "userId"
          ? await customer()
          : field === "amountCents"
            ? 2001
            : field === "createdAt"
              ? new Date("2026-10-01T00:00:00Z")
              : key();
      await rejectByGuard(row, { ...payment("payment_pending"), [field]: replacement });
    },
  );

  it.each(["reference", "recordedBy"] as const)(
    "does not erase old %s evidence to introduce a first operation",
    async (field) => {
      const row = await fixture("approved", {
        [field]: field === "reference" ? `synthetic-history-${key()}` : key(),
      });
      await rejectByGuard(row, payment("payment_pending"));
    },
  );

  it("allows only an unchanged approved subject to enter pending", async () => {
    const row = await fixture();
    const [started] = await conn.db
      .update(schema.commerceWithdrawals)
      .set(payment("payment_pending"))
      .where(eq(schema.commerceWithdrawals.id, row.id))
      .returning();
    expect(started).toMatchObject({
      id: row.id,
      userId: row.userId,
      amountCents: row.amountCents,
      approvedBy: row.approvedBy,
      createdAt: row.createdAt,
      status: "payment_pending",
      reference: null,
      recordedBy: null,
    });
  });
});
