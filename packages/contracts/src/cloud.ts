/**
 * DJL Cloud public API contract.
 *
 * These schemas describe the JSON exchanged between the open-source clients
 * (desktop, web, iOS) and the private DJL Cloud control plane at
 * https://api.slcor.com/v1. The backend depends on this file by git tag and
 * validates every request and response against it, so a change here is an API
 * change. Authentication routes under /v1/auth/* are served by Better Auth and
 * are not described here; everything else is.
 *
 * Money: credits are the user-facing unit (100 credits = 1 USD). The wire
 * format carries microcredits (1 credit = 1,000,000 microcredits) as decimal
 * strings so no client ever rounds a balance.
 */
import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";

export const DJL_CLOUD_API_VERSION = "v1";
export const DJL_CLOUD_HOSTS = {
  global: "https://api.slcor.com",
  asia: "https://api-asia.slcor.com",
} as const;

/** Decimal string of microcredits. May be negative only inside ledger entries. */
export const Microcredits = Schema.String.check(Schema.isPattern(/^-?\d+$/));
export type Microcredits = typeof Microcredits.Type;

export const CloudUserId = TrimmedNonEmptyString.pipe(Schema.brand("CloudUserId"));
export type CloudUserId = typeof CloudUserId.Type;
export const CloudOrgId = TrimmedNonEmptyString.pipe(Schema.brand("CloudOrgId"));
export type CloudOrgId = typeof CloudOrgId.Type;
export const CloudDeviceId = TrimmedNonEmptyString.pipe(Schema.brand("CloudDeviceId"));
export type CloudDeviceId = typeof CloudDeviceId.Type;

export const CloudOrgRole = Schema.Literals(["owner", "admin", "member", "billing"]);
export type CloudOrgRole = typeof CloudOrgRole.Type;

export const CloudPlanId = Schema.Literals(["trial", "starter", "business", "autopilot"]);
export type CloudPlanId = typeof CloudPlanId.Type;

/** Uniform error envelope. `code` is stable and meant for programmatic handling. */
export const CloudApiError = Schema.Struct({
  error: Schema.Struct({
    code: TrimmedNonEmptyString,
    message: Schema.String,
    traceId: TrimmedNonEmptyString,
  }),
});
export type CloudApiError = typeof CloudApiError.Type;

export const CloudApiErrorCode = Schema.Literals([
  "unauthorized",
  "forbidden",
  "suspended",
  "not_a_member",
  "not_found",
  "bad_request",
  "bad_json",
  "payload_too_large",
  "insufficient_credits",
  "billing_paused",
  "billing_error",
  "already_subscribed",
  "bad_amount",
  "bad_plan",
  "plan_unavailable",
  "phone_required",
  "phone_already_used",
  "rate_limited",
  "gateway_paused",
  "sync_paused",
  "internal",
]);
export type CloudApiErrorCode = typeof CloudApiErrorCode.Type;

// ---------------------------------------------------------------------------
// GET /v1/me
// ---------------------------------------------------------------------------

export const CloudOrganizationSummary = Schema.Struct({
  id: CloudOrgId,
  name: TrimmedNonEmptyString,
  slug: TrimmedNonEmptyString,
  role: CloudOrgRole,
  personal: Schema.Boolean,
});
export type CloudOrganizationSummary = typeof CloudOrganizationSummary.Type;

export const CloudMeResponse = Schema.Struct({
  user: Schema.Struct({
    id: CloudUserId,
    email: TrimmedNonEmptyString,
    emailVerified: Schema.Boolean,
  }),
  activeOrgId: CloudOrgId,
  role: CloudOrgRole,
  organizations: Schema.Array(CloudOrganizationSummary),
});
export type CloudMeResponse = typeof CloudMeResponse.Type;

// ---------------------------------------------------------------------------
// GET /v1/credits, GET /v1/credits/ledger
// ---------------------------------------------------------------------------

export const CloudBalances = Schema.Struct({
  trial: Microcredits,
  plan: Microcredits,
  topup: Microcredits,
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

export const CloudLedgerBucket = Schema.Literals(["trial", "plan", "topup"]);
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
// Devices: POST /v1/devices, GET /v1/devices
// ---------------------------------------------------------------------------

export const CloudDeviceKind = Schema.Literals(["desktop", "web", "ios"]);
export type CloudDeviceKind = typeof CloudDeviceKind.Type;

export const CloudRegisterDeviceInput = Schema.Struct({
  kind: CloudDeviceKind,
  /** Stable per-install identifier; never a hardware serial. */
  fingerprint: TrimmedNonEmptyString,
  name: Schema.optionalKey(TrimmedNonEmptyString),
  /** Ed25519 public key (base64url) for iOS and desktop identities. */
  publicKey: Schema.optionalKey(TrimmedNonEmptyString),
  appVersion: Schema.optionalKey(TrimmedNonEmptyString),
  platform: Schema.optionalKey(TrimmedNonEmptyString),
});
export type CloudRegisterDeviceInput = typeof CloudRegisterDeviceInput.Type;

export const CloudDevice = Schema.Struct({
  id: CloudDeviceId,
  kind: CloudDeviceKind,
  name: Schema.NullOr(Schema.String),
  trustState: Schema.Literals(["trusted", "revoked"]),
  syncEnabled: Schema.Boolean,
  lastSeenAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type CloudDevice = typeof CloudDevice.Type;

export const CloudRegisterDeviceResponse = Schema.Struct({
  device: Schema.Struct({ id: CloudDeviceId, kind: CloudDeviceKind, syncEnabled: Schema.Boolean }),
});
export type CloudRegisterDeviceResponse = typeof CloudRegisterDeviceResponse.Type;

export const CloudDevicesResponse = Schema.Struct({ devices: Schema.Array(CloudDevice) });
export type CloudDevicesResponse = typeof CloudDevicesResponse.Type;

// ---------------------------------------------------------------------------
// Billing: POST /v1/billing/checkout, POST /v1/billing/portal, GET /v1/billing/subscription
// ---------------------------------------------------------------------------

export const CloudCheckoutInput = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("subscription"),
    planId: Schema.Literals(["starter", "business", "autopilot"]),
    interval: Schema.Literals(["month", "year"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("topup"),
    /** Whole US dollars, 5 to 10,000. 100 credits per dollar. */
    usd: Schema.Int.check(Schema.isGreaterThanOrEqualTo(5), Schema.isLessThanOrEqualTo(10_000)),
  }),
]);
export type CloudCheckoutInput = typeof CloudCheckoutInput.Type;

export const CloudRedirectResponse = Schema.Struct({ url: TrimmedNonEmptyString });
export type CloudRedirectResponse = typeof CloudRedirectResponse.Type;

export const CloudSubscription = Schema.Struct({
  planId: CloudPlanId,
  status: Schema.String,
  interval: Schema.String,
  currentPeriodStart: Schema.String,
  currentPeriodEnd: Schema.String,
  cancelAtPeriodEnd: Schema.Boolean,
});
export type CloudSubscription = typeof CloudSubscription.Type;

export const CloudInvoice = Schema.Struct({
  id: TrimmedNonEmptyString,
  status: Schema.String,
  amountPaidUsdCents: Schema.Int,
  currency: Schema.String,
  hostedInvoiceUrl: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type CloudInvoice = typeof CloudInvoice.Type;

export const CloudSubscriptionResponse = Schema.Struct({
  subscription: Schema.NullOr(CloudSubscription),
  invoices: Schema.Array(CloudInvoice),
});
export type CloudSubscriptionResponse = typeof CloudSubscriptionResponse.Type;

// ---------------------------------------------------------------------------
// Trial: GET /v1/trial, POST /v1/trial/claim
// ---------------------------------------------------------------------------

export const CloudTrialStatus = Schema.Literals([
  "pending_first_request",
  "queued_for_review",
  "granted",
  "rejected",
  "expired",
]);
export type CloudTrialStatus = typeof CloudTrialStatus.Type;

export const CloudTrialResponse = Schema.Struct({
  trial: Schema.NullOr(
    Schema.Struct({
      status: CloudTrialStatus,
      reasons: Schema.Array(Schema.String),
      grantedAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
      expiresAt: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
});
export type CloudTrialResponse = typeof CloudTrialResponse.Type;

export const CloudTrialClaimInput = Schema.Struct({
  deviceFingerprint: Schema.optionalKey(TrimmedNonEmptyString),
});
export type CloudTrialClaimInput = typeof CloudTrialClaimInput.Type;

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
// Local server ↔ renderer RPCs for the cloud account (served by apps/server)
// ---------------------------------------------------------------------------

export const CloudAccountStatus = Schema.Struct({
  signedIn: Schema.Boolean,
  apiBaseUrl: TrimmedNonEmptyString,
  email: Schema.optional(TrimmedNonEmptyString),
  userId: Schema.optional(CloudUserId),
  orgId: Schema.optional(CloudOrgId),
  /** Present when signed in and the control plane answered. */
  credits: Schema.optional(CloudCreditsResponse),
  /** Set when the stored session no longer works (expired, revoked, offline). */
  problem: Schema.optional(Schema.Literals(["unreachable", "session_expired", "suspended"])),
  checkedAt: Schema.String,
});
export type CloudAccountStatus = typeof CloudAccountStatus.Type;

export const CloudSignInStartResult = Schema.Struct({
  deviceCode: TrimmedNonEmptyString,
  userCode: TrimmedNonEmptyString,
  verificationUri: TrimmedNonEmptyString,
  verificationUriComplete: Schema.optional(TrimmedNonEmptyString),
  expiresInSeconds: Schema.Int,
  intervalSeconds: Schema.Int,
});
export type CloudSignInStartResult = typeof CloudSignInStartResult.Type;

export const CloudSignInPollInput = Schema.Struct({ deviceCode: TrimmedNonEmptyString });
export type CloudSignInPollInput = typeof CloudSignInPollInput.Type;

export const CloudSignInPollResult = Schema.Union([
  Schema.Struct({ state: Schema.Literal("pending") }),
  Schema.Struct({ state: Schema.Literal("slow_down"), intervalSeconds: Schema.Int }),
  Schema.Struct({ state: Schema.Literal("complete"), status: CloudAccountStatus }),
  Schema.Struct({ state: Schema.Literals(["denied", "expired"]) }),
]);
export type CloudSignInPollResult = typeof CloudSignInPollResult.Type;

export const CloudEmptyInput = Schema.Struct({});
export type CloudEmptyInput = typeof CloudEmptyInput.Type;
