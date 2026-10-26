import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { AnalyticsService } from "./AnalyticsService.ts";
import { AnalyticsAdminService } from "./AnalyticsAdminService.ts";
import { seedOrg, testDatabase } from "../testing/db.ts";
import type { Principal } from "../auth/guard.ts";
import type { AdminPrincipal } from "../admin/AdminAuth.ts";

const database = testDatabase();
afterAll(() => database.close());
const now = new Date("2026-10-13T12:00:00.000Z");
const ingest = new AnalyticsService(database.db, { now: () => now });
const reports = new AnalyticsAdminService(database.db, { now: () => now });
const admin: AdminPrincipal = {
  adminId: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  email: "analytics-admin@test.invalid",
  role: "admin",
  mfaVerified: true,
};

describe("product analytics reports", () => {
  it("counts a person once across multiple days and installations, and separates test data", async () => {
    const fixture = await seedOrg(database.db, "analytics-distinct");
    const p: Principal = {
      userId: fixture.userId,
      orgId: fixture.orgId,
      personalOrgId: fixture.orgId,
      role: "owner",
      sessionId: crypto.randomUUID(),
      email: "fixture@test.invalid",
      emailVerified: true,
      banned: false,
    };
    const before = await reports.report(admin, { range: "week", platform: "desktop" });
    for (let index = 0; index < 2; index++) {
      const install = await ingest.register({
        installationId: crypto.randomUUID(),
        platform: "desktop",
        appVersion: "0.5.0",
        osVersion: "26.0",
        channel: "stable",
      });
      await ingest.ingest(install.credential, p, {
        events: [0, 1].map((day) => ({
          eventId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          kind: day === 0 ? "first_open" : "foreground",
          occurredAt: new Date(now.getTime() - day * 86_400_000).toISOString(),
        })),
      });
    }
    const test = await ingest.register({
      installationId: crypto.randomUUID(),
      platform: "desktop",
      appVersion: "0.5.0",
      osVersion: "26.0",
      channel: "test",
    });
    await ingest.ingest(test.credential, null, {
      events: [
        {
          eventId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          kind: "first_open",
          occurredAt: now.toISOString(),
        },
      ],
    });
    const report = await reports.report(admin, { range: "week", platform: "desktop" });
    expect(report.activity.activeAccounts - before.activity.activeAccounts).toBe(1);
    expect(report.activity.activeInstallations - before.activity.activeInstallations).toBe(2);
    expect(
      report.activity.recentlyActiveInstallations - before.activity.recentlyActiveInstallations,
    ).toBe(2);
    expect(report.sources.find((source) => source.id === "app-store")?.status).toBe("disconnected");
    expect(report.platforms.every((row) => row.platform === "desktop")).toBe(true);
  });

  it("refuses unverified sessions and invalid report filters", async () => {
    await expect(
      reports.report({ ...admin, mfaVerified: false }, { range: "week" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(reports.report(admin, { range: "all-time" as never })).rejects.toMatchObject({
      status: 400,
    });
    await expect(reports.report(admin, { range: "__proto__" as never })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      reports.report(admin, { range: "week", platform: "arbitrary" as never }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("marks unfinished retention periods unavailable rather than reporting zero", async () => {
    const install = await ingest.register({
      installationId: crypto.randomUUID(),
      platform: "web",
      appVersion: "0.5.0",
      osVersion: "unknown",
      channel: "stable",
    });
    await ingest.ingest(install.credential, null, {
      events: [
        {
          eventId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          kind: "first_open",
          occurredAt: "2026-10-11T12:00:00.000Z",
        },
        {
          eventId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          kind: "foreground",
          occurredAt: "2026-10-12T12:00:00.000Z",
        },
      ],
    });
    const report = await reports.report(admin, { range: "week", platform: "web" });
    const cohort = report.cohorts.find((row) => row.day === "2026-10-11");
    expect(cohort?.retainedDay1).toBeGreaterThanOrEqual(1);
    expect(cohort?.retainedDay7).toBeNull();
  });

  it("uses download baselines and ignores resets, deleted assets and future observations", async () => {
    const dimension = "asset:" + crypto.randomUUID();
    const baseline = (await reports.report(admin, { range: "week" })).downloadHistory;
    const prior = (day: string) =>
      BigInt(baseline.find((row) => row.source === "github" && row.day === day)?.downloads ?? "0");
    for (const [count, date] of [
      [100n, "2026-10-10"],
      [105n, "2026-10-11"],
      [2n, "2026-10-12"],
      [5n, "2026-10-13"],
      [999n, "2026-10-14"],
    ] as const) {
      await database.db.insert(schema.analyticsSourceSnapshots).values({
        source: "github",
        dimensionKey: dimension,
        value: count,
        observedAt: new Date(date + "T10:00:00Z"),
        metadata: {},
      });
    }
    const report = await reports.report(admin, { range: "week" });
    const history = report.downloadHistory.filter((row) => row.source === "github");
    expect(
      BigInt(history.find((row) => row.day === "2026-10-11")?.downloads ?? "0") -
        prior("2026-10-11"),
    ).toBe(5n);
    expect(
      BigInt(history.find((row) => row.day === "2026-10-12")?.downloads ?? "0") -
        prior("2026-10-12"),
    ).toBe(0n);
    expect(
      BigInt(history.find((row) => row.day === "2026-10-13")?.downloads ?? "0") -
        prior("2026-10-13"),
    ).toBe(3n);
    expect(history.some((row) => row.day === "2026-10-10" || row.day === "2026-10-14")).toBe(false);
    expect(report.downloads.find((row) => row.dimension === dimension)?.count).toBe("5");
  });

  it("limits account activity to user readers and excludes other accounts", async () => {
    const fixture = await seedOrg(database.db, "analytics-user-scope");
    const p: Principal = {
      userId: fixture.userId,
      orgId: fixture.orgId,
      personalOrgId: fixture.orgId,
      role: "owner",
      sessionId: crypto.randomUUID(),
      email: "fixture@test.invalid",
      emailVerified: true,
      banned: false,
    };
    const install = await ingest.register({
      installationId: crypto.randomUUID(),
      platform: "ios",
      appVersion: "0.5.0",
      osVersion: "26.0",
      channel: "stable",
    });
    await ingest.ingest(install.credential, p, {
      events: [
        {
          eventId: crypto.randomUUID(),
          sessionId: crypto.randomUUID(),
          kind: "feature_used",
          feature: "images",
          occurredAt: now.toISOString(),
        },
      ],
    });
    const account = await reports.accountActivity(admin, fixture.userId);
    expect(account.platforms).toEqual([
      { platform: "ios", installations: 1, lastSeenAt: now.toISOString() },
    ]);
    expect(account.features).toEqual([{ feature: "images", actions: 1 }]);
    expect((await reports.accountActivity(admin, crypto.randomUUID())).features).toEqual([]);
    await expect(
      reports.accountActivity({ ...admin, mfaVerified: false }, fixture.userId),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("audits aggregate exports without copying report data into the audit trail", async () => {
    const csv = await reports.export(admin, { range: "week" });
    expect(csv.startsWith('"metric","value","source","observed_at"')).toBe(true);
    expect(csv).not.toContain("fixture@test.invalid");
    const audit = await database.db.query.auditEvents.findMany({
      where: eq(schema.auditEvents.actorId, admin.adminId),
    });
    const exported = audit.filter((row) => row.action === "analytics.export");
    expect(exported).toHaveLength(1);
    expect(exported[0]?.after).toMatchObject({ range: "week", platform: null, includeTest: false });
    expect(JSON.stringify(exported[0]?.after)).not.toContain("registered_accounts");
    await expect(
      reports.export({ ...admin, mfaVerified: false }, { range: "week" }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
