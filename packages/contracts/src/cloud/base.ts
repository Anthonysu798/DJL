/**
 * DJL Cloud public API contract.
 *
 * These schemas describe the JSON exchanged between the clients (desktop, web,
 * iOS) and the DJL Cloud control plane in `cloud/` at https://api.slcor.com/v1.
 * The cloud apps import them as `@synara/contracts/cloud` from this workspace,
 * so a change here is an API change. Authentication routes under /v1/auth/*
 * are served by Better Auth and are not described here; everything else is.
 *
 * Money: credits are the user-facing unit (100 credits = 1 USD). The wire
 * format carries microcredits (1 credit = 1,000,000 microcredits) as decimal
 * strings so no client ever rounds a balance.
 */
import { Schema } from "effect";

import { TrimmedNonEmptyString } from "../baseSchemas";

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
export const CloudConversationId = TrimmedNonEmptyString.pipe(Schema.brand("CloudConversationId"));
export type CloudConversationId = typeof CloudConversationId.Type;
export const CloudMessageId = TrimmedNonEmptyString.pipe(Schema.brand("CloudMessageId"));
export type CloudMessageId = typeof CloudMessageId.Type;
export const CloudRunId = TrimmedNonEmptyString.pipe(Schema.brand("CloudRunId"));
export type CloudRunId = typeof CloudRunId.Type;
export const CloudFileId = TrimmedNonEmptyString.pipe(Schema.brand("CloudFileId"));
export type CloudFileId = typeof CloudFileId.Type;
export const CloudShareId = TrimmedNonEmptyString.pipe(Schema.brand("CloudShareId"));
export type CloudShareId = typeof CloudShareId.Type;

/**
 * Cookie-authenticated (web) mutations on /v1/* must echo the double-submit
 * token from GET /v1/csrf in this header, from a trusted Origin. Requests with
 * an `Authorization` header (desktop, iOS) are exempt.
 */
export const CLOUD_CSRF_HEADER = "x-csrf-token";
export const CLOUD_CSRF_COOKIE = "djl_csrf";

// GET /v1/csrf (also sets the HttpOnly `djl_csrf` cookie the header must match)
export const CloudCsrfResponse = Schema.Struct({ token: TrimmedNonEmptyString });
export type CloudCsrfResponse = typeof CloudCsrfResponse.Type;

/**
 * Native sessions. Signing in through Better Auth (/v1/auth/sign-in/*) returns
 * the long-lived session token in this response header. Clients send it as
 * `Authorization: Bearer <session token>` to GET /v1/auth/token and use the
 * returned 15-minute JWT as the bearer for every other call, fetching a new
 * one shortly before it expires (the JWT's `exp`).
 */
export const CLOUD_SESSION_TOKEN_HEADER = "set-auth-token";

// GET /v1/auth/token (bearer: the session token)
export const CloudAccessTokenResponse = Schema.Struct({ token: TrimmedNonEmptyString });
export type CloudAccessTokenResponse = typeof CloudAccessTokenResponse.Type;

export const CloudOrgRole = Schema.Literals(["owner", "admin", "member", "billing"]);
export type CloudOrgRole = typeof CloudOrgRole.Type;

export const CloudPlanId = Schema.Literals(["free", "trial", "starter", "business", "autopilot"]);
export type CloudPlanId = typeof CloudPlanId.Type;

/** Uniform error envelope. `code` is stable and meant for programmatic handling. */
export const CloudApiError = Schema.Struct({
  error: Schema.Struct({
    code: TrimmedNonEmptyString,
    message: Schema.String,
    traceId: TrimmedNonEmptyString,
    /** Set with `usage_window_exhausted`: when the exhausted window frees up again. */
    resetsAt: Schema.optionalKey(Schema.String),
    /** Set with `usage_window_exhausted`: which window is full. */
    window: Schema.optionalKey(Schema.Literals(["five_hour", "week"])),
  }),
});
export type CloudApiError = typeof CloudApiError.Type;

export const CloudApiErrorCode = Schema.Literals([
  "unauthorized",
  /** The bearer JWT is malformed, expired, or signed by an unknown key: fetch a new one. */
  "invalid_token",
  /** The session behind the JWT was signed out: sign in again. */
  "session_revoked",
  /** Cookie mutation without a trusted Origin. */
  "csrf_origin",
  /** Cookie mutation without a matching x-csrf-token: fetch GET /v1/csrf and retry once. */
  "csrf_token",
  "browser_session_required",
  "forbidden",
  "suspended",
  "not_a_member",
  "not_found",
  "bad_request",
  "bad_json",
  "bad_cursor",
  /** A message must reply to an assistant message. */
  "bad_parent",
  "unsupported_type",
  "file_too_large",
  /** POST /v1/files/{id}/complete before the bytes were PUT. */
  "upload_missing",
  /** The uploaded bytes differ from the declared size, SHA-256, or type. */
  "upload_mismatch",
  /** The scan gate refused the file. */
  "upload_rejected",
  /** A message references a file that is not the sender's or not ready. */
  "file_unavailable",
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
  "overloaded",
  "usage_window_exhausted",
  /** A stream was cut mid-response because a usage window filled. */
  "usage_window_cut",
  "no_reset_bank",
  "gateway_paused",
  "sync_paused",
  "internal",
]);
export type CloudApiErrorCode = typeof CloudApiErrorCode.Type;
