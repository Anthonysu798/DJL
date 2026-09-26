/**
 * Browser sign-in for native apps (OAuth 2.0 authorization code with PKCE S256).
 *
 * 1. The desktop opens `${web}/authorize?client_id=djl-desktop&redirect_uri=djl://auth/callback
 *    &state=…&code_challenge=…&code_challenge_method=S256` (OAuth query names).
 * 2. The signed-in browser posts those values to POST /v1/native-auth/codes and
 *    is sent to `${redirectUri}?code=…&state=…`. Codes are single use and live 60 seconds.
 * 3. The desktop posts the code and its verifier to POST /v1/native-auth/token.
 *
 * Each client id has an exact redirect URI allowlist on the server.
 */
import { Schema } from "effect";

import { TrimmedNonEmptyString } from "../baseSchemas";
import { CloudOrgId, CloudUserId } from "./base";

export const DJL_NATIVE_AUTH_REDIRECT_URI = "djl://auth/callback";
export const DJL_DESKTOP_CLIENT_ID = "djl-desktop";

const NativeClientId = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{2,31}$/));

/** RFC 7636: 43-128 unreserved characters. */
export const PkceCodeVerifier = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9\-._~]{43,128}$/));
/** base64url(SHA-256(verifier)) without padding. */
export const PkceCodeChallenge = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/));

export const CloudNativeAuthorizeRequest = Schema.Struct({
  clientId: NativeClientId,
  redirectUri: TrimmedNonEmptyString,
  /** Opaque client value echoed back; at least 128 bits of randomness. */
  state: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{22,128}$/)),
  codeChallenge: PkceCodeChallenge,
  codeChallengeMethod: Schema.Literal("S256"),
});
export type CloudNativeAuthorizeRequest = typeof CloudNativeAuthorizeRequest.Type;

export const CloudNativeAuthCodeResponse = Schema.Struct({
  /** Where the browser goes next: redirectUri with `code` and `state` appended. */
  redirectTo: TrimmedNonEmptyString,
  expiresAt: Schema.String,
});
export type CloudNativeAuthCodeResponse = typeof CloudNativeAuthCodeResponse.Type;

export const CloudNativeTokenInput = Schema.Struct({
  /** Must equal the clientId the code was issued for. */
  clientId: NativeClientId,
  code: TrimmedNonEmptyString,
  codeVerifier: PkceCodeVerifier,
  /** Must equal the redirectUri the code was issued for. */
  redirectUri: TrimmedNonEmptyString,
});
export type CloudNativeTokenInput = typeof CloudNativeTokenInput.Type;

export const CloudNativeTokenResponse = Schema.Struct({
  /** Long-lived device session; exchange it for short-lived access tokens. */
  sessionToken: TrimmedNonEmptyString,
  expiresAt: Schema.String,
  userId: CloudUserId,
  orgId: CloudOrgId,
});
export type CloudNativeTokenResponse = typeof CloudNativeTokenResponse.Type;
