/**
 * Admin API under /admin/v1. Separate cookie, separate accounts, IP allowlist,
 * and a verified second factor on everything except enrollment.
 */
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import { attempt, handle } from "../http/handle.ts";
import { json, readJson } from "../http/json.ts";
import {
  ADMIN_SESSION_COOKIE,
  type AdminAuth,
  type AdminPrincipal,
  type LoginClient,
} from "./AdminAuth.ts";
import type { AdminService } from "./AdminService.ts";
import type { UsageAdminService } from "../usage/UsageAdminService.ts";

export interface AdminRouteDeps {
  readonly adminAuth: AdminAuth;
  readonly admin: AdminService;
  readonly usageAdmin: UsageAdminService;
  readonly secureCookies: boolean;
  readonly gatewayStatus: () => {
    readonly inFlight: number;
    readonly breakers: Record<string, string>;
  };
}

const FAIL = { status: 500, code: "admin_error", message: "Admin operation failed." };

const param = (name: string) =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const value = params[name];
    if (!value) return yield* Effect.fail(new ApiError(400, "bad_request", `${name} is required.`));
    return value;
  });
const str = (v: unknown) => (typeof v === "string" ? v : null);
/** Only the fields we store, only as strings; anything else is dropped. */
function loginClient(raw: unknown): LoginClient | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  return {
    timezone: str(o.timezone) ?? undefined,
    locale: str(o.locale) ?? undefined,
    platform: str(o.platform) ?? undefined,
    screen: str(o.screen) ?? undefined,
    deviceId: str(o.deviceId) ?? undefined,
  };
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function makeAdminRoutes(deps: AdminRouteDeps) {
  const principal = (opts: { readonly mfa: boolean } = { mfa: true }) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const ctx = yield* RequestContext;
      const token =
        request.headers["authorization"]?.replace(/^Bearer\s+/i, "") ??
        cookieValue(request.headers["cookie"], ADMIN_SESSION_COOKIE);
      const p = yield* attempt(() => deps.adminAuth.resolve(token, ctx.ip), {
        status: 401,
        code: "unauthorized",
        message: "Admin sign-in required.",
      });
      if (opts.mfa && !p.mfaVerified) {
        return yield* Effect.fail(
          new ApiError(
            403,
            "mfa_required",
            "Enroll and verify an authenticator before using the admin API.",
          ),
        );
      }
      return p;
    });

  const setCookie = (token: string, expiresAt: Date) =>
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/admin; HttpOnly; SameSite=Strict; Expires=${expiresAt.toUTCString()}${deps.secureCookies ? "; Secure" : ""}`;

  const login = HttpRouter.add(
    "POST",
    "/admin/v1/auth/login",
    handle(
      Effect.gen(function* () {
        const ctx = yield* RequestContext;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const body = (yield* readJson) as Partial<{
          email: string;
          password: string;
          totp: string;
          client: LoginClient;
        }>;
        if (typeof body.email !== "string" || typeof body.password !== "string")
          return yield* Effect.fail(
            new ApiError(400, "bad_request", "email and password are required."),
          );
        const result = yield* attempt(
          () =>
            deps.adminAuth.login({
              email: body.email!,
              password: body.password!,
              ...(body.totp ? { totp: body.totp } : {}),
              ip: ctx.ip,
              country: request.headers["cf-ipcountry"] ?? null,
              userAgent: ctx.userAgent,
              client: loginClient(body.client),
            }),
          { status: 401, code: "bad_credentials", message: "Sign-in failed." },
        );
        const res = json({
          admin: {
            id: result.principal.adminId,
            email: result.principal.email,
            role: result.principal.role,
            mfaVerified: result.principal.mfaVerified,
          },
          token: result.token,
          expiresAt: result.expiresAt,
        });
        return HttpServerResponse.setHeader(
          res,
          "set-cookie",
          setCookie(result.token, result.expiresAt),
        );
      }),
    ),
  );

  // Public: the invite link lands here before the employee has any credentials.
  const inviteInspect = HttpRouter.add(
    "POST",
    "/admin/v1/auth/invite/inspect",
    handle(
      Effect.gen(function* () {
        const ctx = yield* RequestContext;
        const body = (yield* readJson) as Partial<{ token: string }>;
        const result = yield* attempt(
          () => deps.adminAuth.inspectInvite(String(body.token ?? ""), ctx.ip),
          { status: 400, code: "invalid_invite", message: "This invite link is not valid." },
        );
        return json(result);
      }),
    ),
  );
  const inviteAccept = HttpRouter.add(
    "POST",
    "/admin/v1/auth/invite/accept",
    handle(
      Effect.gen(function* () {
        const ctx = yield* RequestContext;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const body = (yield* readJson) as Partial<{
          token: string;
          password: string;
          client: LoginClient;
        }>;
        if (typeof body.password !== "string")
          return yield* Effect.fail(new ApiError(400, "bad_request", "password is required."));
        const result = yield* attempt(
          () =>
            deps.adminAuth.acceptInvite({
              token: String(body.token ?? ""),
              password: body.password!,
              ip: ctx.ip,
              country: request.headers["cf-ipcountry"] ?? null,
              userAgent: ctx.userAgent,
              client: loginClient(body.client),
            }),
          { status: 400, code: "invalid_invite", message: "This invite link is not valid." },
        );
        return json(result);
      }),
    ),
  );

  const logout = HttpRouter.add(
    "POST",
    "/admin/v1/auth/logout",
    handle(
      Effect.gen(function* () {
        const p = yield* principal({ mfa: false });
        yield* Effect.promise(() => deps.adminAuth.logout(p.sessionId));
        return json({ ok: true });
      }),
    ),
  );

  const me = HttpRouter.add(
    "GET",
    "/admin/v1/me",
    handle(
      Effect.gen(function* () {
        const p = yield* principal({ mfa: false });
        return json({
          admin: { id: p.adminId, email: p.email, role: p.role, mfaVerified: p.mfaVerified },
        });
      }),
    ),
  );

  const totpEnroll = HttpRouter.add(
    "POST",
    "/admin/v1/auth/totp/enroll",
    handle(
      Effect.gen(function* () {
        const p = yield* principal({ mfa: false });
        const r = yield* Effect.promise(() =>
          deps.adminAuth.beginTotpEnrollment(p.adminId, p.email),
        );
        return json(r);
      }),
    ),
  );

  const totpConfirm = HttpRouter.add(
    "POST",
    "/admin/v1/auth/totp/confirm",
    handle(
      Effect.gen(function* () {
        const p = yield* principal({ mfa: false });
        const body = (yield* readJson) as Partial<{ code: string }>;
        const ok = yield* Effect.promise(() =>
          deps.adminAuth.confirmTotpEnrollment(p.adminId, p.sessionId, body.code ?? ""),
        );
        if (!ok)
          return yield* Effect.fail(new ApiError(400, "bad_totp", "Authenticator code is wrong."));
        return json({ ok: true });
      }),
    ),
  );

  const query = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return HttpServerRequest.toURL(request)?.searchParams ?? new URLSearchParams();
  });

  const op = <A>(fn: (p: AdminPrincipal) => Promise<A>) =>
    handle(
      Effect.gen(function* () {
        const p = yield* principal();
        const result = yield* attempt(() => fn(p), FAIL);
        return json(result ?? { ok: true });
      }),
    );
  const opWithQuery = <A>(fn: (p: AdminPrincipal, params: URLSearchParams) => Promise<A>) =>
    handle(
      Effect.gen(function* () {
        const p = yield* principal();
        const q = yield* query;
        const result = yield* attempt(() => fn(p, q), FAIL);
        return json(result ?? { ok: true });
      }),
    );
  const emptyBody: Effect.Effect<Record<string, unknown>, ApiError> = Effect.succeed({});
  const opWithParam = <A>(
    name: string,
    fn: (p: AdminPrincipal, value: string, body: Record<string, unknown>) => Promise<A>,
    readBody = true,
  ) =>
    handle(
      Effect.gen(function* () {
        const p = yield* principal();
        const value = yield* param(name);
        const body = (yield* readBody ? readJson : emptyBody) as Record<string, unknown>;
        const result = yield* attempt(() => fn(p, value, body), FAIL);
        return json(result ?? { ok: true });
      }),
    );

  const routes = [
    HttpRouter.add(
      "GET",
      "/admin/v1/users",
      handle(
        Effect.gen(function* () {
          const p = yield* principal();
          const q = yield* query;
          const result = yield* attempt(
            () =>
              deps.admin.searchUsers(p, {
                ...(q.get("q") ? { q: q.get("q")! } : {}),
                ...(q.get("limit") ? { limit: Number(q.get("limit")) } : {}),
                ...(q.get("cursor") ? { cursor: q.get("cursor")! } : {}),
              }),
            FAIL,
          );
          return json(result);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/users/:id",
      opWithParam("id", (p, id) => deps.admin.userDetail(p, id), false),
    ),
    HttpRouter.add(
      "PATCH",
      "/admin/v1/users/:id",
      opWithParam("id", (p, id, b) =>
        deps.admin.updateUser(
          p,
          id,
          {
            ...(str(b.name) ? { name: str(b.name)! } : {}),
            ...(str(b.email) ? { email: str(b.email)! } : {}),
          },
          str(b.reason),
        ),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/users/:id/suspend",
      opWithParam("id", (p, id, b) =>
        deps.admin.suspendUser(p, id, {
          suspend: b.suspend !== false,
          reason: str(b.reason) ?? "",
        }),
      ),
    ),
    HttpRouter.add(
      "DELETE",
      "/admin/v1/users/:id",
      opWithParam("id", (p, id, b) => deps.admin.deleteUser(p, id, str(b.reason) ?? "")),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/users/:id/sessions/revoke",
      opWithParam("id", (p, id) => deps.admin.revokeSessions(p, id), false),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/users/:id/reset-limits",
      opWithParam("id", (p, id, b) => deps.admin.resetLimits(p, id, str(b.reason))),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/users/:id/usage",
      opWithParam("id", (p, id) => deps.usageAdmin.userUsage(p, id), false),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/users/:id/usage/banks",
      opWithParam("id", (p, id, b) =>
        deps.usageAdmin.grantBanks(p, id, { count: b.count, reason: b.reason }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/usage/banks/:id/revoke",
      opWithParam("id", (p, id, b) => deps.usageAdmin.revokeBank(p, id, b.reason)),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/usage/reset-all",
      handle(
        Effect.gen(function* () {
          const p = yield* principal();
          const b = (yield* readJson) as Record<string, unknown>;
          return json(
            yield* attempt(
              () => deps.usageAdmin.resetAll(p, { confirm: b.confirm, reason: b.reason }),
              FAIL,
            ),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/usage/schedules",
      op((p) => deps.usageAdmin.schedules(p)),
    ),
    HttpRouter.add(
      "PUT",
      "/admin/v1/usage/schedules/:planId",
      opWithParam("planId", (p, planId, b) =>
        deps.usageAdmin.putSchedule(
          p,
          planId,
          { everyDays: b.everyDays, banksPerGrant: b.banksPerGrant, active: b.active },
          b.reason,
        ),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/usage/batches",
      op((p) => deps.usageAdmin.batches(p)),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/usage/batches",
      handle(
        Effect.gen(function* () {
          const p = yield* principal();
          const b = (yield* readJson) as Record<string, unknown>;
          return json(
            yield* attempt(
              () =>
                deps.usageAdmin.createBulkGrant(p, {
                  planId: b.planId,
                  reason: b.reason,
                  idempotencyKey: b.idempotencyKey,
                }),
              FAIL,
            ),
          );
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/orgs/:id/credits/grant",
      opWithParam("id", (p, id, b) =>
        deps.admin.grantCredits(p, id, { credits: Number(b.credits), reason: str(b.reason) ?? "" }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/stats",
      handle(
        Effect.gen(function* () {
          const p = yield* principal();
          const q = yield* query;
          const range =
            (["day", "week", "month", "year"] as const).find((r) => r === q.get("range")) ?? "week";
          return json(yield* attempt(() => deps.admin.stats(p, range), FAIL));
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/models",
      op((p) => deps.admin.listModels(p)),
    ),
    HttpRouter.add(
      "PATCH",
      "/admin/v1/models/:id",
      opWithParam("id", (p, id, b) => deps.admin.updateModel(p, id, b, str(b.reason))),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/plans",
      op((p) => deps.admin.listPlans(p)),
    ),
    HttpRouter.add(
      "PATCH",
      "/admin/v1/plans/:id",
      opWithParam("id", (p, id, b) => deps.admin.updatePlan(p, id, b, str(b.reason))),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/settings",
      op((p) => deps.admin.getSettings(p)),
    ),
    HttpRouter.add(
      "PUT",
      "/admin/v1/settings/:key",
      opWithParam("key", (p, key, b) => deps.admin.putSetting(p, key, b.value, str(b.reason))),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/kill-switches",
      op((p) => deps.admin.killSwitches(p)),
    ),
    HttpRouter.add(
      "PUT",
      "/admin/v1/kill-switches/:name",
      opWithParam("name", (p, name, b) => {
        if (name !== "gateway" && name !== "billing" && name !== "sync")
          throw new ApiError(404, "not_found", "Unknown switch.");
        return deps.admin.setKillSwitch(p, name, b.engaged === true, str(b.reason) ?? "");
      }),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/audit",
      opWithQuery(async (p, q) =>
        deps.admin.audit(p, {
          ...(q.get("targetId") ? { targetId: q.get("targetId")! } : {}),
          ...(q.get("actorId") ? { actorId: q.get("actorId")! } : {}),
          ...(q.get("action") ? { action: q.get("action")! } : {}),
          ...(q.get("limit") ? { limit: Number(q.get("limit")) } : {}),
          ...(q.get("before") ? { before: q.get("before")! } : {}),
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/trials",
      op((p) => deps.admin.trialQueue(p)),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/trials/:id/approve",
      opWithParam("id", (p, id) => deps.admin.approveTrial(p, id), false),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/admins",
      op((p) => deps.admin.listAdmins(p)),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/admins",
      handle(
        Effect.gen(function* () {
          const p = yield* principal();
          const b = (yield* readJson) as Record<string, unknown>;
          const result = yield* attempt(
            () =>
              deps.admin.inviteAdmin(p, {
                email: b.email,
                name: b.name,
                role: b.role,
                reason: b.reason,
              }),
            FAIL,
          );
          return json(result);
        }),
      ),
    ),
    HttpRouter.add(
      "PATCH",
      "/admin/v1/admins/:id",
      opWithParam("id", (p, id, b) =>
        deps.admin.updateAdmin(p, id, {
          ...(b.name !== undefined ? { name: b.name } : {}),
          ...(b.role !== undefined ? { role: b.role } : {}),
          reason: b.reason,
        }),
      ),
    ),
    HttpRouter.add(
      "DELETE",
      "/admin/v1/admins/:id",
      opWithParam("id", (p, id, b) => deps.admin.deleteAdmin(p, id, b.reason)),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/admins/:id/disabled",
      opWithParam("id", (p, id, b) =>
        deps.admin.setAdminDisabled(p, id, b.disabled === true, str(b.reason) ?? ""),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/admins/:id/resend-invite",
      opWithParam("id", (p, id, b) => deps.admin.resendInvite(p, id, b.reason)),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/admins/:id/revoke-sessions",
      opWithParam("id", (p, id, b) => deps.admin.revokeAdminSessions(p, id, b.reason)),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/admins/:id/logins",
      opWithParam("id", (p, id) => deps.admin.loginEvents(p, { adminId: id }), false),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/security/logins",
      opWithQuery((p, q) =>
        deps.admin.loginEvents(p, {
          ...(q.get("ip") ? { ip: q.get("ip")! } : {}),
          ...(q.get("adminId") ? { adminId: q.get("adminId")! } : {}),
          ...(q.get("limit") ? { limit: Number(q.get("limit")) } : {}),
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/security/ip-bans",
      op((p) => deps.admin.ipBans(p)),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/security/ip-bans",
      handle(
        Effect.gen(function* () {
          const p = yield* principal();
          const b = (yield* readJson) as Record<string, unknown>;
          const result = yield* attempt(() => deps.admin.setIpBan(p, b.ip, true, b.reason), FAIL);
          return json(result);
        }),
      ),
    ),
    HttpRouter.add(
      "POST",
      "/admin/v1/security/ip-bans/remove",
      handle(
        Effect.gen(function* () {
          const p = yield* principal();
          const b = (yield* readJson) as Record<string, unknown>;
          const result = yield* attempt(() => deps.admin.setIpBan(p, b.ip, false, b.reason), FAIL);
          return json(result);
        }),
      ),
    ),
    HttpRouter.add(
      "GET",
      "/admin/v1/status",
      op((p) => deps.admin.serverStatus(p, deps.gatewayStatus())),
    ),
  ];

  return Layer.mergeAll(
    login,
    inviteInspect,
    inviteAccept,
    logout,
    me,
    totpEnroll,
    totpConfirm,
    ...routes,
  );
}
