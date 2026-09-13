import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { creditsToMicro } from "@djl/domain";
import { MockOutbox } from "@djl/notify";
import { afterAll, describe, expect, it } from "vitest";

import { LedgerService } from "../credits/LedgerService.ts";
import { seedOrg, testDatabase } from "../testing/db.ts";
import { TrialService } from "./TrialService.ts";

const conn = testDatabase();
const ledger = new LedgerService(conn.db);
const outbox = new MockOutbox();
const trial = new TrialService(conn.db, ledger, outbox, {
  credits: 200,
  expiryDays: 14,
  dailyBudgetUsdCents: 10_000,
  hashSalt: "salt",
});
afterAll(() => conn.close());

const phone = () =>
  `+1555${Math.floor(Math.random() * 1_000_000_0)
    .toString()
    .padStart(7, "0")}`;

describe("TrialService", () => {
  it("claims as pending, grants on first cloud request, and is idempotent", async () => {
    const { orgId, userId } = await seedOrg(conn.db, "trial");
    const claimed = await trial.claim({
      orgId,
      userId,
      phoneNumber: phone(),
      phoneVerified: true,
      deviceFingerprint: `d-${orgId}`,
      ip: "1.2.3.4",
      suspended: false,
    });
    expect(claimed.status).toBe("pending_first_request");
    expect(await ledger.available(orgId)).toBe(0n);
    expect(await trial.onFirstCloudRequest(orgId)).toBe(true);
    expect(await trial.onFirstCloudRequest(orgId)).toBe(false);
    expect(await ledger.available(orgId)).toBe(creditsToMicro(200));
    const row = await trial.status(orgId);
    expect(row?.status).toBe("granted");
    expect(row?.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
  });

  it("rejects a reused phone and a VoIP line", async () => {
    const p = phone();
    const a = await seedOrg(conn.db, "trial-a");
    await trial.claim({
      orgId: a.orgId,
      userId: a.userId,
      phoneNumber: p,
      phoneVerified: true,
      deviceFingerprint: null,
      ip: null,
      suspended: false,
    });
    const b = await seedOrg(conn.db, "trial-b");
    await expect(
      trial.claim({
        orgId: b.orgId,
        userId: b.userId,
        phoneNumber: p,
        phoneVerified: true,
        deviceFingerprint: null,
        ip: null,
        suspended: false,
      }),
    ).rejects.toMatchObject({ code: "phone_already_used" });
    const voip = phone();
    outbox.lineTypes.set(voip, "voip");
    const c = await seedOrg(conn.db, "trial-c");
    const rejected = await trial.claim({
      orgId: c.orgId,
      userId: c.userId,
      phoneNumber: voip,
      phoneVerified: true,
      deviceFingerprint: null,
      ip: null,
      suspended: false,
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.reasons).toContain("phone_line_type_not_mobile");
    expect(await trial.onFirstCloudRequest(c.orgId)).toBe(false);
  });

  it("requires a verified phone", async () => {
    const { orgId, userId } = await seedOrg(conn.db, "trial-np");
    await expect(
      trial.claim({
        orgId,
        userId,
        phoneNumber: null,
        phoneVerified: false,
        deviceFingerprint: null,
        ip: null,
        suspended: false,
      }),
    ).rejects.toMatchObject({ code: "phone_required" });
  });

  it("queues for review when the daily budget is exhausted and admin approval grants", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await conn.db
      .insert(schema.trialBudgetDays)
      .values({ day, capUsdCents: 10_000, grantedUsdCents: 9_950 })
      .onConflictDoUpdate({
        target: schema.trialBudgetDays.day,
        set: { capUsdCents: 10_000, grantedUsdCents: 9_950 },
      });
    const { orgId, userId } = await seedOrg(conn.db, "trial-q");
    const claimed = await trial.claim({
      orgId,
      userId,
      phoneNumber: phone(),
      phoneVerified: true,
      deviceFingerprint: null,
      ip: null,
      suspended: false,
    });
    expect(claimed.status).toBe("queued_for_review");
    await conn.db
      .update(schema.trialBudgetDays)
      .set({ grantedUsdCents: 0 })
      .where(eq(schema.trialBudgetDays.day, day));
    expect(await trial.approve(claimed.id, "admin-1")).toBe(true);
    expect(await ledger.available(orgId)).toBe(creditsToMicro(200));
    const audit = await conn.db.query.auditEvents.findFirst({
      where: eq(schema.auditEvents.targetId, claimed.id),
    });
    expect(audit?.action).toBe("trial.approve");
  });
});
