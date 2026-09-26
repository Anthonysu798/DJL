/**
 * Browser sign-in for native apps: OAuth 2.0 authorization codes with PKCE
 * S256 (RFC 7636). The signed-in browser mints a code bound to the client id,
 * the exact redirect URI, and the code challenge; the app redeems it once,
 * within 60 seconds, with the matching verifier for a device session token.
 *
 * Only the SHA-256 of a code is stored. Redemption burns the code before any
 * other check, so a wrong verifier or a tampered redirect still spends it and
 * a stolen code cannot be retried.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type {
  CloudNativeAuthCodeResponse,
  CloudNativeAuthorizeRequest,
  CloudNativeTokenInput,
  CloudNativeTokenResponse,
} from "@synara/contracts/cloud";

import type { DjlAuth } from "../auth/auth.ts";
import type { Principal } from "../auth/guard.ts";
import { ApiError } from "../http/errors.ts";

export const NATIVE_AUTH_CODE_TTL_MS = 60_000;

/** Exact redirect URIs per client; nothing else is ever redirected to. */
export const NATIVE_AUTH_CLIENTS: Readonly<Record<string, readonly string[]>> = {
  "djl-desktop": ["djl://auth/callback"],
};

const sha256 = (value: string) => createHash("sha256").update(value).digest();
const base64url = (bytes: Buffer) => bytes.toString("base64url");

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

const invalidGrant = () =>
  new ApiError(400, "invalid_grant", "This sign-in link has expired. Start again from the app.");

export class NativeAuthService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly auth: DjlAuth,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Refuses unknown clients and any redirect URI not on the client's list. */
  assertClient(clientId: string, redirectUri: string): void {
    if (!NATIVE_AUTH_CLIENTS[clientId]?.includes(redirectUri))
      throw new ApiError(400, "invalid_client", "This app is not allowed to sign in here.");
  }

  async issueCode(
    principal: Principal,
    request: CloudNativeAuthorizeRequest,
  ): Promise<CloudNativeAuthCodeResponse> {
    this.assertClient(request.clientId, request.redirectUri);
    const code = base64url(randomBytes(32));
    const expiresAt = new Date(this.now().getTime() + NATIVE_AUTH_CODE_TTL_MS);
    await this.db.insert(schema.nativeAuthCodes).values({
      codeHash: base64url(sha256(code)),
      userId: principal.userId,
      orgId: principal.orgId,
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      expiresAt,
    });
    const redirect = new URL(request.redirectUri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", request.state);
    return { redirectTo: redirect.toString(), expiresAt: expiresAt.toISOString() };
  }

  async exchange(
    input: CloudNativeTokenInput,
    client: { readonly ip: string | null; readonly userAgent: string | null },
  ): Promise<CloudNativeTokenResponse> {
    const [grant] = await this.db
      .update(schema.nativeAuthCodes)
      .set({ usedAt: this.now() })
      .where(
        and(
          eq(schema.nativeAuthCodes.codeHash, base64url(sha256(input.code))),
          isNull(schema.nativeAuthCodes.usedAt),
          gt(schema.nativeAuthCodes.expiresAt, this.now()),
        ),
      )
      .returning();
    if (!grant) throw invalidGrant();
    const challenge = Buffer.from(base64url(sha256(input.codeVerifier)));
    if (
      grant.clientId !== input.clientId ||
      grant.redirectUri !== input.redirectUri ||
      !sameBytes(challenge, Buffer.from(grant.codeChallenge))
    )
      throw invalidGrant();

    const user = await this.db.query.user.findFirst({ where: eq(schema.user.id, grant.userId) });
    if (!user || user.banned) throw new ApiError(403, "suspended", "This account is suspended.");
    const ctx = await this.auth.$context;
    const session = await ctx.internalAdapter.createSession(user.id, false, {
      ipAddress: client.ip ?? "",
      userAgent: client.userAgent ?? "",
    });
    if (!session) throw new ApiError(500, "session_failed", "Could not start a session.");
    return {
      sessionToken: session.token,
      expiresAt: session.expiresAt.toISOString(),
      userId: user.id as CloudNativeTokenResponse["userId"],
      orgId: grant.orgId as CloudNativeTokenResponse["orgId"],
    };
  }
}
