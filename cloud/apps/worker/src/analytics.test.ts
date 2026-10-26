import { eq, and } from "drizzle-orm";
import { createDatabase, schema } from "@djl/db";
import { afterAll, describe, expect, it } from "vitest";
import { collectAnalyticsSources, pruneAnalytics } from "./analytics.ts";
import type { AnalyticsFetch } from "@djl/api/analytics-sources";

const database = createDatabase(
  process.env.DATABASE_URL ?? "postgres://djl:djl@localhost:54329/djl",
  { max: 2 },
);
afterAll(() => database.close());
const now = new Date("2026-10-13T13:00:00.000Z");
const fetchImpl: AnalyticsFetch = async (url) =>
  String(url).includes("api.github.com")
    ? Response.json([
        { tag_name: "v0.5.0", assets: [{ id: 991234567, name: "DJL.exe", download_count: 42 }] },
      ])
    : Response.json({ downloads: { total: 17, bySource: {}, byPlatform: {}, byDay: [] } });

describe("analytics collection and retention", () => {
  it("collects once per observation and keeps actual counters after a failed poll", async () => {
    await collectAnalyticsSources({ db: database.db, now: () => now, fetchImpl, env: {} });
    await collectAnalyticsSources({ db: database.db, now: () => now, fetchImpl, env: {} });
    const where = and(
      eq(schema.analyticsSourceSnapshots.source, "github"),
      eq(schema.analyticsSourceSnapshots.dimensionKey, "asset:991234567"),
      eq(schema.analyticsSourceSnapshots.observedAt, now),
    );
    const records = await database.db.query.analyticsSourceSnapshots.findMany({ where });
    expect(records).toHaveLength(1);
    expect(records[0]?.value).toBe(42n);
    await collectAnalyticsSources({
      db: database.db,
      now: () => new Date(now.getTime() + 900_000),
      env: {},
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    expect((await database.db.query.analyticsSourceSnapshots.findMany({ where }))[0]?.value).toBe(
      42n,
    );
    const health = await database.db.query.analyticsSourceSnapshots.findMany({
      where: and(
        eq(schema.analyticsSourceSnapshots.source, "github"),
        eq(schema.analyticsSourceSnapshots.dimensionKey, "_health"),
      ),
    });
    expect(health.some((row) => row.metadata.status === "error")).toBe(true);
  });

  it("prunes old raw events while preserving recent activity", async () => {
    const id = crypto.randomUUID();
    await database.db.insert(schema.analyticsInstallations).values({
      id,
      credentialHash: crypto.randomUUID(),
      platform: "ios",
      appVersion: "0.5.0",
      osVersion: "26.1",
      channel: "test",
    });
    const old = crypto.randomUUID();
    const recent = crypto.randomUUID();
    for (const [eventId, date] of [
      [old, "2026-09-01T12:00:00.000Z"],
      [recent, "2026-10-12T12:00:00.000Z"],
    ]) {
      await database.db.insert(schema.analyticsEvents).values({
        id: eventId!,
        installationId: id,
        sessionId: crypto.randomUUID(),
        kind: "foreground",
        platform: "ios",
        appVersion: "0.5.0",
        channel: "test",
        occurredAt: new Date(date!),
        receivedAt: new Date(date!),
      });
    }
    await pruneAnalytics({ db: database.db, now: () => now });
    expect(
      await database.db.query.analyticsEvents.findFirst({
        where: eq(schema.analyticsEvents.id, old),
      }),
    ).toBeUndefined();
    expect(
      await database.db.query.analyticsEvents.findFirst({
        where: eq(schema.analyticsEvents.id, recent),
      }),
    ).toBeTruthy();
  });
});
