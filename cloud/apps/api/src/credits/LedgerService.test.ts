import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { creditsToMicro, totalAvailable } from "@djl/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedOrg, testDatabase } from "../testing/db.ts";
import { UsageWindowExhaustedError } from "../usage/windowStore.ts";
import {
  DuplicateIdempotencyKeyError,
  InsufficientCreditsError,
  LedgerService,
} from "./LedgerService.ts";

const conn = testDatabase();
const ledger = new LedgerService(conn.db);
let orgId: string;

beforeAll(async () => {
  ({ orgId } = await seedOrg(conn.db, "ledger"));
});
afterAll(async () => {
  await conn.close();
});

describe("LedgerService", () => {
  it("grants, reserves, settles, and keeps the materialized balance equal to the fold", async () => {
    await ledger.grant({
      orgId,
      bucket: "plan",
      type: "plan_grant",
      amount: creditsToMicro(2000),
      idempotencyKey: `g:${orgId}:1`,
      actor: "test",
    });
    await ledger.grant({
      orgId,
      bucket: "topup",
      type: "topup",
      amount: creditsToMicro(500),
      idempotencyKey: `g:${orgId}:2`,
      actor: "test",
    });
    expect(await ledger.available(orgId)).toBe(creditsToMicro(2500));

    const reservationId = crypto.randomUUID();
    const afterReserve = await ledger.reserve({
      orgId,
      reservationId,
      estimate: creditsToMicro(300),
      idempotencyKey: `r:${reservationId}`,
      actor: "test",
    });
    expect(totalAvailable(afterReserve.balances)).toBe(creditsToMicro(2200));

    const { balances, uncovered } = await ledger.settle({
      orgId,
      reservationId,
      actual: creditsToMicro(120),
      idempotencyKey: `r:${reservationId}`,
      actor: "test",
    });
    expect(uncovered).toBe(0n);
    expect(totalAvailable(balances)).toBe(creditsToMicro(2380));

    const { before, after } = await ledger.refold(orgId);
    expect(before).toEqual(after);
  });

  it("rejects duplicate idempotency keys", async () => {
    await expect(
      ledger.grant({
        orgId,
        bucket: "plan",
        type: "plan_grant",
        amount: 1n,
        idempotencyKey: `g:${orgId}:1`,
        actor: "test",
      }),
    ).rejects.toBeInstanceOf(DuplicateIdempotencyKeyError);
  });

  it("settle is idempotent: a second settle of the same reservation changes nothing", async () => {
    const reservationId = crypto.randomUUID();
    await ledger.reserve({
      orgId,
      reservationId,
      estimate: creditsToMicro(10),
      idempotencyKey: `r:${reservationId}`,
      actor: "test",
    });
    const first = await ledger.settle({
      orgId,
      reservationId,
      actual: creditsToMicro(4),
      idempotencyKey: `r:${reservationId}`,
      actor: "test",
    });
    const second = await ledger.settle({
      orgId,
      reservationId,
      actual: creditsToMicro(4),
      idempotencyKey: `r:${reservationId}`,
      actor: "test",
    });
    expect(second.balances).toEqual(first.balances);
  });

  it("never lets concurrent reservations overspend", async () => {
    const { orgId: org } = await seedOrg(conn.db, "race");
    await ledger.grant({
      orgId: org,
      bucket: "topup",
      type: "topup",
      amount: creditsToMicro(100),
      idempotencyKey: `g:${org}:1`,
      actor: "test",
    });
    const attempts = Array.from({ length: 25 }, () => crypto.randomUUID());
    const results = await Promise.allSettled(
      attempts.map((id) =>
        ledger.reserve({
          orgId: org,
          reservationId: id,
          estimate: creditsToMicro(10),
          idempotencyKey: `r:${id}`,
          actor: "test",
        }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const insufficient = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof InsufficientCreditsError,
    ).length;
    expect(ok).toBe(10);
    expect(insufficient).toBe(15);
    expect(await ledger.available(org)).toBe(0n);
    const { before, after } = await ledger.refold(org);
    expect(before).toEqual(after);
  });

  it("records overage when actual exceeds the reservation and the balance", async () => {
    const { orgId: org } = await seedOrg(conn.db, "cut");
    await ledger.grant({
      orgId: org,
      bucket: "trial",
      type: "trial_grant",
      amount: creditsToMicro(50),
      idempotencyKey: `g:${org}:1`,
      actor: "test",
    });
    const reservationId = crypto.randomUUID();
    await ledger.reserve({
      orgId: org,
      reservationId,
      estimate: creditsToMicro(40),
      idempotencyKey: `r:${reservationId}`,
      actor: "test",
    });
    const { balances, uncovered } = await ledger.settle({
      orgId: org,
      reservationId,
      actual: creditsToMicro(70),
      idempotencyKey: `r:${reservationId}`,
      actor: "test",
    });
    expect(balances.trial).toBe(0n);
    expect(uncovered).toBe(creditsToMicro(20));
  });

  it("releases stale reservations", async () => {
    const { orgId: org } = await seedOrg(conn.db, "stale");
    await ledger.grant({
      orgId: org,
      bucket: "plan",
      type: "plan_grant",
      amount: creditsToMicro(30),
      idempotencyKey: `g:${org}:1`,
      actor: "test",
    });
    const reservationId = crypto.randomUUID();
    await ledger.reserve({
      orgId: org,
      reservationId,
      estimate: creditsToMicro(30),
      idempotencyKey: `r:${reservationId}`,
      actor: "test",
    });
    expect(await ledger.available(org)).toBe(0n);
    const released = await ledger.releaseStaleReservations(-1_000, "worker");
    expect(released).toBeGreaterThanOrEqual(1);
    expect(await ledger.available(org)).toBe(creditsToMicro(30));
  });

  it("expires a bucket and paginates history newest first", async () => {
    const { orgId: org } = await seedOrg(conn.db, "exp");
    await ledger.grant({
      orgId: org,
      bucket: "plan",
      type: "plan_grant",
      amount: creditsToMicro(30),
      idempotencyKey: `g:${org}:1`,
      actor: "test",
    });
    const b = await ledger.expire({
      orgId: org,
      bucket: "plan",
      idempotencyKey: `x:${org}:1`,
      actor: "worker",
    });
    expect(b.plan).toBe(0n);
    const history = await ledger.history(org, { limit: 10 });
    expect(history.map((e) => e.type)).toEqual(["expiry", "plan_grant"]);
  });

  it("never lets 50 concurrent reservations exceed a usage window cap", async () => {
    const { orgId: org, userId } = await seedOrg(conn.db, "window-race");
    await ledger.grant({
      orgId: org,
      bucket: "topup",
      type: "topup",
      amount: creditsToMicro(10_000),
      idempotencyKey: `g:${org}:1`,
      actor: "test",
    });
    const caps = { fiveHour: creditsToMicro(100), week: creditsToMicro(1000) };
    const attempts = Array.from({ length: 50 }, () => crypto.randomUUID());
    const results = await Promise.allSettled(
      attempts.map((id) =>
        ledger.reserve({
          orgId: org,
          reservationId: id,
          estimate: creditsToMicro(7),
          idempotencyKey: `r:${id}`,
          actor: "test",
          window: { userId, caps, partial: true },
        }),
      ),
    );
    const held = results.flatMap((r) => (r.status === "fulfilled" ? [r.value.windowHold!] : []));
    const refused = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof UsageWindowExhaustedError,
    );
    expect(held.reduce((a, b) => a + b, 0n)).toBe(creditsToMicro(100));
    expect(held.length + refused.length).toBe(50);
    // Every admitted request settles its full hold; the window lands exactly on the cap.
    await Promise.all(
      attempts.map(async (id, i) => {
        const result = results[i]!;
        if (result.status !== "fulfilled") return;
        await ledger.settle({
          orgId: org,
          reservationId: id,
          actual: result.value.windowHold!,
          idempotencyKey: `r:${id}`,
          actor: "test",
        });
      }),
    );
    const buckets = await conn.db.query.usageBuckets.findMany({
      where: eq(schema.usageBuckets.userId, userId),
    });
    expect(buckets.reduce((a, b) => a + b.spentMicro, 0n)).toBe(creditsToMicro(100));
    expect(await conn.db.$count(schema.usageHolds, eq(schema.usageHolds.userId, userId))).toBe(0);
    await expect(
      ledger.reserve({
        orgId: org,
        reservationId: crypto.randomUUID(),
        estimate: 1n,
        idempotencyKey: `r:${crypto.randomUUID()}`,
        actor: "test",
        window: { userId, caps, partial: true },
      }),
    ).rejects.toMatchObject({ window: { kind: "five_hour" } });
  });

  it("pays from the free allowance only for free-eligible models", async () => {
    const { orgId: org } = await seedOrg(conn.db, "free");
    for (const [bucket, type] of [
      ["free", "free_grant"],
      ["topup", "topup"],
    ] as const)
      await ledger.grant({
        orgId: org,
        bucket,
        type,
        amount: creditsToMicro(20),
        idempotencyKey: `g:${org}:${bucket}`,
        actor: "test",
      });
    const spend = async (freeEligible: boolean) => {
      const id = crypto.randomUUID();
      await ledger.reserve({
        orgId: org,
        reservationId: id,
        estimate: creditsToMicro(5),
        idempotencyKey: `r:${id}`,
        actor: "test",
        freeEligible,
      });
      return ledger.settle({
        orgId: org,
        reservationId: id,
        actual: creditsToMicro(5),
        idempotencyKey: `r:${id}`,
        actor: "test",
        freeEligible,
      });
    };
    const paid = await spend(false);
    expect(paid.balances).toMatchObject({ free: creditsToMicro(20), topup: creditsToMicro(15) });
    const free = await spend(true);
    expect(free.balances).toMatchObject({ free: creditsToMicro(15), topup: creditsToMicro(15) });
    // A paid model is refused when only free credits could cover it.
    await expect(
      ledger.reserve({
        orgId: org,
        reservationId: crypto.randomUUID(),
        estimate: creditsToMicro(30),
        idempotencyKey: `r:${crypto.randomUUID()}`,
        actor: "test",
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    const { before, after } = await ledger.refold(org);
    expect(before).toEqual(after);
  });
});
