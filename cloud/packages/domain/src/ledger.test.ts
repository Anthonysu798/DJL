import { describe, expect, it } from "vitest";

import {
  allocateDebit,
  expireBucket,
  foldBalances,
  release,
  reserve,
  settle,
  spendable,
  topupRefundable,
  totalAvailable,
  type LedgerEntry,
} from "./ledger.ts";
import { creditsToMicro } from "./units.ts";

let seq = 0;
function entry(partial: Omit<LedgerEntry, "id" | "createdAt"> & Partial<LedgerEntry>): LedgerEntry {
  seq += 1;
  return { id: `e${seq}`, createdAt: new Date(2026, 8, 12).toISOString(), ...partial };
}

const org = "org_1";

function grants(): LedgerEntry[] {
  return [
    entry({
      orgId: org,
      type: "trial_grant",
      bucket: "trial",
      amount: creditsToMicro(200),
      reservationId: null,
      idempotencyKey: "g1",
    }),
    entry({
      orgId: org,
      type: "plan_grant",
      bucket: "plan",
      amount: creditsToMicro(2000),
      reservationId: null,
      idempotencyKey: "g2",
    }),
    entry({
      orgId: org,
      type: "topup",
      bucket: "topup",
      amount: creditsToMicro(500),
      reservationId: null,
      idempotencyKey: "g3",
    }),
  ];
}

describe("ledger", () => {
  it("folds balances per bucket and totals them", () => {
    const b = foldBalances(grants());
    expect(b).toEqual({
      free: 0n,
      trial: creditsToMicro(200),
      plan: creditsToMicro(2000),
      topup: creditsToMicro(500),
    });
    expect(totalAvailable(b)).toBe(creditsToMicro(2700));
  });

  it("spends trial, then plan, then topup", () => {
    const { debits, uncovered } = allocateDebit(foldBalances(grants()), creditsToMicro(2300));
    expect(debits).toEqual({
      free: 0n,
      trial: creditsToMicro(200),
      plan: creditsToMicro(2000),
      topup: creditsToMicro(100),
    });
    expect(uncovered).toBe(0n);
  });

  it("reports the uncovered remainder instead of going negative", () => {
    const { debits, uncovered } = allocateDebit(foldBalances(grants()), creditsToMicro(3000));
    expect(debits.topup).toBe(creditsToMicro(500));
    expect(uncovered).toBe(creditsToMicro(300));
  });

  it("refuses a reservation the balance cannot cover, with no partial entries", () => {
    const decision = reserve(
      { orgId: org, reservationId: "r1", estimate: creditsToMicro(5000), idempotencyKey: "k1" },
      foldBalances(grants()),
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.shortfall).toBe(creditsToMicro(2300));
  });

  it("reserve then settle leaves balance equal to grants minus actual", () => {
    const log = grants();
    const decision = reserve(
      { orgId: org, reservationId: "r1", estimate: creditsToMicro(300), idempotencyKey: "k1" },
      foldBalances(log),
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    const reservationEntries = decision.entries.map((e) => entry(e));
    log.push(...reservationEntries);
    // while reserved, availability is reduced
    expect(totalAvailable(foldBalances(log))).toBe(creditsToMicro(2400));

    const { entries, uncovered } = settle(
      { orgId: org, reservationId: "r1", actual: creditsToMicro(120), idempotencyKey: "k1" },
      reservationEntries,
      foldBalances(log),
    );
    expect(uncovered).toBe(0n);
    log.push(...entries.map((e) => entry(e)));
    const final = foldBalances(log);
    expect(totalAvailable(final)).toBe(creditsToMicro(2580));
    // actual 120 came out of trial first
    expect(final.trial).toBe(creditsToMicro(80));
    expect(final.plan).toBe(creditsToMicro(2000));
    expect(final.topup).toBe(creditsToMicro(500));
  });

  it("settle with actual above the reservation still records everything consumed and reports overage", () => {
    const log = grants().slice(0, 1); // only 200 trial credits
    const decision = reserve(
      { orgId: org, reservationId: "r1", estimate: creditsToMicro(150), idempotencyKey: "k1" },
      foldBalances(log),
    );
    if (!decision.ok) throw new Error("expected ok");
    const reservationEntries = decision.entries.map((e) => entry(e));
    log.push(...reservationEntries);
    const { entries, uncovered } = settle(
      { orgId: org, reservationId: "r1", actual: creditsToMicro(260), idempotencyKey: "k1" },
      reservationEntries,
      foldBalances(log),
    );
    log.push(...entries.map((e) => entry(e)));
    expect(foldBalances(log).trial).toBe(0n);
    expect(uncovered).toBe(creditsToMicro(60));
  });

  it("release returns exactly the reserved amounts", () => {
    const log = grants();
    const decision = reserve(
      { orgId: org, reservationId: "r1", estimate: creditsToMicro(2100), idempotencyKey: "k1" },
      foldBalances(log),
    );
    if (!decision.ok) throw new Error("expected ok");
    const reservationEntries = decision.entries.map((e) => entry(e));
    log.push(...reservationEntries);
    log.push(
      ...release({ orgId: org, reservationId: "r1", idempotencyKey: "k1" }, reservationEntries).map(
        (e) => entry(e),
      ),
    );
    expect(foldBalances(log)).toEqual(foldBalances(grants()));
  });

  it("idempotency keys are unique per reservation, phase, and bucket", () => {
    const decision = reserve(
      { orgId: org, reservationId: "r1", estimate: creditsToMicro(2100), idempotencyKey: "k1" },
      foldBalances(grants()),
    );
    if (!decision.ok) throw new Error("expected ok");
    const keys = decision.entries.map((e) => e.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(["k1:reserve:trial", "k1:reserve:plan"]);
  });

  it("spends the free allowance first, and only on free-eligible models", () => {
    const log = [
      ...grants(),
      entry({
        orgId: org,
        type: "free_grant",
        bucket: "free",
        amount: creditsToMicro(50),
        reservationId: null,
        idempotencyKey: "g4",
      }),
    ];
    const balances = foldBalances(log);
    expect(allocateDebit(balances, creditsToMicro(80), true).debits).toMatchObject({
      free: creditsToMicro(50),
      trial: creditsToMicro(30),
    });
    expect(allocateDebit(balances, creditsToMicro(80)).debits).toMatchObject({
      free: 0n,
      trial: creditsToMicro(80),
    });

    // A paid model reserves nothing from free, and its settlement never touches it.
    const paid = reserve(
      { orgId: org, reservationId: "r1", estimate: creditsToMicro(60), idempotencyKey: "k1" },
      balances,
    );
    if (!paid.ok) throw new Error("expected ok");
    expect(paid.entries.map((e) => e.bucket)).toEqual(["trial"]);
    const reserved = paid.entries.map((e) => entry(e));
    const s = settle(
      { orgId: org, reservationId: "r1", actual: creditsToMicro(60), idempotencyKey: "k1" },
      reserved,
      foldBalances([...log, ...reserved]),
    );
    expect(s.entries.some((e) => e.bucket === "free")).toBe(false);

    // A free-eligible model settles from free first.
    const cheap = reserve(
      {
        orgId: org,
        reservationId: "r2",
        estimate: creditsToMicro(10),
        idempotencyKey: "k2",
        freeEligible: true,
      },
      balances,
    );
    if (!cheap.ok) throw new Error("expected ok");
    expect(cheap.entries.map((e) => e.bucket)).toEqual(["free"]);
    const cheapReserved = cheap.entries.map((e) => entry(e));
    const settled = settle(
      {
        orgId: org,
        reservationId: "r2",
        actual: creditsToMicro(8),
        idempotencyKey: "k2",
        freeEligible: true,
      },
      cheapReserved,
      foldBalances([...log, ...cheapReserved]),
    );
    const after = foldBalances([...log, ...cheapReserved, ...settled.entries.map((e) => entry(e))]);
    expect(after.free).toBe(creditsToMicro(42));
    expect(after.trial).toBe(creditsToMicro(200));
  });

  it("expiry removes the remaining bucket balance and is a no-op at zero", () => {
    const b = foldBalances(grants());
    const e = expireBucket({ orgId: org, bucket: "plan", idempotencyKey: "x1" }, b);
    expect(e?.amount).toBe(-creditsToMicro(2000));
    expect(
      expireBucket({ orgId: org, bucket: "plan", idempotencyKey: "x2" }, { ...b, plan: 0n }),
    ).toBeNull();
  });

  it("a top-up is refundable only within 14 days and only if untouched", () => {
    const topup = grants()[2]!;
    const now = new Date(2026, 8, 20);
    expect(topupRefundable(topup, foldBalances(grants()), now)).toBe(true);
    expect(
      topupRefundable(topup, { free: 0n, trial: 0n, plan: 0n, topup: creditsToMicro(499) }, now),
    ).toBe(false);
    expect(topupRefundable(topup, foldBalances(grants()), new Date(2026, 9, 1))).toBe(false);
  });

  it("invariant: balance always equals the sum of all entries under random reserve/settle sequences", () => {
    const log = grants();
    log.push(
      entry({
        orgId: org,
        type: "free_grant",
        bucket: "free",
        amount: creditsToMicro(300),
        reservationId: null,
        idempotencyKey: "g4",
      }),
    );
    let rng = 42;
    const rand = () => (rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 200; i += 1) {
      const estimate = creditsToMicro(Math.floor(rand() * 400));
      const freeEligible = rand() < 0.5;
      const before = foldBalances(log);
      const d = reserve(
        { orgId: org, reservationId: `r${i}`, estimate, idempotencyKey: `k${i}`, freeEligible },
        before,
      );
      if (!d.ok) {
        expect(spendable(before, freeEligible)).toBeLessThan(estimate);
        continue;
      }
      const res = d.entries.map((e) => entry(e));
      log.push(...res);
      const actual = (estimate * BigInt(Math.floor(rand() * 120))) / 100n;
      const s = settle(
        { orgId: org, reservationId: `r${i}`, actual, idempotencyKey: `k${i}`, freeEligible },
        res,
        foldBalances(log),
      );
      log.push(...s.entries.map((e) => entry(e)));
      const b = foldBalances(log);
      expect(b.free).toBeGreaterThanOrEqual(0n);
      if (!freeEligible) expect(b.free).toBe(before.free);
      expect(b.trial).toBeGreaterThanOrEqual(0n);
      expect(b.plan).toBeGreaterThanOrEqual(0n);
      expect(b.topup).toBeGreaterThanOrEqual(0n);
      const sum = log.reduce((acc, e) => acc + e.amount, 0n);
      expect(totalAvailable(b)).toBe(sum);
    }
  });
});
