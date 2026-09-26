/**
 * Admin control of usage windows and banked resets: a user's windows and
 * bank history, per-user grants and revokes, "reset everyone", per-plan
 * grant schedules, and bulk grants (queued here, run by the worker's
 * usage.bulkGrant job). Every mutation is audited in its own transaction.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { bankExpiresAt, DEFAULT_PLANS, type PlanId } from "@djl/domain";
import type { TeamAlertSender } from "@djl/notify";

import { requirePermission, type AdminPrincipal } from "../admin/AdminAuth.ts";
import { writeAudit } from "../audit/AuditLog.ts";
import { PERSONAL_ORG_METADATA } from "../auth/auth.ts";
import { ApiError } from "../http/errors.ts";
import type { UsageService } from "./UsageService.ts";
import { GLOBAL_FLOOR_KEY } from "./windowStore.ts";

const { resetBanks, resetGrantBatches, planResetSchedules, usageWindowEvents } = schema;

export interface UsageAdminDeps {
  readonly db: DjlDatabase;
  readonly usage: UsageService;
  readonly alerts?: TeamAlertSender | undefined;
}

const MAX_BANKS_PER_GRANT = 10;
const PLAN_IDS = new Set<string>(DEFAULT_PLANS.map((p) => p.id));

const needReason = (reason: unknown): string => {
  if (typeof reason !== "string" || !reason.trim())
    throw new ApiError(400, "bad_request", "A reason is required.");
  return reason.trim();
};
const wholeNumber = (value: unknown, min: number, max: number, label: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new ApiError(
      400,
      "bad_request",
      `${label} must be a whole number from ${min} to ${max}.`,
    );
  return value;
};
const planId = (value: unknown): PlanId => {
  if (typeof value !== "string" || !PLAN_IDS.has(value))
    throw new ApiError(400, "bad_request", "Unknown plan.");
  return value as PlanId;
};

export class UsageAdminService {
  constructor(private readonly deps: UsageAdminDeps) {}

  /** Both windows (on the user's personal org plan), every bank, and recent window events. */
  async userUsage(p: AdminPrincipal, userId: string) {
    requirePermission(p, "users.read");
    const [personal] = await this.deps.db
      .select({ orgId: schema.member.organizationId })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(
        and(
          eq(schema.member.userId, userId),
          eq(schema.organization.metadata, PERSONAL_ORG_METADATA),
        ),
      );
    if (!personal) throw new ApiError(404, "not_found", "User not found.");
    const [view, banks, events] = await Promise.all([
      this.deps.usage.windows(userId, personal.orgId),
      this.deps.db.query.resetBanks.findMany({
        where: eq(resetBanks.userId, userId),
        orderBy: [desc(resetBanks.grantedAt)],
        limit: 50,
      }),
      this.deps.db.query.usageWindowEvents.findMany({
        where: eq(usageWindowEvents.userId, userId),
        orderBy: [desc(usageWindowEvents.createdAt)],
        limit: 50,
      }),
    ]);
    return { planId: view.planId, windows: view.windows, banks, events };
  }

  async grantBanks(
    p: AdminPrincipal,
    userId: string,
    input: { readonly count: unknown; readonly reason: unknown },
  ) {
    requirePermission(p, "credits.grant");
    const count = wholeNumber(input.count, 1, MAX_BANKS_PER_GRANT, "count");
    const reason = needReason(input.reason);
    const now = new Date();
    return this.deps.db.transaction(async (tx) => {
      const granted = await tx
        .insert(resetBanks)
        .values(
          Array.from({ length: count }, () => ({
            userId,
            source: "admin" as const,
            grantedBy: `admin:${p.adminId}`,
            reason,
            grantedAt: now,
            expiresAt: bankExpiresAt(now),
            idempotencyKey: `admin:${crypto.randomUUID()}`,
          })),
        )
        .returning();
      await tx.insert(usageWindowEvents).values(
        granted.map((bank) => ({
          userId,
          kind: "bank_granted" as const,
          bankId: bank.id,
          actor: `admin:${p.adminId}`,
          reason,
        })),
      );
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "usage.banks.grant",
        targetType: "user",
        targetId: userId,
        after: { count, bankIds: granted.map((b) => b.id) },
        reason,
      });
      return granted;
    });
  }

  /** Revoke a bank that is neither redeemed nor already revoked. */
  async revokeBank(p: AdminPrincipal, bankId: string, reasonInput: unknown) {
    requirePermission(p, "credits.grant");
    const reason = needReason(reasonInput);
    await this.deps.db.transaction(async (tx) => {
      const [bank] = await tx
        .update(resetBanks)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(resetBanks.id, bankId),
            isNull(resetBanks.redeemedAt),
            isNull(resetBanks.revokedAt),
          ),
        )
        .returning();
      if (!bank)
        throw new ApiError(409, "bank_not_revocable", "That bank was already used or revoked.");
      await tx.insert(usageWindowEvents).values({
        userId: bank.userId,
        kind: "bank_revoked",
        bankId,
        actor: `admin:${p.adminId}`,
        reason,
      });
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "usage.banks.revoke",
        targetType: "reset_bank",
        targetId: bankId,
        after: { userId: bank.userId },
        reason,
      });
    });
  }

  /**
   * Zero every user's windows at once by moving the global floor to now.
   * O(1) for any number of users; credits and banks are untouched.
   */
  async resetAll(
    p: AdminPrincipal,
    input: { readonly confirm: unknown; readonly reason: unknown },
  ) {
    requirePermission(p, "usage.reset_all");
    if (input.confirm !== "RESET")
      throw new ApiError(400, "confirm_required", "Type RESET to confirm resetting everyone.");
    const reason = needReason(input.reason);
    const floor = new Date().toISOString();
    await this.deps.db.transaction(async (tx) => {
      const before = await tx.query.settings.findFirst({
        where: eq(schema.settings.key, GLOBAL_FLOOR_KEY),
      });
      await tx
        .insert(schema.settings)
        .values({ key: GLOBAL_FLOOR_KEY, value: floor, updatedBy: p.adminId })
        .onConflictDoUpdate({
          target: schema.settings.key,
          set: { value: floor, updatedBy: p.adminId, updatedAt: new Date() },
        });
      await tx.insert(usageWindowEvents).values({
        kind: "reset_all",
        actor: `admin:${p.adminId}`,
        reason,
        details: { floor },
      });
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "usage.reset_all",
        targetType: "setting",
        targetId: GLOBAL_FLOOR_KEY,
        before: before?.value ?? null,
        after: floor,
        reason,
      });
    });
    await this.deps.alerts?.post({
      severity: "warn",
      title: "Usage windows reset for everyone",
      body: `admin ${p.adminId}: ${reason}`,
    });
    return { floor };
  }

  async schedules(p: AdminPrincipal) {
    requirePermission(p, "stats.read");
    return this.deps.db.query.planResetSchedules.findMany();
  }

  /** Create or change a plan's automatic grant; the hourly job grants once per period. */
  async putSchedule(
    p: AdminPrincipal,
    planInput: unknown,
    input: {
      readonly everyDays: unknown;
      readonly banksPerGrant: unknown;
      readonly active: unknown;
    },
    reasonInput: unknown,
  ) {
    requirePermission(p, "plans.write");
    const plan = planId(planInput);
    const values = {
      everyDays: wholeNumber(input.everyDays, 1, 365, "everyDays"),
      banksPerGrant: wholeNumber(input.banksPerGrant, 1, MAX_BANKS_PER_GRANT, "banksPerGrant"),
      active: input.active === true,
    };
    const reason = needReason(reasonInput);
    await this.deps.db.transaction(async (tx) => {
      const before = await tx.query.planResetSchedules.findFirst({
        where: eq(planResetSchedules.planId, plan),
      });
      await tx
        .insert(planResetSchedules)
        .values({ planId: plan, ...values, updatedBy: p.adminId })
        .onConflictDoUpdate({
          target: planResetSchedules.planId,
          set: { ...values, updatedBy: p.adminId },
        });
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "usage.schedule.put",
        targetType: "plan",
        targetId: plan,
        before: before
          ? {
              everyDays: before.everyDays,
              banksPerGrant: before.banksPerGrant,
              active: before.active,
            }
          : null,
        after: values,
        reason,
      });
    });
  }

  /**
   * Queue one bank for every user (or every user on `planId`). The worker's
   * usage.bulkGrant job runs it; the same idempotency key queues it once.
   */
  async createBulkGrant(
    p: AdminPrincipal,
    input: { readonly planId: unknown; readonly reason: unknown; readonly idempotencyKey: unknown },
  ) {
    requirePermission(p, "usage.bulk_grant");
    const plan = input.planId === null || input.planId === undefined ? null : planId(input.planId);
    const reason = needReason(input.reason);
    if (typeof input.idempotencyKey !== "string" || !/^[\w-]{1,128}$/.test(input.idempotencyKey))
      throw new ApiError(
        400,
        "bad_request",
        "idempotencyKey must be 1 to 128 letters, digits, - or _.",
      );
    const idempotencyKey = `bulk:${input.idempotencyKey}`;
    return this.deps.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(resetGrantBatches)
        .values({
          source: "bulk",
          planId: plan,
          actor: `admin:${p.adminId}`,
          reason,
          idempotencyKey,
        })
        .onConflictDoNothing({ target: resetGrantBatches.idempotencyKey })
        .returning();
      if (!created) {
        const existing = await tx.query.resetGrantBatches.findFirst({
          where: eq(resetGrantBatches.idempotencyKey, idempotencyKey),
        });
        return existing!;
      }
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "usage.bulk_grant",
        targetType: "reset_grant_batch",
        targetId: created.id,
        after: { planId: plan },
        reason,
      });
      return created;
    });
  }

  async batches(p: AdminPrincipal) {
    requirePermission(p, "stats.read");
    return this.deps.db.query.resetGrantBatches.findMany({
      orderBy: [desc(resetGrantBatches.createdAt)],
      limit: 50,
    });
  }
}
