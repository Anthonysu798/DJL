// FILE: pluginOAuth.ts
// Purpose: The OAuth steps a plugin's tool server asks for (MCP authorization): find the
//          authorization server, register DJL as a public client, and trade codes and refresh
//          tokens for access tokens. Pure request/response code; state lives in PluginConnections.

import { createHash, randomBytes } from "node:crypto";

export type Fetch = typeof fetch;

export interface OAuthEndpoints {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly registrationEndpoint?: string;
  /** Where a device sign-in starts (RFC 8628), for servers that offer one. */
  readonly deviceAuthorizationEndpoint?: string;
  readonly scope?: string;
}

export interface OAuthClient {
  readonly clientId: string;
  readonly clientSecret?: string;
}

export interface OAuthTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  /** Epoch milliseconds; absent when the server did not say. */
  readonly expiresAt?: number;
}

/** Thrown when the server says the grant itself is no longer good, so retrying cannot help. */
export class OAuthGrantRejected extends Error {}

const isLoopbackHost = (host: string) => host === "127.0.0.1" || host === "localhost";

/** Sign-in endpoints must be https; plain http is only ever a local test server. */
function endpoint(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`The sign-in server did not provide ${label}.`);
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new Error(`The sign-in server's ${label} is not a secure address.`);
  }
  return url.toString();
}

async function getJson(fetchFn: Fetch, url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetchFn(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function discoverEndpoints(
  fetchFn: Fetch,
  serverUrl: string,
): Promise<OAuthEndpoints> {
  const server = new URL(serverUrl);
  const path = server.pathname === "/" ? "" : server.pathname.replace(/\/$/, "");
  const resource =
    (await getJson(fetchFn, `${server.origin}/.well-known/oauth-protected-resource${path}`)) ??
    (await getJson(fetchFn, `${server.origin}/.well-known/oauth-protected-resource`));
  const servers = resource?.authorization_servers;
  const issuer = new URL(
    Array.isArray(servers) && typeof servers[0] === "string" ? servers[0] : server.origin,
  );
  const issuerPath = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
  const metadata =
    (await getJson(
      fetchFn,
      `${issuer.origin}/.well-known/oauth-authorization-server${issuerPath}`,
    )) ??
    (await getJson(fetchFn, `${issuer.origin}/.well-known/openid-configuration${issuerPath}`)) ??
    (await getJson(fetchFn, `${issuer.origin}${issuerPath}/.well-known/openid-configuration`));
  if (!metadata) throw new Error("This plugin's sign-in server could not be found.");
  const methods = metadata.code_challenge_methods_supported;
  if (Array.isArray(methods) && !methods.includes("S256")) {
    throw new Error("This plugin's sign-in server does not support a secure sign-in (PKCE).");
  }
  const scopes = resource?.scopes_supported;
  return {
    authorizationEndpoint: endpoint(metadata.authorization_endpoint, "an authorization address"),
    tokenEndpoint: endpoint(metadata.token_endpoint, "a token address"),
    ...(metadata.registration_endpoint
      ? { registrationEndpoint: endpoint(metadata.registration_endpoint, "a registration address") }
      : {}),
    ...(metadata.device_authorization_endpoint
      ? {
          deviceAuthorizationEndpoint: endpoint(
            metadata.device_authorization_endpoint,
            "a device sign-in address",
          ),
        }
      : {}),
    ...(Array.isArray(scopes) && scopes.every((scope) => typeof scope === "string") && scopes.length
      ? { scope: scopes.join(" ") }
      : {}),
  };
}

export async function registerClient(
  fetchFn: Fetch,
  endpoints: OAuthEndpoints,
  redirectUri: string,
): Promise<OAuthClient> {
  if (!endpoints.registrationEndpoint) {
    throw new Error("This plugin's sign-in server does not let DJL register itself.");
  }
  const response = await fetchFn(endpoints.registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "DJL",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || typeof body?.client_id !== "string") {
    throw new Error(`The sign-in server refused to register DJL (${response.status}).`);
  }
  return {
    clientId: body.client_id,
    ...(typeof body.client_secret === "string" ? { clientSecret: body.client_secret } : {}),
  };
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function buildAuthorizeUrl(input: {
  endpoints: OAuthEndpoints;
  client: OAuthClient;
  redirectUri: string;
  state: string;
  challenge: string;
  resource: string;
}): string {
  const url = new URL(input.endpoints.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.client.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", input.resource);
  if (input.endpoints.scope) url.searchParams.set("scope", input.endpoints.scope);
  return url.toString();
}

async function requestTokens(
  fetchFn: Fetch,
  tokenEndpoint: string,
  client: OAuthClient,
  params: Record<string, string>,
): Promise<OAuthTokens> {
  const response = await fetchFn(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      ...params,
      client_id: client.clientId,
      ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
    }),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || typeof body?.access_token !== "string") {
    const reason = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
    // 4xx means the code or refresh token was rejected; anything else may be a passing fault.
    if (response.status >= 400 && response.status < 500) {
      throw new OAuthGrantRejected(`Sign-in was rejected (${reason}).`);
    }
    throw new Error(`The sign-in server did not answer (${reason}).`);
  }
  return {
    accessToken: body.access_token,
    ...(typeof body.refresh_token === "string" ? { refreshToken: body.refresh_token } : {}),
    ...(typeof body.expires_in === "number"
      ? { expiresAt: Date.now() + body.expires_in * 1000 }
      : {}),
  };
}

export const exchangeCode = (
  fetchFn: Fetch,
  input: {
    tokenEndpoint: string;
    client: OAuthClient;
    code: string;
    verifier: string;
    redirectUri: string;
    resource: string;
  },
): Promise<OAuthTokens> =>
  requestTokens(fetchFn, input.tokenEndpoint, input.client, {
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: input.redirectUri,
    resource: input.resource,
  });

export interface DeviceAuthorization {
  readonly deviceCode: string;
  /** The short code the user confirms on the vendor's page. */
  readonly userCode: string;
  readonly verificationUri: string;
  readonly intervalMs: number;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

/**
 * Starts a device sign-in (RFC 8628). It needs only DJL's public client id, so a vendor that
 * does not let DJL register itself can still be signed in to without a secret in the app.
 */
export async function requestDeviceCode(
  fetchFn: Fetch,
  input: { endpoint: string; clientId: string; scope: string },
): Promise<DeviceAuthorization> {
  const response = await fetchFn(input.endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: input.clientId, scope: input.scope }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !response.ok ||
    typeof body?.device_code !== "string" ||
    typeof body.user_code !== "string" ||
    typeof body.verification_uri !== "string"
  ) {
    const reason = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(`The sign-in server would not start a sign-in (${reason}).`);
  }
  const seconds = (value: unknown, fallback: number) =>
    typeof value === "number" && value > 0 ? value : fallback;
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: endpoint(body.verification_uri, "a sign-in page"),
    intervalMs: seconds(body.interval, 5) * 1000,
    expiresAt: Date.now() + seconds(body.expires_in, 900) * 1000,
  };
}

export type DevicePoll =
  | { readonly status: "approved"; readonly tokens: OAuthTokens }
  | { readonly status: "pending" }
  | { readonly status: "slow_down" };

/** One check on a device sign-in. Throws once the user declined or the code ran out. */
export async function pollDeviceToken(
  fetchFn: Fetch,
  input: { tokenEndpoint: string; clientId: string; deviceCode: string },
): Promise<DevicePoll> {
  const response = await fetchFn(input.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: input.clientId,
      device_code: input.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof body?.access_token === "string") {
    return {
      status: "approved",
      tokens: {
        accessToken: body.access_token,
        ...(typeof body.refresh_token === "string" ? { refreshToken: body.refresh_token } : {}),
        ...(typeof body.expires_in === "number"
          ? { expiresAt: Date.now() + body.expires_in * 1000 }
          : {}),
      },
    };
  }
  // Servers answer "still waiting" with an error code, some with 200 and some with 400.
  const error = typeof body?.error === "string" ? body.error : undefined;
  if (error === "authorization_pending") return { status: "pending" };
  if (error === "slow_down") return { status: "slow_down" };
  if (error === "access_denied") throw new OAuthGrantRejected("Sign-in was cancelled.");
  if (error === "expired_token") {
    throw new OAuthGrantRejected("The sign-in code ran out. Start again.");
  }
  if (error) throw new OAuthGrantRejected(`Sign-in was rejected (${error}).`);
  throw new Error(`The sign-in server did not answer (HTTP ${response.status}).`);
}

export const refreshTokens = (
  fetchFn: Fetch,
  input: { tokenEndpoint: string; client: OAuthClient; refreshToken: string; resource: string },
): Promise<OAuthTokens> =>
  requestTokens(fetchFn, input.tokenEndpoint, input.client, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    resource: input.resource,
  });
