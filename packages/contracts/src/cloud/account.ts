import { Schema } from "effect";

import { TrimmedNonEmptyString } from "../baseSchemas";

import { CloudDeviceId, CloudOrgId, CloudOrgRole, CloudPlanId, CloudUserId } from "./base";
import { CloudCreditsResponse } from "./usage";

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

// DELETE /v1/me: deletes the signed-in account; its sessions stop working at once
export const CloudDeleteAccountResponse = Schema.Struct({ deleted: Schema.Literal(true) });
export type CloudDeleteAccountResponse = typeof CloudDeleteAccountResponse.Type;

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

// POST /v1/devices/push-token → 204. Registers (or moves) an APNs token for
// task-finished notifications; the same token re-registered is refreshed.
// The push's custom keys are CloudRunPushData.
export const CloudPushTokenInput = Schema.Struct({
  /** APNs device token, hex. */
  token: Schema.String.check(Schema.isPattern(/^[0-9a-fA-F]{32,200}$/)),
  environment: Schema.Literals(["production", "sandbox"]),
  deviceId: Schema.optionalKey(CloudDeviceId),
});
export type CloudPushTokenInput = typeof CloudPushTokenInput.Type;

/** The deep link that opens a cloud conversation in the iOS app. */
export const cloudConversationDeepLink = (conversationId: string) =>
  `djl://cloud/c/${encodeURIComponent(conversationId)}`;

/** Custom keys of a task-finished APNs push (beside `aps`). Ids only, never content. */
export const CloudRunPushData = Schema.Struct({
  source: Schema.Literal("djl.cloudRun"),
  runId: TrimmedNonEmptyString,
  conversationId: TrimmedNonEmptyString,
  status: Schema.Literals(["succeeded", "failed"]),
  /** cloudConversationDeepLink(conversationId). */
  url: TrimmedNonEmptyString,
});
export type CloudRunPushData = typeof CloudRunPushData.Type;

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

/** Browser sign-in: the renderer opens `authorizeUrl`; the app gets `djl://auth/callback` back. */
export const CloudBrowserSignInStartResult = Schema.Struct({
  authorizeUrl: TrimmedNonEmptyString,
  expiresInSeconds: Schema.Int,
});
export type CloudBrowserSignInStartResult = typeof CloudBrowserSignInStartResult.Type;

/** The `code` and `state` from the `djl://auth/callback` deep link. */
export const CloudBrowserSignInCompleteInput = Schema.Struct({
  code: TrimmedNonEmptyString,
  state: TrimmedNonEmptyString,
});
export type CloudBrowserSignInCompleteInput = typeof CloudBrowserSignInCompleteInput.Type;

export const CloudEmptyInput = Schema.Struct({});
export type CloudEmptyInput = typeof CloudEmptyInput.Type;
