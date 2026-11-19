import { afterAll, describe, expect, it } from "vitest";
import { eq, and, count } from "drizzle-orm";
import { schema } from "@djl/db";
import {
  socialTrackingDaily as daily,
  socialTrackingLinks as links,
} from "../../../../../packages/db/src/schema/socialTrackingLinks.ts";
import { seedOrg, testDatabase } from "../../testing/db.ts";
import { TrackingLinkService, TRACKING_NOTICE } from "./TrackingLinkService.ts";
const { db, close } = testDatabase();
afterAll(close);
const input = {
  url: "https://example.com/offer?utm_source=instagram&utm_medium=social&utm_campaign=synthetic",
  campaignId: "same-campaign",
  threadId: "same-thread",
  contentRevision: 3,
  expiresInDays: 7 as const,
  disclosureAccepted: true,
};
const slug = (path: string) => path.split("/l/")[1]!;
describe("first-party aggregate link opens", () => {
  it("isolates metadata and counters across both user and organization even for equal campaign IDs", async () => {
    const p = await seedOrg(db, "tracking-owner");
    const other = await seedOrg(db, "tracking-other");
    const service = new TrackingLinkService(db);
    const a = await service.create(p, input);
    const b = await service.create(other, input);
    await service.open(slug(a.publicPath), true);
    await service.open(slug(b.publicPath), true);
    await service.open(slug(b.publicPath), true);
    expect(
      (await service.list(p, { campaignId: input.campaignId, threadId: input.threadId })).map(
        (link) => [link.id, link.linkOpens],
      ),
    ).toEqual([[a.link.id, 1]]);
    expect((await service.list(other, { campaignId: input.campaignId }))[0]!.linkOpens).toBe(2);
    for (const foreign of [
      { ...p, userId: other.userId },
      { ...p, orgId: other.orgId },
    ]) {
      expect(await service.list(foreign, { campaignId: input.campaignId })).toEqual([]);
      await expect(service.get(foreign, a.link.id)).rejects.toMatchObject({ status: 404 });
      await expect(service.revoke(foreign, a.link.id)).rejects.toMatchObject({ status: 404 });
    }
  });
  it("keeps targets fixed, aggregates UTC days atomically and stores no visitor identity", async () => {
    const p = await seedOrg(db, "tracking-days");
    let now = new Date("2026-10-27T23:59:59Z");
    const service = new TrackingLinkService(db, () => now);
    const created = await service.create(p, input);
    const destination = await service.open(slug(created.publicPath), true);
    expect(destination).toBe(input.url);
    now = new Date("2026-10-28T00:00:00Z");
    await Promise.all(
      Array.from({ length: 20 }, () => service.open(slug(created.publicPath), true)),
    );
    expect(await service.get(p, created.link.id)).toMatchObject({
      targetUrl: input.url,
      contentRevision: 3,
      linkOpens: 21,
      daily: [
        { day: "2026-10-27", linkOpens: 1 },
        { day: "2026-10-28", linkOpens: 20 },
      ],
      notice: TRACKING_NOTICE,
      measurement: "link_opens",
    });
    const [stored] = await db
      .select()
      .from(daily)
      .where(and(eq(daily.linkId, created.link.id), eq(daily.day, "2026-10-28")));
    expect(Object.keys(stored!).toSorted()).toEqual([
      "day",
      "linkId",
      "linkOpens",
      "orgId",
      "userId",
    ]);
    expect(await service.list(p, { campaignId: "other" })).toEqual([]);
  });
  it("does not count non-countable opens and refuses expired, revoked and malformed slugs", async () => {
    const p = await seedOrg(db, "tracking-unavailable");
    let now = new Date();
    const service = new TrackingLinkService(db, () => now);
    const a = await service.create(p, input);
    await service.open(slug(a.publicPath), false);
    expect((await service.get(p, a.link.id)).linkOpens).toBe(0);
    now = new Date(now.getTime() + 8 * 86400000);
    await expect(service.open(slug(a.publicPath), true)).rejects.toMatchObject({ status: 404 });
    const b = await service.create(p, input);
    await service.revoke(p, b.link.id);
    await expect(service.open(slug(b.publicPath), true)).rejects.toMatchObject({ status: 404 });
    await expect(service.open("malformed", true)).rejects.toMatchObject({ status: 404 });
    expect((await service.get(p, b.link.id)).linkOpens).toBe(0);
  });
  it("requires disclosure and valid metadata/expiry and fails closed on invalid stored targets", async () => {
    const p = await seedOrg(db, "tracking-validation");
    const service = new TrackingLinkService(db);
    for (const invalid of [
      { ...input, disclosureAccepted: false },
      { ...input, url: "https://127.0.0.1/" },
      { ...input, campaignId: " " },
      { ...input, contentRevision: 0 },
      { ...input, expiresInDays: 999 as 7 },
    ])
      await expect(service.create(p, invalid)).rejects.toMatchObject({ status: 400 });
    const created = await service.create(p, input);
    await db
      .update(links)
      .set({ targetUrl: "javascript:alert(1)" })
      .where(eq(links.id, created.link.id));
    await expect(service.open(slug(created.publicPath), true)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("never confirms a draft or creates a publishing task", async () => {
    const p = await seedOrg(db, "tracking-no-publication");
    const [before] = await db
      .select({ value: count() })
      .from(schema.socialPublishTasks)
      .where(eq(schema.socialPublishTasks.orgId, p.orgId));
    const service = new TrackingLinkService(db);
    const created = await service.create(p, input);
    await service.open(slug(created.publicPath), true);
    const [after] = await db
      .select({ value: count() })
      .from(schema.socialPublishTasks)
      .where(eq(schema.socialPublishTasks.orgId, p.orgId));
    expect(after!.value).toBe(before!.value);
    expect(
      await db.select().from(schema.socialDrafts).where(eq(schema.socialDrafts.orgId, p.orgId)),
    ).toEqual([]);
  });
});
