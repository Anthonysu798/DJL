import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabase, seedOrg } from "../testing/db.ts";
import { AnalyticsService } from "./AnalyticsService.ts";
import type { Principal } from "../auth/guard.ts";

const database = testDatabase();
const now = new Date("2026-10-13T12:00:00.000Z");
const service = new AnalyticsService(database.db, { now: () => now });
const registrations: string[] = [];
const users: string[] = [];
const metadata = () => ({
  installationId: crypto.randomUUID(),
  platform: "ios",
  appVersion: "0.5.0",
  osVersion: "26.1",
  channel: "test",
});
async function installation() {
  const input = metadata();
  registrations.push(input.installationId);
  return service.register(input);
}
const event = (extra = {}) => ({
  eventId: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  kind: "foreground",
  occurredAt: now.toISOString(),
  ...extra,
});
const principal = (userId: string, orgId: string): Principal => ({
  userId,
  orgId,
  personalOrgId: orgId,
  role: "owner",
  sessionId: crypto.randomUUID(),
  email: "fixture@test.invalid",
  emailVerified: true,
  banned: false,
});
afterAll(async () => {
  for (const id of registrations)
    await database.db
      .delete(schema.analyticsInstallations)
      .where(eq(schema.analyticsInstallations.id, id));
  for (const id of users)
    await database.db
      .delete(schema.analyticsDailyActivity)
      .where(eq(schema.analyticsDailyActivity.userId, id));
  await database.close();
});

describe("product analytics ingestion", () => {
  it("deduplicates events and stores only server-verified user identity", async () => {
    const install = await installation();
    const fixture = await seedOrg(database.db, "analytics");
    users.push(fixture.userId);
    const batch = { events: [event()] };
    const p = principal(fixture.userId, fixture.orgId);
    expect(await service.ingest(install.credential, p, batch)).toEqual({ accepted: 1 });
    expect(await service.ingest(install.credential, p, batch)).toEqual({ accepted: 0 });
    const rows = await database.db.query.analyticsEvents.findMany({
      where: eq(schema.analyticsEvents.installationId, install.installationId),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(fixture.userId);
    await expect(
      service.ingest(install.credential, p, {
        events: [event({ userId: "spoofed", prompt: "private" })],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("deduplicates native uppercase UUID retries", async () => {
    const install = await installation();
    const report = {
      events: [
        event({
          eventId: crypto.randomUUID().toUpperCase(),
          sessionId: crypto.randomUUID().toUpperCase(),
        }),
      ],
    };
    expect(await service.ingest(install.credential, null, report)).toEqual({ accepted: 1 });
    expect(await service.ingest(install.credential, null, report)).toEqual({ accepted: 0 });
  });

  it("rejects credentials, expired/future events and registration takeover", async () => {
    const install = await installation();
    await expect(service.ingest("invalid", null, { events: [event()] })).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      service.ingest(install.credential, null, {
        events: [event({ occurredAt: "2026-10-01T12:00:00.000Z" })],
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.ingest(install.credential, null, {
        events: [event({ occurredAt: "2026-10-14T12:00:00.000Z" })],
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.register({ ...metadata(), installationId: install.installationId }),
    ).rejects.toMatchObject({ status: 409 });
    const row = await database.db.query.analyticsInstallations.findFirst({
      where: eq(schema.analyticsInstallations.id, install.installationId),
    });
    expect(JSON.stringify(row)).not.toContain(install.credential);
  });

  it("does not turn session end into active foreground presence", async () => {
    const install = await installation();
    await service.ingest(install.credential, null, { events: [event({ kind: "session_end" })] });
    const row = await database.db.query.analyticsInstallations.findFirst({
      where: eq(schema.analyticsInstallations.id, install.installationId),
    });
    expect(row?.lastSeenAt).toBeNull();
    const activity = await database.db.query.analyticsDailyActivity.findMany({
      where: eq(schema.analyticsDailyActivity.installationId, install.installationId),
    });
    expect(activity).toHaveLength(0);
  });

  it("removes one account's optional activity without changing other accounts", async () => {
    const a = await seedOrg(database.db, "analytics-delete-a");
    const b = await seedOrg(database.db, "analytics-delete-b");
    users.push(a.userId, b.userId);
    for (const fixture of [a, b]) {
      const install = await installation();
      await service.ingest(install.credential, principal(fixture.userId, fixture.orgId), {
        events: [event()],
      });
    }
    await database.db.transaction((tx) => service.deleteUserActivity(a.userId, tx));
    expect(
      await database.db.query.analyticsEvents.findMany({
        where: eq(schema.analyticsEvents.userId, a.userId),
      }),
    ).toHaveLength(0);
    expect(
      await database.db.query.analyticsDailyActivity.findMany({
        where: eq(schema.analyticsDailyActivity.userId, a.userId),
      }),
    ).toHaveLength(0);
    expect(
      await database.db.query.analyticsEvents.findMany({
        where: eq(schema.analyticsEvents.userId, b.userId),
      }),
    ).toHaveLength(1);
  });
});
