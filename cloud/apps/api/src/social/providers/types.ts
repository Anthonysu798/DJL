export type SocialProviderId = "instagram" | "tiktok";
export interface ProviderTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  scope: string[];
  providerUserId?: string;
}
export interface ProviderAccount {
  id: string;
  username: string;
  displayName: string;
  scopes: string[];
  capabilities: { publish: boolean; metrics: boolean };
}
export interface AuthorizationInput {
  state: string;
  redirectUri: string;
  codeChallenge?: string;
}
export interface ExchangeInput {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}
export interface ProviderOptions {
  fetch?: typeof fetch;
  now?: () => number;
}
export interface SocialProvider {
  readonly id: SocialProviderId;
  authorizationUrl(input: AuthorizationInput): string;
  exchangeCode(input: ExchangeInput): Promise<ProviderTokens>;
  refresh(tokens: ProviderTokens): Promise<ProviderTokens>;
  revoke(tokens: ProviderTokens): Promise<void>;
  account(tokens: ProviderTokens): Promise<ProviderAccount>;
}
export type ProviderErrorKind =
  | "rejected"
  | "unavailable"
  | "invalid_response"
  | "uncertain"
  | "missing_scope";
// Never retain upstream messages, URLs, response bodies, or error causes: they may contain credentials.
export class SocialProviderError extends Error {
  constructor(readonly kind: ProviderErrorKind) {
    super(`Social provider request ${kind}`);
  }
}
export type ProviderMetrics = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
};
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SocialProviderError("invalid_response");
  return value as Record<string, unknown>;
}
export function string(value: unknown): string {
  if (typeof value !== "string" || !value) throw new SocialProviderError("invalid_response");
  return value;
}
export function expiresAt(seconds: unknown, now: number): string {
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > 315360000
  )
    throw new SocialProviderError("invalid_response");
  return new Date(now + seconds * 1000).toISOString();
}
export function requireScope(tokens: ProviderTokens, scope: string): void {
  if (!tokens.scope.includes(scope)) throw new SocialProviderError("missing_scope");
}
export function metric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
export async function request(
  fetcher: typeof fetch,
  url: string | URL,
  init: RequestInit,
  write = false,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new SocialProviderError(write ? "uncertain" : "unavailable");
  }
  if (!response.ok)
    throw new SocialProviderError(write && response.status >= 500 ? "uncertain" : "rejected");
  let body: Record<string, unknown>;
  try {
    body = record(await response.json());
  } catch {
    throw new SocialProviderError(write ? "uncertain" : "invalid_response");
  }
  if (body.error && (typeof body.error !== "object" || record(body.error).code !== "ok"))
    throw new SocialProviderError("rejected");
  return body;
}
export function form(values: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  };
}
export function authenticated(tokens: ProviderTokens, body?: unknown): RequestInit {
  return {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${tokens.accessToken}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

/** Only return provider-supplied HTTPS links on the platform's own domain. */
export function postUrl(value: unknown, domain: "instagram.com" | "tiktok.com"): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === domain || url.hostname.endsWith(`.${domain}`))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
