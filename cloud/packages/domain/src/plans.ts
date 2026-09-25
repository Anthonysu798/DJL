import { creditsToMicro, type Microcredits } from "./units.ts";

export type PlanId = "trial" | "starter" | "business" | "autopilot";

export interface PlanConfig {
  readonly id: PlanId;
  readonly name: string;
  readonly monthlyPriceUsdCents: number;
  readonly annualPriceUsdCents: number;
  readonly includedCredits: Microcredits;
  readonly concurrentStreams: number;
  readonly requestsPerMinute: number;
  /** Higher wins when the instance is near its stream cap. */
  readonly priorityWeight: number;
  readonly syncQuotaBytes: number;
  readonly requiresOwner2fa: boolean;
}

const GB = 1024 ** 3;

/** Defaults seeded into the plans table; admins edit the table, not this file. */
export const DEFAULT_PLANS: readonly PlanConfig[] = [
  {
    id: "trial",
    name: "Trial",
    monthlyPriceUsdCents: 0,
    annualPriceUsdCents: 0,
    includedCredits: creditsToMicro(200),
    concurrentStreams: 2,
    requestsPerMinute: 20,
    priorityWeight: 1,
    syncQuotaBytes: 100 * 1024 ** 2,
    requiresOwner2fa: false,
  },
  {
    id: "starter",
    name: "Starter",
    monthlyPriceUsdCents: 2000,
    annualPriceUsdCents: 20000,
    includedCredits: creditsToMicro(2000),
    concurrentStreams: 5,
    requestsPerMinute: 60,
    priorityWeight: 4,
    syncQuotaBytes: 2 * GB,
    requiresOwner2fa: true,
  },
  {
    id: "business",
    name: "Business",
    monthlyPriceUsdCents: 6000,
    annualPriceUsdCents: 60000,
    includedCredits: creditsToMicro(6500),
    concurrentStreams: 15,
    requestsPerMinute: 60,
    priorityWeight: 8,
    syncQuotaBytes: 10 * GB,
    requiresOwner2fa: true,
  },
  {
    id: "autopilot",
    name: "Autopilot",
    monthlyPriceUsdCents: 18000,
    annualPriceUsdCents: 180000,
    includedCredits: creditsToMicro(21000),
    concurrentStreams: 40,
    requestsPerMinute: 60,
    priorityWeight: 16,
    syncQuotaBytes: 50 * GB,
    requiresOwner2fa: true,
  },
];

export const TRIAL_CREDIT_EXPIRY_DAYS = 14;
export const TOPUP_MIN_USD_CENTS = 500;
export const TRIAL_DAILY_BUDGET_USD_CENTS = 10_000;
