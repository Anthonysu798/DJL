import { describe, expect, it } from "vitest";

import {
  COMMERCE_CURRENCY,
  assertBalancedCommerceJournal,
  assertCommerceReferralBinding,
  assertCommerceWalletBalance,
  calculateCommerceCommission,
  canReleaseCommerceCommission,
  commerceBasisPoints,
  commerceCommissionReleaseAt,
  commerceLiveFundsEnabled,
  commerceMoney,
  commerceRefundCommission,
  consumeCommerceStock,
  directCommerceReferrer,
  freezeCommerceWithdrawal,
  releaseCommerceCommission,
  releaseCommerceStock,
  reserveCommerceStock,
  reverseCommerceCommission,
  settleCommerceWithdrawal,
  type CommerceLiveFundsGates,
  type CommerceWalletBalance,
} from "./commerce.ts";

const day = 86_400_000;
const deliveredAt = new Date("2026-10-26T12:00:00Z");
const wallet = (overrides: Partial<CommerceWalletBalance> = {}): CommerceWalletBalance => ({
  pendingCents: 5_000,
  availableCents: 4_800,
  frozenCents: 0,
  paidCents: 8_000,
  recoveryCents: 0,
  ...overrides,
});

describe("commerce cents and commission", () => {
  it("uses CAD integer cents and accepts only finite non-negative safe amounts", () => {
    expect(COMMERCE_CURRENCY).toBe("CAD");
    expect(commerceMoney(0)).toBe(0);
    expect(commerceMoney(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of [-1, 0.1, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => commerceMoney(value)).toThrow(RangeError);
  });

  it("validates percentage basis points", () => {
    expect(commerceBasisPoints(0)).toBe(0);
    expect(commerceBasisPoints(10_000)).toBe(10_000);
    for (const value of [-1, 10_001, 0.1, Number.NaN])
      expect(() => commerceBasisPoints(value)).toThrow(RangeError);
  });

  it("calculates goods-only commission and floors a fractional cent", () => {
    expect(calculateCommerceCommission(3_900, 1_000)).toBe(390);
    expect(calculateCommerceCommission(199, 500)).toBe(9);
    expect(calculateCommerceCommission(3_900, 0)).toBe(0);
    expect(calculateCommerceCommission(0, 1_000)).toBe(0);
  });

  it("does not overflow or lose precision in the intermediate multiplication", () => {
    const goods = Number.MAX_SAFE_INTEGER;
    expect(calculateCommerceCommission(goods, 10_000)).toBe(goods);
    expect(calculateCommerceCommission(goods, 9_999)).toBe(
      Number((BigInt(goods) * 9_999n) / 10_000n),
    );
  });

  it("reverses cumulative partial refunds without repeatedly rounding the refund", () => {
    let before = 0;
    let reversed = 0;
    for (let total = 1; total <= 199; total++) {
      const result = commerceRefundCommission({
        goodsCents: 199,
        basisPoints: 500,
        refundedBeforeCents: before,
        refundedTotalCents: total,
      });
      reversed += result.reversalCents;
      expect(result.remainingCommissionCents + reversed).toBe(9);
      before = total;
    }
    expect(reversed).toBe(9);
  });

  it("returns zero additional reversal when the same cumulative refund is replayed", () => {
    expect(
      commerceRefundCommission({
        goodsCents: 3_900,
        basisPoints: 1_000,
        refundedBeforeCents: 1_000,
        refundedTotalCents: 1_000,
      }),
    ).toEqual({ remainingCommissionCents: 290, reversalCents: 0 });
  });

  it("rejects decreasing, excess, fractional and negative refunds", () => {
    for (const [before, total] of [
      [100, 99],
      [0, 200],
      [0, -1],
      [0, 1.5],
    ])
      expect(() =>
        commerceRefundCommission({
          goodsCents: 199,
          basisPoints: 500,
          refundedBeforeCents: before!,
          refundedTotalCents: total!,
        }),
      ).toThrow(RangeError);
  });
});

describe("commerce commission observation", () => {
  it("uses at least 30 days and never shortens a longer return window", () => {
    expect(commerceCommissionReleaseAt(deliveredAt, 7).getTime()).toBe(
      deliveredAt.getTime() + 30 * day,
    );
    expect(commerceCommissionReleaseAt(deliveredAt, 45).getTime()).toBe(
      deliveredAt.getTime() + 45 * day,
    );
  });

  it("releases exactly at the boundary, not a millisecond before", () => {
    const input = { deliveredAt, returnDays: 30, hasOpenCase: false };
    expect(
      canReleaseCommerceCommission({
        ...input,
        now: new Date(deliveredAt.getTime() + 30 * day - 1),
      }),
    ).toBe(false);
    expect(
      canReleaseCommerceCommission({ ...input, now: new Date(deliveredAt.getTime() + 30 * day) }),
    ).toBe(true);
  });

  it("blocks unsigned delivery, open returns and disputes", () => {
    const now = new Date(deliveredAt.getTime() + 60 * day);
    expect(
      canReleaseCommerceCommission({ deliveredAt: null, returnDays: 30, now, hasOpenCase: false }),
    ).toBe(false);
    expect(
      canReleaseCommerceCommission({ deliveredAt, returnDays: 30, now, hasOpenCase: true }),
    ).toBe(false);
  });

  it("rejects invalid dates and out-of-range return windows", () => {
    expect(() => commerceCommissionReleaseAt(new Date("invalid"), 30)).toThrow(RangeError);
    expect(() => commerceCommissionReleaseAt(deliveredAt, -1)).toThrow(RangeError);
    expect(() => commerceCommissionReleaseAt(deliveredAt, 1.5)).toThrow(RangeError);
    expect(() => commerceCommissionReleaseAt(deliveredAt, Number.MAX_SAFE_INTEGER)).toThrow(
      RangeError,
    );
  });
});

describe("single direct referral binding", () => {
  const binding = { userId: "B", referrerId: "A", currentReferrerId: null, firstPaidAt: null };

  it("allows both new and existing unpaid accounts without requiring a merchant role", () => {
    expect(() => assertCommerceReferralBinding(binding, new Map())).not.toThrow();
    expect(() =>
      assertCommerceReferralBinding({ ...binding, userId: "existing-unpaid" }, new Map()),
    ).not.toThrow();
  });

  it("prevents self, mutual and longer cyclic referrals", () => {
    expect(() => assertCommerceReferralBinding({ ...binding, referrerId: "B" }, new Map())).toThrow(
      RangeError,
    );
    expect(() => assertCommerceReferralBinding(binding, new Map([["A", "B"]]))).toThrow(RangeError);
    expect(() =>
      assertCommerceReferralBinding(
        binding,
        new Map([
          ["A", "C"],
          ["C", "B"],
        ]),
      ),
    ).toThrow(RangeError);
    expect(() =>
      assertCommerceReferralBinding(
        binding,
        new Map([
          ["A", "C"],
          ["C", "A"],
        ]),
      ),
    ).toThrow(RangeError);
  });

  it("does not allow referrer changes, but is idempotent for the same binding", () => {
    expect(() =>
      assertCommerceReferralBinding({ ...binding, currentReferrerId: "C" }, new Map()),
    ).toThrow(RangeError);
    expect(() =>
      assertCommerceReferralBinding(
        { ...binding, currentReferrerId: "A", firstPaidAt: deliveredAt },
        new Map(),
      ),
    ).not.toThrow();
  });

  it("keeps binding closed after a paid order even if its goods have been fully refunded", () => {
    const refund = commerceRefundCommission({
      goodsCents: 3_900,
      basisPoints: 1_000,
      refundedBeforeCents: 0,
      refundedTotalCents: 3_900,
    });
    expect(refund.remainingCommissionCents).toBe(0);
    expect(() =>
      assertCommerceReferralBinding({ ...binding, firstPaidAt: deliveredAt }, new Map()),
    ).toThrow(RangeError);
  });

  it("returns only the direct referrer, not the grandparent", () => {
    const parents = new Map([
      ["C", "B"],
      ["B", "A"],
    ]);
    expect(directCommerceReferrer("C", parents)).toBe("B");
    expect(directCommerceReferrer("B", parents)).toBe("A");
    expect(directCommerceReferrer("A", parents)).toBeNull();
  });
});

describe("commerce stock", () => {
  it("reserves, commits and releases without mutating the input", () => {
    const stock = { onHand: 10, reserved: 2 };
    expect(reserveCommerceStock(stock, 3)).toEqual({ onHand: 10, reserved: 5 });
    expect(consumeCommerceStock(stock, 2)).toEqual({ onHand: 8, reserved: 0 });
    expect(releaseCommerceStock(stock, 2)).toEqual({ onHand: 10, reserved: 0 });
    expect(stock).toEqual({ onHand: 10, reserved: 2 });
  });

  it("rejects overselling, over-release and invalid integer quantities", () => {
    const stock = { onHand: 10, reserved: 2 };
    expect(() => reserveCommerceStock(stock, 9)).toThrow(RangeError);
    expect(() => consumeCommerceStock(stock, 3)).toThrow(RangeError);
    expect(() => releaseCommerceStock(stock, 3)).toThrow(RangeError);
    for (const quantity of [-1, 0, 1.5, Infinity])
      expect(() => reserveCommerceStock(stock, quantity)).toThrow(RangeError);
    expect(() => reserveCommerceStock({ onHand: 1, reserved: 2 }, 1)).toThrow(RangeError);
  });
});

describe("commission wallet", () => {
  it("freezes a withdrawal without marking it paid", () => {
    const before = wallet();
    expect(freezeCommerceWithdrawal(before, 2_000, false)).toEqual(
      wallet({ availableCents: 2_800, frozenCents: 2_000 }),
    );
    expect(before).toEqual(wallet());
  });

  it("blocks small, duplicate, excessive and debt-bearing withdrawals", () => {
    expect(() => freezeCommerceWithdrawal(wallet(), 1_999, false)).toThrow(RangeError);
    expect(() => freezeCommerceWithdrawal(wallet(), 2_000, true)).toThrow(RangeError);
    expect(() => freezeCommerceWithdrawal(wallet({ frozenCents: 1 }), 2_000, false)).toThrow(
      RangeError,
    );
    expect(() => freezeCommerceWithdrawal(wallet(), 4_801, false)).toThrow(RangeError);
    expect(() => freezeCommerceWithdrawal(wallet({ recoveryCents: 1 }), 2_000, false)).toThrow(
      RangeError,
    );
  });

  it("records a verified paid outcome or returns a rejected amount", () => {
    const frozen = freezeCommerceWithdrawal(wallet(), 2_000, false);
    expect(settleCommerceWithdrawal(frozen, 2_000, "paid")).toEqual(
      wallet({ availableCents: 2_800, paidCents: 10_000 }),
    );
    expect(settleCommerceWithdrawal(frozen, 2_000, "rejected")).toEqual(wallet());
    expect(() => settleCommerceWithdrawal(frozen, 2_001, "paid")).toThrow(RangeError);
    expect(() => settleCommerceWithdrawal(wallet(), 2_000, "paid")).toThrow(RangeError);
  });

  it("reverses pending commission without silently going negative", () => {
    expect(reverseCommerceCommission(wallet(), 1_000, "pending")).toEqual(
      wallet({ pendingCents: 4_000 }),
    );
    expect(() => reverseCommerceCommission(wallet(), 5_001, "pending")).toThrow(RangeError);
  });

  it("records already-withdrawn commission as receivable instead of rewriting paid history", () => {
    const result = reverseCommerceCommission(wallet({ availableCents: 100 }), 300, "released");
    expect(result).toEqual(wallet({ availableCents: 0, recoveryCents: 200 }));
    expect(result.paidCents).toBe(8_000);
  });

  it("offsets receivables before releasing new available earnings", () => {
    expect(releaseCommerceCommission(wallet({ recoveryCents: 300 }), 500)).toEqual(
      wallet({ pendingCents: 4_500, recoveryCents: 0, availableCents: 5_000 }),
    );
    expect(releaseCommerceCommission(wallet({ recoveryCents: 700 }), 500)).toEqual(
      wallet({ pendingCents: 4_500, recoveryCents: 200 }),
    );
  });

  it("holds a frozen withdrawal after a refund creates a receivable", () => {
    const frozen = freezeCommerceWithdrawal(wallet(), 4_800, false);
    const refunded = reverseCommerceCommission(frozen, 300, "released");
    expect(refunded.frozenCents).toBe(4_800);
    expect(() => settleCommerceWithdrawal(refunded, 4_800, "paid")).toThrow(RangeError);
    expect(settleCommerceWithdrawal(refunded, 4_800, "rejected")).toEqual(
      wallet({ availableCents: 4_500 }),
    );
  });

  it("rejects negative balances and checked additions that overflow safe integers", () => {
    expect(() => assertCommerceWalletBalance(wallet({ recoveryCents: -1 }))).toThrow(RangeError);
    expect(() =>
      releaseCommerceCommission(wallet({ availableCents: Number.MAX_SAFE_INTEGER }), 1),
    ).toThrow(RangeError);
    expect(() =>
      reverseCommerceCommission(
        wallet({ availableCents: 0, recoveryCents: Number.MAX_SAFE_INTEGER }),
        1,
        "released",
      ),
    ).toThrow(RangeError);
    expect(() =>
      settleCommerceWithdrawal(
        wallet({ frozenCents: 1, paidCents: Number.MAX_SAFE_INTEGER }),
        1,
        "paid",
      ),
    ).toThrow(RangeError);
  });
});

describe("independent commerce journal and live funds gates", () => {
  it("balances signed entries separately per currency with exact integer sums", () => {
    expect(() =>
      assertBalancedCommerceJournal([
        { account: "cash", currency: "CAD", amountCents: 3_900 },
        { account: "sales", currency: "CAD", amountCents: -3_900 },
        { account: "other-cash", currency: "USD", amountCents: 1_000 },
        { account: "other-sales", currency: "USD", amountCents: -1_000 },
      ]),
    ).not.toThrow();
    expect(() =>
      assertBalancedCommerceJournal([
        { account: "cash", currency: "CAD", amountCents: 100 },
        { account: "sales", currency: "USD", amountCents: -100 },
      ]),
    ).toThrow(RangeError);
  });

  it("rejects empty, zero, fractional and unbalanced postings", () => {
    expect(() => assertBalancedCommerceJournal([])).toThrow(RangeError);
    for (const amountCents of [0, 0.1, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        assertBalancedCommerceJournal([{ account: "cash", currency: "CAD", amountCents }]),
      ).toThrow(RangeError);
    expect(() =>
      assertBalancedCommerceJournal([{ account: "cash", currency: "CAD", amountCents: 1 }]),
    ).toThrow(RangeError);
  });

  it("cannot enable real money unless every explicit gate is verified", () => {
    const gates: CommerceLiveFundsGates = {
      enabled: true,
      merchantVerified: true,
      taxConfigured: true,
      paymentChannelApproved: true,
      agreementsAccepted: true,
      payeeVerified: true,
    };
    expect(commerceLiveFundsEnabled(gates)).toBe(true);
    for (const key of Object.keys(gates) as (keyof CommerceLiveFundsGates)[])
      expect(commerceLiveFundsEnabled({ ...gates, [key]: false })).toBe(false);
    expect(commerceLiveFundsEnabled({} as CommerceLiveFundsGates)).toBe(false);
    expect(
      commerceLiveFundsEnabled({ ...gates, enabled: "true" } as unknown as CommerceLiveFundsGates),
    ).toBe(false);
  });
});
