/**
 * Resolves the caller from a Better Auth session (cookie or bearer token) and
 * the organization they are acting in. Org scoping is enforced here once so
 * every route below it can trust `principal.orgId` and `principal.role`.
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

export function makePrincipalResolver(auth: DjlAuth, db: DjlDatabase): PrincipalResolver {
  return {
    async resolve({ headers, requestedOrgId }) {
      const result = await auth.api.getSession({ headers });
      if (!result) throw new ApiError(401, "unauthorized", "Sign in required.");
      const { user, session } = result;
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

      const sessionOrg =
        (session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
      const wanted = requestedOrgId ?? sessionOrg ?? personal.orgId;
      const membership = memberships.find((m) => m.orgId === wanted);
      if (!membership)
        throw new ApiError(403, "not_a_member", "You are not a member of that organization.");

      return {
        userId: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        banned: Boolean(user.banned),
        sessionId: session.id,
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
      catch: (e) =>
        e instanceof ApiError ? e : new ApiError(500, "auth_failed", "Could not resolve session."),
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
