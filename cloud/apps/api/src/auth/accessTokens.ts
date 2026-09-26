/**
 * Local verification of the 15-minute access tokens minted by Better Auth's
 * JWT plugin (GET /v1/auth/token). The public keys come from the auth
 * instance's own JWKS and are cached; an unknown `kid` triggers a refetch (at
 * most every 30 seconds) so a key rotation is picked up without a restart.
 */
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";

export const ACCESS_TOKEN_AUDIENCE = "djl-cloud";
const MIN_REFRESH_INTERVAL_MS = 30_000;

export interface AccessTokenClaims {
  readonly userId: string;
  readonly sessionId: string;
}

export type AccessTokenVerifier = (token: string) => Promise<AccessTokenClaims | null>;

/** A compact JWS has three base64url segments; opaque session tokens have none. */
export function looksLikeJwt(token: string): boolean {
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token);
}

export function makeAccessTokenVerifier(input: {
  readonly issuer: string;
  readonly loadJwks: () => Promise<JSONWebKeySet>;
}): AccessTokenVerifier {
  let keys: ReturnType<typeof createLocalJWKSet> | null = null;
  let refreshedAt = 0;
  let keyCount = 0;
  const refresh = async () => {
    const jwks = await input.loadJwks();
    keys = createLocalJWKSet(jwks);
    keyCount = jwks.keys.length;
    refreshedAt = Date.now();
    return keys;
  };
  const verify = async (token: string, jwks: ReturnType<typeof createLocalJWKSet>) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: input.issuer,
      audience: ACCESS_TOKEN_AUDIENCE,
      algorithms: ["EdDSA"],
    });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
    return { userId: payload.sub, sessionId: payload.sid };
  };
  return async (token) => {
    try {
      return await verify(token, keys ?? (await refresh()));
    } catch (error) {
      // A kid we have not seen yet may be the first key or a freshly rotated one.
      const unknownKey = (error as { code?: string }).code === "ERR_JWKS_NO_MATCHING_KEY";
      const recentlyRefreshed = Date.now() - refreshedAt < MIN_REFRESH_INTERVAL_MS;
      if (!unknownKey || (keyCount > 0 && recentlyRefreshed)) return null;
      try {
        return await verify(token, await refresh());
      } catch {
        return null;
      }
    }
  };
}
