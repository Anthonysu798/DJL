import { Schema } from "effect";

import { TrimmedNonEmptyString } from "../baseSchemas";

import { CloudOrgId, CloudPlanId, Microcredits } from "./base";

// ---------------------------------------------------------------------------
// GET /v1/credits, GET /v1/credits/ledger
// ---------------------------------------------------------------------------

export const CloudBalances = Schema.Struct({
  trial: Microcredits,
  plan: Microcredits,
  topup: Microcredits,
  /** Free weekly allowance, spent first and only on free-eligible models. */
  free: Schema.optionalKey(Microcredits),
});
export type CloudBalances = typeof CloudBalances.Type;

export const CloudCreditsResponse = Schema.Struct({
  orgId: CloudOrgId,
  balances: CloudBalances,
  total: Microcredits,
  /** Credits with two decimals, ready to render. */
  display: Schema.Struct({
    total: Schema.String,
    trial: Schema.String,
    plan: Schema.String,
    topup: Schema.String,
  }),
});
export type CloudCreditsResponse = typeof CloudCreditsResponse.Type;

export const CloudLedgerEntryType = Schema.Literals([
  "trial_grant",
  "plan_grant",
  "topup",
  "admin_grant",
  "reservation",
  "release",
  "settlement",
  "refund",
  "expiry",
  "anonymize",
]);
export type CloudLedgerEntryType = typeof CloudLedgerEntryType.Type;

export const CloudLedgerBucket = Schema.Literals(["free", "trial", "plan", "topup"]);
export type CloudLedgerBucket = typeof CloudLedgerBucket.Type;

export const CloudLedgerEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  orgId: CloudOrgId,
  type: CloudLedgerEntryType,
  bucket: CloudLedgerBucket,
  amount: Microcredits,
  reservationId: Schema.NullOr(TrimmedNonEmptyString),
  idempotencyKey: TrimmedNonEmptyString,
  createdAt: Schema.String,
});
export type CloudLedgerEntry = typeof CloudLedgerEntry.Type;

export const CloudLedgerResponse = Schema.Struct({
  entries: Schema.Array(CloudLedgerEntry),
});
export type CloudLedgerResponse = typeof CloudLedgerResponse.Type;

// ---------------------------------------------------------------------------
// Models and gateway: GET /v1/models, POST /v1/chat/completions (OpenAI-compatible)
// ---------------------------------------------------------------------------

export const CloudModelProvider = Schema.Literals(["openai", "anthropic", "openrouter"]);
export type CloudModelProvider = typeof CloudModelProvider.Type;

export const CloudModelCapability = Schema.Literals([
  "text.chat",
  "tools",
  "vision",
  "json",
  "image.generate",
  "embeddings",
]);
export type CloudModelCapability = typeof CloudModelCapability.Type;

export const CloudModel = Schema.Struct({
  id: TrimmedNonEmptyString,
  provider: CloudModelProvider,
  displayName: TrimmedNonEmptyString,
  capabilities: Schema.Array(CloudModelCapability),
  /** Credits per 1,000 tokens or per image, as decimal strings for display. */
  price: Schema.Struct({
    inputPer1k: Schema.String,
    outputPer1k: Schema.String,
    perImage: Schema.String,
  }),
  contextWindow: Schema.NullOr(Schema.Int),
  maxOutputTokens: Schema.NullOr(Schema.Int),
  status: Schema.Literals(["active", "degraded", "disabled"]),
});
export type CloudModel = typeof CloudModel.Type;

export const CloudModelsResponse = Schema.Struct({ models: Schema.Array(CloudModel) });
export type CloudModelsResponse = typeof CloudModelsResponse.Type;

/** Capability aliases accepted in place of a concrete model id. */
export const CloudCapabilityAlias = Schema.Literals([
  "text.fast",
  "text.high",
  "vision.high",
  "image.generate",
  "embed",
]);
export type CloudCapabilityAlias = typeof CloudCapabilityAlias.Type;

/**
 * Stream trailer sent as the final SSE event on every gateway stream so the
 * client can show the settled cost without a second request.
 */
export const CloudUsageTrailer = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  model: TrimmedNonEmptyString,
  routeReason: TrimmedNonEmptyString,
  inputTokens: Schema.Int,
  outputTokens: Schema.Int,
  settled: Microcredits,
  remaining: Microcredits,
  /** True when the stream was cut because the balance reached zero. */
  cutOff: Schema.Boolean,
});
export type CloudUsageTrailer = typeof CloudUsageTrailer.Type;

// ---------------------------------------------------------------------------
// Usage windows and banked resets: GET /v1/usage/status, POST /v1/usage/banks/redeem
// ---------------------------------------------------------------------------

/** A rolling 5-hour window and a 7-day week, both capped in microcredits per plan. */
export const CloudUsageWindowKind = Schema.Literals(["five_hour", "week"]);
export type CloudUsageWindowKind = typeof CloudUsageWindowKind.Type;

export const CloudUsageWindow = Schema.Struct({
  kind: CloudUsageWindowKind,
  limit: Microcredits,
  used: Microcredits,
  remaining: Microcredits,
  /** When spend next rolls off (5-hour) or the week restarts; null when nothing is spent. */
  resetsAt: Schema.NullOr(Schema.String),
});
export type CloudUsageWindow = typeof CloudUsageWindow.Type;

export const CloudResetBankSource = Schema.Literals(["admin", "bulk", "plan_schedule"]);
export type CloudResetBankSource = typeof CloudResetBankSource.Type;

export const CloudResetBank = Schema.Struct({
  id: TrimmedNonEmptyString,
  source: CloudResetBankSource,
  grantedAt: Schema.String,
  /** Banks expire 90 days after the grant. */
  expiresAt: Schema.String,
});
export type CloudResetBank = typeof CloudResetBank.Type;

export const CloudUsageStatusResponse = Schema.Struct({
  planId: CloudPlanId,
  windows: Schema.Struct({ fiveHour: CloudUsageWindow, week: CloudUsageWindow }),
  /** Unredeemed, unexpired banks, oldest first. Redeeming always uses the oldest. */
  banks: Schema.Array(CloudResetBank),
});
export type CloudUsageStatusResponse = typeof CloudUsageStatusResponse.Type;

export const CloudRedeemBankInput = Schema.Struct({
  /** Client-generated; a retried redeem with the same key redeems at most one bank. */
  idempotencyKey: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
});
export type CloudRedeemBankInput = typeof CloudRedeemBankInput.Type;

export const CloudRedeemBankResponse = Schema.Struct({
  redeemedBankId: TrimmedNonEmptyString,
  status: CloudUsageStatusResponse,
});
export type CloudRedeemBankResponse = typeof CloudRedeemBankResponse.Type;
