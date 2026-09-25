/**
 * Trial credits. The flow:
 *   1. claim(): after phone verification, evaluate fraud rules and record a
 *      trial_grants row as pending_first_request, queued_for_review, or rejected.
 *   2. onFirstCloudRequest(): the gateway calls this after the first settled
 *      request; a pending row becomes granted and the ledger receives the credits.
 *   3. approve(): an admin releases a queued row.
 * The phone hash is unique for all time, so one phone gets one trial ever.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import {
  creditsToMicro,
  evaluateTrialEligibility,
  TRIAL_CREDIT_EXPIRY_DAYS,
  type PhoneLineType,
} from "@djl/domain";

import { writeAudit } from "../audit/AuditLog.ts";
import type { LedgerService } from "../credits/LedgerService.ts";
import { ApiError } from "../http/errors.ts";

export interface TrialConfig {
  readonly credits: number; // whole credits
  readonly expiryDays: number;
  readonly dailyBudgetUsdCents: number;
  readonly hashSalt: string;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class TrialService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly ledger: LedgerService,
    private readonly lookup: { readonly lookupLineType: (phone: string) => Promise<PhoneLineType> },
    private readonly config: TrialConfig,
  ) {}

  private async loadConfig(): Promise<TrialConfig> {
    const rows = await this.db.query.settings.findMany();
    const get = (key: string) => rows.find((r) => r.key === key)?.value;
    return {
      credits: Number(get("trial.credits") ?? this.config.credits),
      expiryDays: Number(get("trial.expiry_days") ?? this.config.expiryDays),
      dailyBudgetUsdCents: Number(
        get("trial.daily_budget_usd_cents") ?? this.config.dailyBudgetUsdCents,
      ),
      hashSalt: this.config.hashSalt,
    };
  }

  async status(orgId: string) {
    return this.db.query.trialGrants.findFirst({ where: eq(schema.trialGrants.orgId, orgId) });
  }

  async claim(input: {
    readonly orgId: string;
    readonly userId: string;
    readonly phoneNumber: string | null;
    readonly phoneVerified: boolean;
    readonly deviceFingerprint: string | null;
    readonly ip: string | null;
    readonly suspended: boolean;
  }) {
    const cfg = await this.loadConfig();
    const existing = await this.status(input.orgId);
    if (existing) return existing;
    if (!input.phoneNumber || !input.phoneVerified)
      throw new ApiError(400, "phone_required", "Verify a mobile phone number first.");

    const phoneHash = await sha256Hex(`${cfg.hashSalt}:${input.phoneNumber}`);
    const ipHash = input.ip ? await sha256Hex(`${cfg.hashSalt}:${input.ip}`) : null;
    const lineType = await this.lookup.lookupLineType(input.phoneNumber);
    const since = new Date(Date.now() - 86_400_000);
    const [phoneUsed, byDevice, byIp, budget] = await Promise.all([
      this.db.query.trialGrants.findFirst({ where: eq(schema.trialGrants.phoneHash, phoneHash) }),
      input.deviceFingerprint
        ? this.db.$count(
            schema.trialGrants,
            and(
              eq(schema.trialGrants.deviceFingerprint, input.deviceFingerprint),
              gt(schema.trialGrants.createdAt, since),
            ),
          )
        : Promise.resolve(0),
      ipHash
        ? this.db.$count(
            schema.trialGrants,
            and(eq(schema.trialGrants.ipHash, ipHash), gt(schema.trialGrants.createdAt, since)),
          )
        : Promise.resolve(0),
      this.remainingDailyBudget(cfg),
    ]);

    const evaluation = evaluateTrialEligibility({
      phoneVerified: true,
      phoneLineType: lineType,
      phoneHashAlreadyUsed: Boolean(phoneUsed),
      signupsFromDeviceLast24h: byDevice + 1,
      signupsFromIpLast24h: byIp + 1,
      hasCompletedFirstCloudRequest: true, // deferred to onFirstCloudRequest; not a claim-time block
      dailyTrialBudgetRemainingUsdCents: budget,
      trialValueUsdCents: cfg.credits, // 100 credits = $1 → credits == cents
      accountSuspended: input.suspended,
    });

    const status = evaluation.eligible
      ? "pending_first_request"
      : evaluation.queueForReview
        ? "queued_for_review"
        : "rejected";
    if (phoneUsed)
      throw new ApiError(409, "phone_already_used", "This phone number already received a trial.");
    const [row] = await this.db
      .insert(schema.trialGrants)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        phoneHash,
        phoneLineType: lineType,
        deviceFingerprint: input.deviceFingerprint,
        ipHash,
        status,
        reasons: evaluation.reasons,
      })
      .returning();
    await writeAudit(this.db, {
      actorType: "user",
      actorId: input.userId,
      action: "trial.claim",
      targetType: "org",
      targetId: input.orgId,
      after: { status, reasons: evaluation.reasons },
    });
    return row!;
  }

  /** Called by the gateway after the org's first settled request. Idempotent. */
  async onFirstCloudRequest(orgId: string): Promise<boolean> {
    const row = await this.db.query.trialGrants.findFirst({
      where: and(
        eq(schema.trialGrants.orgId, orgId),
        eq(schema.trialGrants.status, "pending_first_request"),
      ),
    });
    if (!row) return false;
    return this.grant(row.id, "system:gateway");
  }

  async approve(trialId: string, adminId: string): Promise<boolean> {
    const row = await this.db.query.trialGrants.findFirst({
      where: eq(schema.trialGrants.id, trialId),
    });
    if (!row || row.status !== "queued_for_review") return false;
    const ok = await this.grant(row.id, `admin:${adminId}`);
    await writeAudit(this.db, {
      actorType: "admin",
      actorId: adminId,
      action: "trial.approve",
      targetType: "trial",
      targetId: trialId,
      before: { status: row.status },
      after: { status: "granted" },
    });
    return ok;
  }

  private async grant(trialId: string, actor: string): Promise<boolean> {
    const cfg = await this.loadConfig();
    const row = await this.db.query.trialGrants.findFirst({
      where: eq(schema.trialGrants.id, trialId),
    });
    if (!row || row.status === "granted") return false;
    if (cfg.dailyBudgetUsdCents > 0 && (await this.remainingDailyBudget(cfg)) < cfg.credits) {
      await this.db
        .update(schema.trialGrants)
        .set({ status: "queued_for_review" })
        .where(eq(schema.trialGrants.id, trialId));
      return false;
    }
    const expiresAt = new Date(Date.now() + cfg.expiryDays * 86_400_000);
    await this.ledger.grant({
      orgId: row.orgId,
      bucket: "trial",
      type: "trial_grant",
      amount: creditsToMicro(cfg.credits),
      idempotencyKey: `trial:${row.id}`,
      actor,
      reason: "trial credits",
      metadata: { expiresAt: expiresAt.toISOString() },
    });
    await this.db
      .update(schema.trialGrants)
      .set({ status: "granted", grantedAt: new Date(), expiresAt })
      .where(eq(schema.trialGrants.id, trialId));
    const day = new Date().toISOString().slice(0, 10);
    await this.db
      .insert(schema.trialBudgetDays)
      .values({ day, capUsdCents: cfg.dailyBudgetUsdCents, grantedUsdCents: cfg.credits })
      .onConflictDoUpdate({
        target: schema.trialBudgetDays.day,
        set: { grantedUsdCents: sql`${schema.trialBudgetDays.grantedUsdCents} + ${cfg.credits}` },
      });
    return true;
  }

  private async remainingDailyBudget(cfg: TrialConfig): Promise<number> {
    const day = new Date().toISOString().slice(0, 10);
    const row = await this.db.query.trialBudgetDays.findFirst({
      where: eq(schema.trialBudgetDays.day, day),
    });
    return (row?.capUsdCents ?? cfg.dailyBudgetUsdCents) - (row?.grantedUsdCents ?? 0);
  }
}

void TRIAL_CREDIT_EXPIRY_DAYS;
