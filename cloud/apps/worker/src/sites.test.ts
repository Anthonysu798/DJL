import { eq } from "drizzle-orm";
import { createDatabase, schema } from "@djl/db";
import { FakeBlobStore } from "@djl/api/blobs";
import { MockOutbox } from "@djl/notify";
import { afterAll, describe, expect, it } from "vitest";

import { expireIdleSites } from "./sites.ts";

const { db, close } = createDatabase(
  process.env.DATABASE_URL ?? "postgres://djl:djl@localhost:54329/djl",
  { max: 2 },
);
afterAll(() => close());

const DAY = 86_400_000;

async function siteAged(days: { created: number; visited?: number; warned?: number }, now: Date) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [user] = await db
    .insert(schema.user)
    .values({
      name: `idle-${suffix}`,
      email: `idle-${suffix}@test.invalid`,
      emailVerified: true,
      locale: "zh-Hans",
    })
    .returning();
  const [org] = await db
    .insert(schema.organization)
    .values({ name: `idle-${suffix}`, slug: `idle-${suffix}`, createdAt: new Date() })
    .returning();
  const ago = (d: number) => new Date(now.getTime() - d * DAY);
  const [site] = await db
    .insert(schema.sites)
    .values({
      orgId: org!.id,
      userId: user!.id,
      name: `idle-${suffix}`,
      termsAcceptedAt: ago(days.created),
      createdAt: ago(days.created),
      lastDeployAt: ago(days.created),
      ...(days.visited !== undefined ? { lastVisitAt: ago(days.visited) } : {}),
      ...(days.warned !== undefined ? { expiryWarnedAt: ago(days.warned) } : {}),
    })
    .returning();
  return site!;
}

const find = (id: string) => db.query.sites.findFirst({ where: eq(schema.sites.id, id) });

describe("expireIdleSites", () => {
  // Real time: rows from other test files are new, so only this file's aged rows are idle.
  const now = new Date();

  it("warns owners of sites idle for 90 days, once, in their language", async () => {
    const outbox = new MockOutbox();
    const idle = await siteAged({ created: 200, visited: 91 }, now);
    const busy = await siteAged({ created: 200, visited: 10 }, now);
    const deps = {
      db,
      blobs: new FakeBlobStore(),
      email: outbox,
      sitesDomain: "slcor.site",
      now: () => now,
    };
    await expireIdleSites(deps);
    expect((await find(idle.id))?.expiryWarnedAt).toEqual(now);
    expect((await find(busy.id))?.expiryWarnedAt).toBeNull();
    const sent = outbox.emails.filter((e) => e.text.includes(idle.name));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain("14 天");
    await expireIdleSites(deps);
    expect(outbox.emails.filter((e) => e.text.includes(idle.name))).toHaveLength(1);
  });

  it("unpublishes a warned site after 14 quiet days, but keeps one visited since the warning", async () => {
    const quiet = await siteAged({ created: 300, visited: 120, warned: 15 }, now);
    const revisited = await siteAged({ created: 300, visited: 2, warned: 15 }, now);
    const early = await siteAged({ created: 300, visited: 120, warned: 5 }, now);
    const deps = {
      db,
      blobs: new FakeBlobStore(),
      email: new MockOutbox(),
      sitesDomain: "slcor.site",
      now: () => now,
    };
    await expireIdleSites(deps);
    expect(await find(quiet.id)).toBeUndefined();
    expect(await find(revisited.id)).toBeDefined();
    expect(await find(early.id)).toBeDefined();
  });

  it("leaves sites taken down by DJL alone", async () => {
    const down = await siteAged({ created: 300, visited: 200, warned: 30 }, now);
    await db.update(schema.sites).set({ status: "disabled" }).where(eq(schema.sites.id, down.id));
    await expireIdleSites({
      db,
      blobs: new FakeBlobStore(),
      email: new MockOutbox(),
      sitesDomain: "slcor.site",
      now: () => now,
    });
    expect(await find(down.id)).toBeDefined();
  });
});
