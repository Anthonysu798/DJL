/**
 * Resolves the caller and the organization they are acting in. Three
 * credentials are accepted:
 *   - `Authorization: Bearer <jwt>`: a 15-minute access token, verified locally
 *     against the JWKS and checked against the revoked-session denylist;
 *   - `Authorization: Bearer <session token>`: the long-lived device session,
 *     still accepted while clients move to access tokens;
 *   - the Better Auth session cookie (the web app).
 *
 * Org scoping is enforced here once so every route below it can trust
 * `principal.orgId` and `principal.role`.
 *
 * Org selection: `x-org-id` header, else the session's active organization,
 * else the user's personal organization. Membership is always re-checked
 * against the database; the header alone never grants access.
 */
import { and, eq } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { Effect, ServiceMap } from "effect";
import { HttpServerRequest } from "effect/unstable/http";

import type { DjlAuth } from "./auth.ts";
import { PERSONAL_ORG_METADATA } from "./auth.ts";
import { looksLikeJwt, type AccessTokenVerifier } from "./accessTokens.ts";
import type { SessionRevocations } from "./revocations.ts";
import { ApiError } from "../http/errors.ts";

export type OrgRole = "owner" | "admin" | "member" | "billing";

export interface Principal {
  readonly userId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly banned: boolean;
  readonly sessionId: string;
  readonly orgId: string;
  readonly role: OrgRole;
  readonly personalOrgId: string;
}

export class CurrentPrincipal extends ServiceMap.Service<CurrentPrincipal, Principal>()(
  "djl/api/auth/CurrentPrincipal",
) {}

export interface PrincipalResolver {
  readonly resolve: (input: {
    readonly headers: Headers;
    readonly requestedOrgId: string | null;
  }) => Promise<Principal>;
}

interface Caller {
  readonly user: {
    id: string;
    email: string;
    emailVerified: boolean;
    banned?: boolean | null | undefined;
  };
  readonly sessionId: string;
  readonly activeOrgId: string | null;
}

const unauthorized = () => new ApiError(401, "unauthorized", "Sign in required.");

export function makePrincipalResolver(
  auth: DjlAuth,
  db: DjlDatabase,
  tokens: {
    readonly verifyAccessToken: AccessTokenVerifier;
    readonly revocations: SessionRevocations;
  },
): PrincipalResolver {
  async function fromAccessToken(token: string): Promise<Caller> {
    const claims = await tokens.verifyAccessToken(token);
    if (!claims) throw new ApiError(401, "invalid_token", "The access token is not valid.");
    if (await tokens.revocations.isRevoked(claims.sessionId))
      throw new ApiError(401, "session_revoked", "This session was signed out.");
    const user = await db.query.user.findFirst({ where: eq(schema.user.id, claims.userId) });
    if (!user) throw unauthorized();
    return { user, sessionId: claims.sessionId, activeOrgId: null };
  }

  async function fromSession(headers: Headers): Promise<Caller> {
    const result = await auth.api.getSession({ headers });
    if (!result) throw unauthorized();
    const activeOrgId =
      (result.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
    return { user: result.user, sessionId: result.session.id, activeOrgId };
  }

  return {
    async resolve({ headers, requestedOrgId }) {
      const authorization = headers.get("authorization") ?? "";
      const bearer = /^bearer\s+/i.test(authorization)
        ? authorization.replace(/^bearer\s+/i, "").trim()
        : null;
      const { user, sessionId, activeOrgId } =
        bearer && looksLikeJwt(bearer) ? await fromAccessToken(bearer) : await fromSession(headers);
      if (user.banned) throw new ApiError(403, "suspended", "This account is suspended.");

      const memberships = await db
        .select({
          orgId: schema.member.organizationId,
          role: schema.member.role,
          metadata: schema.organization.metadata,
        })
        .from(schema.member)
        .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
        .where(eq(schema.member.userId, user.id));
      const personal = memberships.find((m) => m.metadata === PERSONAL_ORG_METADATA);
      if (!personal)
        throw new ApiError(500, "no_personal_org", "Account is missing its personal organization.");

      const wanted = requestedOrgId ?? activeOrgId ?? personal.orgId;
      const membership = memberships.find((m) => m.orgId === wanted);
      if (!membership)
        throw new ApiError(403, "not_a_member", "You are not a member of that organization.");

      return {
        userId: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        banned: Boolean(user.banned),
        sessionId,
        orgId: membership.orgId,
        role: (membership.role as OrgRole) ?? "member",
        personalOrgId: personal.orgId,
      };
    },
  };
}

/** Effect helper: read the request, resolve the principal, or fail with ApiError. */
export function requirePrincipal(resolver: PrincipalResolver) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const headers = new Headers();
    for (const [k, v] of Object.entries(request.headers)) if (v !== undefined) headers.set(k, v);
    const requestedOrgId = request.headers["x-org-id"] ?? null;
    return yield* Effect.tryPromise({
      try: () => resolver.resolve({ headers, requestedOrgId }),
      catch: (e) => {
        if (e instanceof ApiError) return e;
        process.stderr.write(
          `principal resolution failed: ${e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : String(e)}\n`,
        );
        return new ApiError(500, "auth_failed", "Could not resolve session.");
      },
    });
  });
}

export function requireRole(principal: Principal, roles: readonly OrgRole[]): void {
  if (!roles.includes(principal.role))
    throw new ApiError(403, "forbidden", "Your role cannot do that.");
}

export async function isMember(db: DjlDatabase, userId: string, orgId: string): Promise<boolean> {
  const row = await db.query.member.findFirst({
    where: and(eq(schema.member.userId, userId), eq(schema.member.organizationId, orgId)),
  });
  return Boolean(row);
}
