import { describe, expect, it } from "vitest";

import { evaluateTrialEligibility, type TrialEligibilityFacts } from "./fraud.ts";

const good: TrialEligibilityFacts = {
  phoneVerified: true,
  phoneLineType: "mobile",
  phoneHashAlreadyUsed: false,
  signupsFromDeviceLast24h: 1,
  signupsFromIpLast24h: 1,
  hasCompletedFirstCloudRequest: true,
  dailyTrialBudgetRemainingUsdCents: 5000,
  trialValueUsdCents: 200,
  accountSuspended: false,
};

describe("trial eligibility", () => {
  it("grants when every rule passes", () => {
    expect(evaluateTrialEligibility(good)).toEqual({
      eligible: true,
      queueForReview: false,
      reasons: [],
    });
  });
  it("blocks voip numbers, reused phones, and velocity abuse", () => {
    expect(evaluateTrialEligibility({ ...good, phoneLineType: "voip" }).reasons).toEqual([
      "phone_line_type_not_mobile",
    ]);
    expect(evaluateTrialEligibility({ ...good, phoneHashAlreadyUsed: true }).reasons).toEqual([
      "phone_already_used",
    ]);
    expect(evaluateTrialEligibility({ ...good, signupsFromDeviceLast24h: 3 }).reasons).toEqual([
      "device_velocity",
    ]);
    expect(evaluateTrialEligibility({ ...good, signupsFromIpLast24h: 6 }).reasons).toEqual([
      "ip_velocity",
    ]);
  });
  it("withholds until the first real cloud request", () => {
    expect(
      evaluateTrialEligibility({ ...good, hasCompletedFirstCloudRequest: false }).eligible,
    ).toBe(false);
  });
  it("queues for review when only the daily budget is exhausted", () => {
    const r = evaluateTrialEligibility({ ...good, dailyTrialBudgetRemainingUsdCents: 100 });
    expect(r.eligible).toBe(false);
    expect(r.queueForReview).toBe(true);
  });
  it("does not queue when budget is exhausted and a hard rule fails", () => {
    const r = evaluateTrialEligibility({
      ...good,
      dailyTrialBudgetRemainingUsdCents: 0,
      phoneVerified: false,
    });
    expect(r.queueForReview).toBe(false);
  });
});
