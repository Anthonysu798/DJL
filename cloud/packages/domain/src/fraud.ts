/**
 * Trial eligibility. Pure evaluation over facts the API gathers; the API
 * decides what to persist. Every rule that fails is reported so admins can
 * see why a trial was withheld.
 */
export type PhoneLineType = "mobile" | "landline" | "voip" | "unknown";

export interface TrialEligibilityFacts {
  readonly phoneVerified: boolean;
  readonly phoneLineType: PhoneLineType;
  readonly phoneHashAlreadyUsed: boolean;
  readonly signupsFromDeviceLast24h: number;
  readonly signupsFromIpLast24h: number;
  readonly hasCompletedFirstCloudRequest: boolean;
  readonly dailyTrialBudgetRemainingUsdCents: number;
  readonly trialValueUsdCents: number;
  readonly accountSuspended: boolean;
}

export type TrialBlockReason =
  | "phone_not_verified"
  | "phone_line_type_not_mobile"
  | "phone_already_used"
  | "device_velocity"
  | "ip_velocity"
  | "no_first_request_yet"
  | "daily_budget_exhausted"
  | "account_suspended";

export const TRIAL_MAX_SIGNUPS_PER_DEVICE_24H = 2;
export const TRIAL_MAX_SIGNUPS_PER_IP_24H = 5;

export function evaluateTrialEligibility(facts: TrialEligibilityFacts): {
  readonly eligible: boolean;
  readonly queueForReview: boolean;
  readonly reasons: readonly TrialBlockReason[];
} {
  const reasons: TrialBlockReason[] = [];
  if (facts.accountSuspended) reasons.push("account_suspended");
  if (!facts.phoneVerified) reasons.push("phone_not_verified");
  if (facts.phoneLineType !== "mobile") reasons.push("phone_line_type_not_mobile");
  if (facts.phoneHashAlreadyUsed) reasons.push("phone_already_used");
  if (facts.signupsFromDeviceLast24h > TRIAL_MAX_SIGNUPS_PER_DEVICE_24H)
    reasons.push("device_velocity");
  if (facts.signupsFromIpLast24h > TRIAL_MAX_SIGNUPS_PER_IP_24H) reasons.push("ip_velocity");
  if (!facts.hasCompletedFirstCloudRequest) reasons.push("no_first_request_yet");
  const budgetExhausted = facts.dailyTrialBudgetRemainingUsdCents < facts.trialValueUsdCents;
  if (budgetExhausted) reasons.push("daily_budget_exhausted");
  // Budget exhaustion alone queues for manual approval rather than rejecting.
  const hardBlocks = reasons.filter((r) => r !== "daily_budget_exhausted");
  return {
    eligible: reasons.length === 0,
    queueForReview: hardBlocks.length === 0 && budgetExhausted,
    reasons,
  };
}
