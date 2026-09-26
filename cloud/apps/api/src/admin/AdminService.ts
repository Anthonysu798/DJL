/**
 * Admin operations. Every mutation writes an audit row with before/after in
 * the same transaction where the change is a single statement, and never
 * touches credits except through the ledger with an explicit reason.
 */
import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { creditsToMicro, formatCredits, totalAvailable, type Microcredits } from "@djl/domain";
import { adminInvite, type EmailSender } from "@djl/notify";

import type { ResumeWindowBlockedRuns } from "../agent/resume.ts";
import { writeAudit } from "../audit/AuditLog.ts";
import type { SessionRevocations } from "../auth/revocations.ts";
import type { LedgerService } from "../credits/LedgerService.ts";
import type { GatewayService } from "../gateway/GatewayService.ts";
import type { RateLimiter } from "../gateway/RateLimiter.ts";
import { ApiError } from "../http/errors.ts";
import type { TrialService } from "../trial/TrialService.ts";
import { resetWindows } from "../usage/windowStore.ts";
import {
  ADMIN_ROLES,
  isIpOrCidr,
  requirePermission,
  type AdminAuth,
  type AdminPrincipal,
  type AdminRole,
} from "./AdminAuth.ts";

export interface AdminDeps {
  readonly db: DjlDatabase;
  readonly ledger: LedgerService;
  readonly limiter: RateLimiter;
  readonly gateway: Pick<GatewayService, "invalidateCatalog">;
  readonly trial: Pick<TrialService, "approve">;
  readonly auth: Pick<AdminAuth, "issueInvite" | "revokeSessions" | "revokeSessionsFromIp">;
  /** Denylists user sessions so their access tokens stop working before they expire. */
  readonly revocations: Pick<SessionRevocations, "revoke">;
  /** Re-enqueues a user's window-blocked task runs after their windows are reset. */
  readonly resumeRuns?: ResumeWindowBlockedRuns;
  readonly email: EmailSender;
  /** Where invite links point, e.g. https://admin.slcor.com. */
  readonly adminPublicUrl: string;
  readonly version: string;
}

const EMPLOYEE_GRANT_CAP = creditsToMicro(500);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isRole = (v: unknown): v is AdminRole => ADMIN_ROLES.includes(v as AdminRole);
const needReason = (reason: unknown): string => {
  if (typeof reason !== "string" || !reason.trim())
    throw new ApiError(400, "bad_request", "A reason is required.");
  return reason.trim();
};

export class AdminService {
  constructor(private readonly deps: AdminDeps) {}

  // ---- users ---------------------------------------------------------------

  async searchUsers(
    p: AdminPrincipal,
    input: { readonly q?: string; readonly limit?: number; readonly cursor?: string },
  ) {
    requirePermission(p, "users.read");
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
    const q = input.q?.trim();
    const where = q
      ? or(
          ilike(schema.user.email, `%${q}%`),
          ilike(schema.user.name, `%${q}%`),
          sql`${schema.user.id}::text = ${q}`,
          ilike(schema.user.phoneNumber, `%${q}%`),
        )
      : undefined;
    const rows = await this.deps.db.query.user.findMany({
      where: input.cursor ? and(where, lte(schema.user.createdAt, new Date(input.cursor))) : where,
      orderBy: [desc(schema.user.createdAt)],
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      users: page.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        emailVerified: u.emailVerified,
        phoneNumber: u.phoneNumber ? `***${u.phoneNumber.slice(-4)}` : null,
        banned: u.banned,
        banReason: u.banReason,
        createdAt: u.createdAt,
      })),
      nextCursor: rows.length > limit ? page.at(-1)?.createdAt.toISOString() : null,
    };
  }

  async userDetail(p: AdminPrincipal, userId: string) {
    requirePermission(p, "users.read");
    const user = await this.deps.db.query.user.findFirst({ where: eq(schema.user.id, userId) });
    if (!user) throw new ApiError(404, "not_found", "User not found.");
    const memberships = await this.deps.db
      .select({
        orgId: schema.member.organizationId,
        role: schema.member.role,
        name: schema.organization.name,
        metadata: schema.organization.metadata,
      })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(eq(schema.member.userId, userId));
    const orgs = await Promise.all(
      memberships.map(async (m) => {
        const balances = await this.deps.ledger.balances(m.orgId);
        const sub = await this.deps.db.query.subscriptions.findFirst({
          where: eq(schema.subscriptions.orgId, m.orgId),
          orderBy: [desc(schema.subscriptions.createdAt)],
        });
        return {
          id: m.orgId,
          name: m.name,
          role: m.role,
          personal: m.metadata?.includes('"personal"') ?? false,
          balances,
          total: formatCredits(totalAvailable(balances)),
          plan: sub?.planId ?? "trial",
          subscriptionStatus: sub?.status ?? null,
        };
      }),
    );
    const [devices, flags, sessions, trial, recentUsage] = await Promise.all([
      this.deps.db.query.devices.findMany({ where: eq(schema.devices.userId, userId) }),
      this.deps.db.query.abuseFlags.findMany({
        where: eq(schema.abuseFlags.userId, userId),
        orderBy: [desc(schema.abuseFlags.createdAt)],
        limit: 20,
      }),
      this.deps.db.$count(schema.session, eq(schema.session.userId, userId)),
      memberships.length
        ? this.deps.db.query.trialGrants.findFirst({
            where: inArray(
              schema.trialGrants.orgId,
              memberships.map((m) => m.orgId),
            ),
          })
        : Promise.resolve(null),
      this.deps.db.query.usageRequests.findMany({
        where: eq(schema.usageRequests.userId, userId),
        orderBy: [desc(schema.usageRequests.createdAt)],
        limit: 20,
      }),
    ]);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneNumberVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        banned: user.banned,
        banReason: user.banReason,
        banExpires: user.banExpires,
        createdAt: user.createdAt,
      },
      organizations: orgs,
      devices: devices.map((d) => ({
        id: d.id,
        kind: d.kind,
        name: d.name,
        trustState: d.trustState,
        syncEnabled: d.syncEnabled,
        lastSeenAt: d.lastSeenAt,
      })),
      abuseFlags: flags,
      activeSessions: sessions,
      trial: trial
        ? {
            status: trial.status,
            reasons: trial.reasons,
            grantedAt: trial.grantedAt,
            expiresAt: trial.expiresAt,
          }
        : null,
      recentUsage: recentUsage.map((r) => ({
        id: r.id,
        model: r.modelId,
        status: r.status,
        settled: r.settledMicro?.toString() ?? null,
        createdAt: r.createdAt,
      })),
    };
  }

  async updateUser(
    p: AdminPrincipal,
    userId: string,
    patch: { readonly name?: string; readonly email?: string },
    reason: string | null,
  ) {
    requirePermission(p, "users.write");
    const before = await this.deps.db.query.user.findFirst({ where: eq(schema.user.id, userId) });
    if (!before) throw new ApiError(404, "not_found", "User not found.");
    const set: Partial<{ name: string; email: string }> = {};
    if (patch.name?.trim()) set.name = patch.name.trim().slice(0, 80);
    if (patch.email?.trim()) set.email = patch.email.trim().toLowerCase();
    if (Object.keys(set).length === 0) throw new ApiError(400, "bad_request", "Nothing to update.");
    await this.deps.db.transaction(async (tx) => {
      await tx.update(schema.user).set(set).where(eq(schema.user.id, userId));
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "admin.user.update",
        targetType: "user",
        targetId: userId,
        before: { name: before.name, email: before.email },
        after: set,
        reason,
      });
    });
  }

  async suspendUser(
    p: AdminPrincipal,
    userId: string,
    input: { readonly suspend: boolean; readonly reason: string },
  ) {
    requirePermission(p, "users.suspend");
    if (!input.reason?.trim()) throw new ApiError(400, "bad_request", "A reason is required.");
    const before = await this.deps.db.query.user.findFirst({ where: eq(schema.user.id, userId) });
    if (!before) throw new ApiError(404, "not_found", "User not found.");
    await this.deps.db.transaction(async (tx) => {
      await tx
        .update(schema.user)
        .set({
          banned: input.suspend,
          banReason: input.suspend ? input.reason : null,
          banExpires: null,
        })
        .where(eq(schema.user.id, userId));
      if (input.suspend) await tx.delete(schema.session).where(eq(schema.session.userId, userId));
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: input.suspend ? "admin.user.suspend" : "admin.user.unsuspend",
        targetType: "user",
        targetId: userId,
        before: { banned: before.banned },
        after: { banned: input.suspend },
        reason: input.reason,
      });
    });
  }

  /** Soft delete: locks the account and starts the 30-day grace the worker purges after. */
  async deleteUser(p: AdminPrincipal, userId: string, reason: string) {
    requirePermission(p, "users.write");
    if (!reason?.trim()) throw new ApiError(400, "bad_request", "A reason is required.");
    const before = await this.deps.db.query.user.findFirst({ where: eq(schema.user.id, userId) });
    if (!before) throw new ApiError(404, "not_found", "User not found.");
    await this.deps.db.transaction(async (tx) => {
      await tx
        .update(schema.user)
        .set({ banned: true, banReason: "self_delete", banExpires: new Date() })
        .where(eq(schema.user.id, userId));
      await tx.delete(schema.session).where(eq(schema.session.userId, userId));
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "admin.user.delete",
        targetType: "user",
        targetId: userId,
        before: { email: before.email },
        after: { deletedAt: new Date().toISOString() },
        reason,
      });
    });
  }

  async revokeSessions(p: AdminPrincipal, userId: string) {
    requirePermission(p, "users.write");
    const ended = await this.deps.db.transaction(async (tx) => {
      const rows = await tx
        .delete(schema.session)
        .where(eq(schema.session.userId, userId))
        .returning({ id: schema.session.id });
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "admin.user.revoke_sessions",
        targetType: "user",
        targetId: userId,
      });
      return rows.map((r) => r.id);
    });
    await this.deps.revocations.revoke(ended);
  }

  // ---- credits and limits --------------------------------------------------

  async grantCredits(
    p: AdminPrincipal,
    orgId: string,
    input: { readonly credits: number; readonly reason: string },
  ) {
    requirePermission(p, "credits.grant");
    if (!Number.isInteger(input.credits) || input.credits <= 0 || input.credits > 1_000_000)
      throw new ApiError(400, "bad_request", "credits must be a positive whole number.");
    if (!input.reason?.trim()) throw new ApiError(400, "bad_request", "A reason is required.");
    const amount: Microcredits = creditsToMicro(input.credits);
    if (p.role === "employee") {
      const admin = await this.deps.db.query.admins.findFirst({
        where: eq(schema.admins.id, p.adminId),
      });
      const cap = admin?.creditGrantCapMicro
        ? BigInt(admin.creditGrantCapMicro)
        : EMPLOYEE_GRANT_CAP;
      if (amount > cap)
        throw new ApiError(
          403,
          "grant_cap",
          `Employee grants are capped at ${formatCredits(cap)} credits.`,
        );
    }
    const balances = await this.deps.ledger.grant({
      orgId,
      bucket: "topup",
      type: "admin_grant",
      amount,
      idempotencyKey: `admin:${p.adminId}:${orgId}:${crypto.randomUUID()}`,
      actor: `admin:${p.adminId}`,
      reason: input.reason,
    });
    await writeAudit(this.deps.db, {
      actorType: "admin",
      actorId: p.adminId,
      action: "credits.grant",
      targetType: "org",
      targetId: orgId,
      after: { credits: input.credits },
      reason: input.reason,
    });
    return balances;
  }

  /**
   * Clears rate limits, concurrency holds, abuse flags, and both usage windows.
   * Never moves credits or banked resets (decision: Reset).
   */
  async resetLimits(p: AdminPrincipal, userId: string, reason: string | null) {
    requirePermission(p, "limits.reset");
    const orgIds = (
      await this.deps.db.query.member.findMany({ where: eq(schema.member.userId, userId) })
    ).map((m) => m.organizationId);
    let cleared = await this.deps.limiter.reset(`user:${userId}`);
    for (const orgId of orgIds) cleared += await this.deps.limiter.reset(`org:${orgId}`);
    await this.deps.db.transaction(async (tx) => {
      await tx
        .update(schema.abuseFlags)
        .set({ resolvedAt: new Date(), resolvedBy: p.adminId })
        .where(
          and(eq(schema.abuseFlags.userId, userId), sql`${schema.abuseFlags.resolvedAt} IS NULL`),
        );
      await resetWindows(tx, userId, new Date(), { newWeek: false });
      await tx.insert(schema.usageWindowEvents).values({
        userId,
        kind: "admin_reset",
        actor: `admin:${p.adminId}`,
        reason,
      });
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "admin.user.reset_limits",
        targetType: "user",
        targetId: userId,
        after: { clearedKeys: cleared },
        reason,
      });
    });
    await this.deps.resumeRuns?.(userId);
    return { cleared };
  }

  // ---- stats ---------------------------------------------------------------

  async stats(p: AdminPrincipal, range: "day" | "week" | "month" | "year") {
    requirePermission(p, "stats.read");
    const days = range === "day" ? 1 : range === "week" ? 7 : range === "month" ? 30 : 365;
    const since = new Date(Date.now() - days * 86_400_000);
    const sinceIso = since.toISOString();
    const [totals] = await this.deps.db.execute<{ users: number; orgs: number; paid: number }>(sql`
      SELECT (SELECT count(*)::int FROM "user") AS users,
             (SELECT count(*)::int FROM organization) AS orgs,
             (SELECT count(DISTINCT org_id)::int FROM subscriptions WHERE status = 'active') AS paid`);
    const signups = await this.deps.db.execute<{ day: string; n: number }>(sql`
      SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS n FROM "user"
      WHERE created_at >= ${sinceIso}::timestamptz GROUP BY 1 ORDER BY 1`);
    const usage = await this.deps.db.execute<{
      day: string;
      requests: number;
      settled: string;
      active: number;
    }>(sql`
      SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS requests, coalesce(sum(settled_micro),0)::text AS settled, count(DISTINCT user_id)::int AS active
      FROM usage_requests WHERE created_at >= ${sinceIso}::timestamptz AND status IN ('settled','cut_off') GROUP BY 1 ORDER BY 1`);
    const revenue = await this.deps.db.execute<{ day: string; cents: number }>(sql`
      SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, coalesce(sum(amount_paid_usd_cents),0)::int AS cents FROM invoices
      WHERE created_at >= ${sinceIso}::timestamptz GROUP BY 1 ORDER BY 1`);
    const byCountry = await this.deps.db.execute<{ country: string; signups: number }>(sql`
      SELECT country, sum(signups)::int AS signups FROM daily_stats WHERE country <> '*' AND day >= ${sinceIso.slice(0, 10)} GROUP BY 1 ORDER BY 2 DESC LIMIT 25`);
    // Previous period of equal length, for "from last period" deltas on the tiles.
    const prevSinceIso = new Date(since.getTime() - days * 86_400_000).toISOString();
    const [previous] = await this.deps.db.execute<{
      signups: number;
      requests: number;
      active: number;
      cents: number;
    }>(sql`
      SELECT (SELECT count(*)::int FROM "user" WHERE created_at >= ${prevSinceIso}::timestamptz AND created_at < ${sinceIso}::timestamptz) AS signups,
             (SELECT count(*)::int FROM usage_requests WHERE created_at >= ${prevSinceIso}::timestamptz AND created_at < ${sinceIso}::timestamptz AND status IN ('settled','cut_off')) AS requests,
             (SELECT count(DISTINCT user_id)::int FROM usage_requests WHERE created_at >= ${prevSinceIso}::timestamptz AND created_at < ${sinceIso}::timestamptz) AS active,
             (SELECT coalesce(sum(amount_paid_usd_cents),0)::int FROM invoices WHERE created_at >= ${prevSinceIso}::timestamptz AND created_at < ${sinceIso}::timestamptz) AS cents`);
    // Organizations by plan: active subscriptions per tier; everyone else is on trial.
    const byPlan = await this.deps.db.execute<{ plan_id: string; orgs: number }>(sql`
      SELECT plan_id::text AS plan_id, count(DISTINCT org_id)::int AS orgs FROM subscriptions WHERE status = 'active' GROUP BY 1`);
    const byModel = await this.deps.db.execute<{
      model_id: string;
      requests: number;
      settled: string;
    }>(sql`
      SELECT model_id, count(*)::int AS requests, coalesce(sum(settled_micro),0)::text AS settled FROM usage_requests
      WHERE created_at >= ${sinceIso}::timestamptz AND status IN ('settled','cut_off') GROUP BY 1 ORDER BY 3 DESC LIMIT 25`);
    const paidOrgs = byPlan.reduce((a, r) => a + r.orgs, 0);
    return {
      range,
      since: sinceIso,
      totals: totals ?? { users: 0, orgs: 0, paid: 0 },
      previous: previous ?? { signups: 0, requests: 0, active: 0, cents: 0 },
      byPlan: [
        ...byPlan.map((r) => ({ planId: r.plan_id, orgs: r.orgs })),
        { planId: "trial", orgs: Math.max(0, (totals?.orgs ?? 0) - paidOrgs) },
      ],
      signups: [...signups],
      usage: [...usage],
      revenue: [...revenue],
      byCountry: [...byCountry],
      byModel: [...byModel],
    };
  }

  // ---- catalog, plans, settings, kill switches -----------------------------

  async listModels(p: AdminPrincipal) {
    requirePermission(p, "stats.read");
    return this.deps.db.query.modelCatalog.findMany({ orderBy: [schema.modelCatalog.sortOrder] });
  }

  async updateModel(
    p: AdminPrincipal,
    modelId: string,
    patch: Record<string, unknown>,
    reason: string | null,
  ) {
    requirePermission(p, "catalog.write");
    const before = await this.deps.db.query.modelCatalog.findFirst({
      where: eq(schema.modelCatalog.modelId, modelId),
    });
    if (!before) throw new ApiError(404, "not_found", "Model not found.");
    const allowed = [
      "displayName",
      "status",
      "qualityScore",
      "sortOrder",
      "inputMicroPerToken",
      "outputMicroPerToken",
      "cachedInputMicroPerToken",
      "microPerImage",
      "microPerRequest",
      "region",
      "contextWindow",
      "maxOutputTokens",
      "capabilities",
      "upstreamModelId",
      "freeEligible",
    ] as const;
    const set: Record<string, unknown> = {};
    for (const key of allowed)
      if (key in patch)
        set[key] =
          key.startsWith("micro") || key.endsWith("PerToken")
            ? BigInt(String(patch[key]))
            : patch[key];
    if (Object.keys(set).length === 0) throw new ApiError(400, "bad_request", "Nothing to update.");
    await this.deps.db.transaction(async (tx) => {
      await tx.update(schema.modelCatalog).set(set).where(eq(schema.modelCatalog.modelId, modelId));
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "admin.model.update",
        targetType: "model",
        targetId: modelId,
        before: pick(before, Object.keys(set)),
        after: set,
        reason,
      });
    });
    this.deps.gateway.invalidateCatalog();
  }

  async listPlans(p: AdminPrincipal) {
    requirePermission(p, "stats.read");
    return this.deps.db.query.plans.findMany();
  }

  async updatePlan(
    p: AdminPrincipal,
    planId: string,
    patch: Record<string, unknown>,
    reason: string | null,
  ) {
    requirePermission(p, "plans.write");
    const before = await this.deps.db.query.plans.findFirst({
      where: eq(schema.plans.id, planId as never),
    });
    if (!before) throw new ApiError(404, "not_found", "Plan not found.");
    const allowed = [
      "name",
      "monthlyPriceUsdCents",
      "annualPriceUsdCents",
      "includedMicrocredits",
      "concurrentStreams",
      "requestsPerMinute",
      "priorityWeight",
      "syncQuotaBytes",
      "requiresOwner2fa",
      "stripeMonthlyPriceId",
      "stripeAnnualPriceId",
      "active",
      "window5hMicro",
      "windowWeekMicro",
    ] as const;
    const bigints = new Set<string>([
      "includedMicrocredits",
      "syncQuotaBytes",
      "window5hMicro",
      "windowWeekMicro",
    ]);
    const set: Record<string, unknown> = {};
    for (const key of allowed)
      if (key in patch) set[key] = bigints.has(key) ? BigInt(String(patch[key])) : patch[key];
    if (Object.keys(set).length === 0) throw new ApiError(400, "bad_request", "Nothing to update.");
    await this.deps.db.transaction(async (tx) => {
      await tx
        .update(schema.plans)
        .set(set)
        .where(eq(schema.plans.id, planId as never));
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "admin.plan.update",
        targetType: "plan",
        targetId: planId,
        before: pick(before, Object.keys(set)),
        after: set,
        reason,
      });
    });
  }

  async getSettings(p: AdminPrincipal) {
    requirePermission(p, "stats.read");
    return this.deps.db.query.settings.findMany();
  }

  async putSetting(p: AdminPrincipal, key: string, value: unknown, reason: string | null) {
    requirePermission(p, "settings.write");
    if (!/^[a-z0-9_.]{3,64}$/.test(key)) throw new ApiError(400, "bad_request", "Bad setting key.");
    const before = await this.deps.db.query.settings.findFirst({
      where: eq(schema.settings.key, key),
    });
    await this.deps.db.transaction(async (tx) => {
      await tx
        .insert(schema.settings)
        .values({ key, value, updatedBy: p.adminId })
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: { value, updatedBy: p.adminId, updatedAt: new Date() },
        });
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "admin.setting.put",
        targetType: "setting",
        targetId: key,
        before: before?.value ?? null,
        after: value,
        reason,
      });
    });
  }

  async killSwitches(p: AdminPrincipal) {
    requirePermission(p, "stats.read");
    return this.deps.db.query.killSwitches.findMany();
  }

  async setKillSwitch(
    p: AdminPrincipal,
    name: "gateway" | "billing" | "sync",
    engaged: boolean,
    reason: string,
  ) {
    requirePermission(p, "killswitch.write");
    if (!reason?.trim()) throw new ApiError(400, "bad_request", "A reason is required.");
    const before = await this.deps.db.query.killSwitches.findFirst({
      where: eq(schema.killSwitches.name, name),
    });
    await this.deps.db.transaction(async (tx) => {
      await tx
        .insert(schema.killSwitches)
        .values({ name, engaged, reason, changedBy: p.adminId, changedAt: new Date() })
        .onConflictDoUpdate({
          target: schema.killSwitches.name,
          set: { engaged, reason, changedBy: p.adminId, changedAt: new Date() },
        });
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: `killswitch.${name}.${engaged ? "on" : "off"}`,
        targetType: "killswitch",
        targetId: name,
        before: { engaged: before?.engaged ?? false },
        after: { engaged },
        reason,
      });
    });
  }

  // ---- audit, trials, admins ----------------------------------------------

  async audit(
    p: AdminPrincipal,
    input: {
      readonly targetId?: string;
      readonly actorId?: string;
      readonly action?: string;
      readonly limit?: number;
      readonly before?: string;
    },
  ) {
    requirePermission(p, "audit.read");
    const conditions = [];
    if (input.targetId) conditions.push(eq(schema.auditEvents.targetId, input.targetId));
    if (input.actorId) conditions.push(eq(schema.auditEvents.actorId, input.actorId));
    if (input.action) conditions.push(ilike(schema.auditEvents.action, `${input.action}%`));
    if (input.before) conditions.push(lte(schema.auditEvents.createdAt, new Date(input.before)));
    return this.deps.db.query.auditEvents.findMany({
      where: conditions.length ? and(...conditions) : undefined,
      orderBy: [desc(schema.auditEvents.createdAt)],
      limit: Math.min(Math.max(input.limit ?? 50, 1), 200),
    });
  }

  async trialQueue(p: AdminPrincipal) {
    requirePermission(p, "trials.review");
    return this.deps.db.query.trialGrants.findMany({
      where: eq(schema.trialGrants.status, "queued_for_review"),
      orderBy: [schema.trialGrants.createdAt],
      limit: 200,
    });
  }

  async approveTrial(p: AdminPrincipal, trialId: string) {
    requirePermission(p, "trials.review");
    const ok = await this.deps.trial.approve(trialId, p.adminId);
    if (!ok) throw new ApiError(409, "not_queued", "That trial is not waiting for review.");
  }

  // ---- team (admin only) ---------------------------------------------------

  private teamRow(a: typeof schema.admins.$inferSelect) {
    return {
      id: a.id,
      email: a.email,
      name: a.name,
      role: a.role,
      status: a.disabled
        ? ("disabled" as const)
        : a.passwordHash
          ? ("active" as const)
          : ("invited" as const),
      emailVerifiedAt: a.emailVerifiedAt,
      totpEnabled: a.totpEnabled,
      lastLoginAt: a.lastLoginAt,
      lastLoginIp: a.lastLoginIp,
      createdAt: a.createdAt,
      invitedBy: a.invitedBy,
    };
  }

  private async liveAdmin(adminId: string) {
    const row = await this.deps.db.query.admins.findFirst({
      where: and(eq(schema.admins.id, adminId), isNull(schema.admins.deletedAt)),
    });
    if (!row) throw new ApiError(404, "not_found", "No such team member.");
    return row;
  }

  /** Refuse any change that would leave the platform without an active admin. */
  private async assertNotLastAdmin(adminId: string) {
    const [row] = await this.deps.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.admins)
      .where(
        and(
          eq(schema.admins.role, "admin"),
          eq(schema.admins.disabled, false),
          isNull(schema.admins.deletedAt),
          sql`${schema.admins.passwordHash} is not null`,
          sql`${schema.admins.id} <> ${adminId}`,
        ),
      );
    if ((row?.n ?? 0) === 0)
      throw new ApiError(409, "last_admin", "There must always be at least one active admin.");
  }

  async listAdmins(p: AdminPrincipal) {
    requirePermission(p, "admins.write");
    const rows = await this.deps.db.query.admins.findMany({
      where: isNull(schema.admins.deletedAt),
      orderBy: [schema.admins.createdAt],
    });
    return rows.map((a) => this.teamRow(a));
  }

  async inviteAdmin(
    p: AdminPrincipal,
    input: {
      readonly email: unknown;
      readonly name: unknown;
      readonly role: unknown;
      readonly reason: unknown;
    },
  ) {
    requirePermission(p, "admins.write");
    const reason = needReason(input.reason);
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!EMAIL.test(email) || email.length > 254)
      throw new ApiError(400, "bad_request", "Enter a valid email address.");
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 1 || name.length > 80)
      throw new ApiError(400, "bad_request", "Name must be 1 to 80 characters.");
    if (!isRole(input.role))
      throw new ApiError(400, "bad_request", "Role must be admin or employee.");
    const existing = await this.deps.db.query.admins.findFirst({
      where: and(eq(schema.admins.email, email), isNull(schema.admins.deletedAt)),
    });
    if (existing)
      throw new ApiError(409, "email_in_use", "A team member with that email already exists.");
    const [row] = await this.deps.db
      .insert(schema.admins)
      .values({ email, name, role: input.role, invitedBy: p.adminId })
      .returning();
    const token = await this.deps.auth.issueInvite(row!.id, p.adminId);
    await this.deps.email.send(
      adminInvite(
        email,
        p.email,
        `${this.deps.adminPublicUrl.replace(/\/+$/, "")}/invite?token=${token}`,
        "en",
      ),
    );
    await writeAudit(this.deps.db, {
      actorType: "admin",
      actorId: p.adminId,
      action: "admin.admin.invite",
      targetType: "admin",
      targetId: row!.id,
      after: { email, name, role: input.role },
      reason,
    });
    return this.teamRow(row!);
  }

  async resendInvite(p: AdminPrincipal, adminId: string, reason: unknown) {
    requirePermission(p, "admins.write");
    const why = needReason(reason);
    const row = await this.liveAdmin(adminId);
    if (row.passwordHash || row.disabled)
      throw new ApiError(409, "not_pending", "That team member has already joined.");
    const token = await this.deps.auth.issueInvite(row.id, p.adminId);
    await this.deps.email.send(
      adminInvite(
        row.email,
        p.email,
        `${this.deps.adminPublicUrl.replace(/\/+$/, "")}/invite?token=${token}`,
        "en",
      ),
    );
    await writeAudit(this.deps.db, {
      actorType: "admin",
      actorId: p.adminId,
      action: "admin.admin.invite",
      targetType: "admin",
      targetId: row.id,
      after: { resend: true },
      reason: why,
    });
  }

  async updateAdmin(
    p: AdminPrincipal,
    adminId: string,
    patch: { readonly name?: unknown; readonly role?: unknown; readonly reason: unknown },
  ) {
    requirePermission(p, "admins.write");
    const reason = needReason(patch.reason);
    const row = await this.liveAdmin(adminId);
    const set: { name?: string; role?: AdminRole } = {};
    if (patch.name !== undefined) {
      const name = typeof patch.name === "string" ? patch.name.trim() : "";
      if (name.length < 1 || name.length > 80)
        throw new ApiError(400, "bad_request", "Name must be 1 to 80 characters.");
      set.name = name;
    }
    if (patch.role !== undefined) {
      if (!isRole(patch.role))
        throw new ApiError(400, "bad_request", "Role must be admin or employee.");
      if (patch.role !== row.role) {
        if (adminId === p.adminId)
          throw new ApiError(400, "bad_request", "You cannot change your own role.");
        if (row.role === "admin") await this.assertNotLastAdmin(adminId);
        set.role = patch.role;
      }
    }
    if (Object.keys(set).length === 0) return this.teamRow(row);
    await this.deps.db.transaction(async (tx) => {
      await tx.update(schema.admins).set(set).where(eq(schema.admins.id, adminId));
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "admin.admin.update",
        targetType: "admin",
        targetId: adminId,
        before: pick(row, Object.keys(set)),
        after: set,
        reason,
      });
    });
    // A role change must not leave a session running with the old permissions.
    if (set.role) await this.deps.auth.revokeSessions(adminId);
    return this.teamRow({ ...row, ...set });
  }

  async setAdminDisabled(p: AdminPrincipal, adminId: string, disabled: boolean, reason: string) {
    requirePermission(p, "admins.write");
    needReason(reason);
    if (adminId === p.adminId)
      throw new ApiError(400, "bad_request", "You cannot disable yourself.");
    const row = await this.liveAdmin(adminId);
    if (disabled && row.role === "admin") await this.assertNotLastAdmin(adminId);
    await this.deps.db.transaction(async (tx) => {
      await tx.update(schema.admins).set({ disabled }).where(eq(schema.admins.id, adminId));
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: disabled ? "admin.admin.disable" : "admin.admin.enable",
        targetType: "admin",
        targetId: adminId,
        reason,
      });
    });
    if (disabled) await this.deps.auth.revokeSessions(adminId);
  }

  async revokeAdminSessions(p: AdminPrincipal, adminId: string, reason: unknown) {
    requirePermission(p, "admins.write");
    const why = needReason(reason);
    await this.liveAdmin(adminId);
    await this.deps.auth.revokeSessions(adminId, adminId === p.adminId ? p.sessionId : undefined);
    await writeAudit(this.deps.db, {
      actorType: "admin",
      actorId: p.adminId,
      action: "admin.admin.revoke_sessions",
      targetType: "admin",
      targetId: adminId,
      reason: why,
    });
  }

  /** Soft delete: the row stays for the audit trail, every credential and session dies. */
  async deleteAdmin(p: AdminPrincipal, adminId: string, reason: unknown) {
    requirePermission(p, "admins.write");
    const why = needReason(reason);
    if (adminId === p.adminId)
      throw new ApiError(400, "bad_request", "You cannot delete yourself.");
    const row = await this.liveAdmin(adminId);
    if (row.role === "admin" && !row.disabled && row.passwordHash)
      await this.assertNotLastAdmin(adminId);
    await this.deps.db.transaction(async (tx) => {
      await tx
        .update(schema.admins)
        .set({
          deletedAt: new Date(),
          disabled: true,
          passwordHash: null,
          totpSecretEncrypted: null,
          totpEnabled: false,
          passkeyCredentials: null,
        })
        .where(eq(schema.admins.id, adminId));
      await tx
        .update(schema.adminInvites)
        .set({ expiresAt: new Date() })
        .where(eq(schema.adminInvites.adminId, adminId));
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "admin.admin.delete",
        targetType: "admin",
        targetId: adminId,
        before: { email: row.email, name: row.name, role: row.role },
        reason: why,
      });
    });
    await this.deps.auth.revokeSessions(adminId);
  }

  async loginEvents(
    p: AdminPrincipal,
    input: { readonly adminId?: string; readonly ip?: string; readonly limit?: number },
  ) {
    requirePermission(p, "admins.write");
    const conditions = [];
    if (input.adminId) conditions.push(eq(schema.adminLoginEvents.adminId, input.adminId));
    if (input.ip) conditions.push(eq(schema.adminLoginEvents.ip, input.ip));
    return this.deps.db.query.adminLoginEvents.findMany({
      where: conditions.length ? and(...conditions) : undefined,
      orderBy: [desc(schema.adminLoginEvents.createdAt)],
      limit: Math.min(Math.max(input.limit ?? 50, 1), 200),
    });
  }

  async ipBans(p: AdminPrincipal): Promise<readonly string[]> {
    requirePermission(p, "admins.write");
    const row = await this.deps.db.query.settings.findFirst({
      where: eq(schema.settings.key, "admin.ip_blocklist"),
    });
    return Array.isArray(row?.value) ? (row!.value as string[]) : [];
  }

  async setIpBan(p: AdminPrincipal, ip: unknown, banned: boolean, reason: unknown) {
    requirePermission(p, "admins.write");
    const why = needReason(reason);
    const entry = typeof ip === "string" ? ip.trim() : "";
    if (!isIpOrCidr(entry))
      throw new ApiError(400, "bad_request", "Enter an IP address or IPv4 CIDR.");
    const current = await this.ipBans(p);
    const next = banned
      ? current.includes(entry)
        ? current
        : [...current, entry]
      : current.filter((e) => e !== entry);
    await this.deps.db.transaction(async (tx) => {
      await tx
        .insert(schema.settings)
        .values({ key: "admin.ip_blocklist", value: next, updatedBy: p.adminId })
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: { value: next, updatedBy: p.adminId, updatedAt: new Date() },
        });
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: banned ? "admin.ip.ban" : "admin.ip.unban",
        targetType: "ip",
        targetId: entry,
        before: current,
        after: next,
        reason: why,
      });
    });
    if (banned && !entry.includes("/")) await this.deps.auth.revokeSessionsFromIp(entry);
    return next;
  }

  async serverStatus(
    p: AdminPrincipal,
    extra: { readonly inFlight: number; readonly breakers: Record<string, string> },
  ) {
    requirePermission(p, "stats.read");
    const [queue] = await this.deps.db.execute<{ pending: number }>(
      sql`SELECT count(*)::int AS pending FROM credit_ledger r WHERE r.type='reservation' AND NOT EXISTS (SELECT 1 FROM credit_ledger s WHERE s.reservation_id = r.reservation_id AND s.type IN ('settlement','release'))`,
    );
    return {
      version: this.deps.version,
      inFlight: extra.inFlight,
      breakers: extra.breakers,
      openReservations: queue?.pending ?? 0,
      since: new Date(Date.now() - 86_400_000).toISOString(),
    };
  }
}

function pick(obj: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

// Permission names referenced above but not in support/finance sets resolve to owner-only.
void gte;
