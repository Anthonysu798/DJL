import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { eq, and, inArray } from "drizzle-orm";
import { schema } from "@djl/db";
import {
  socialReportSchedules,
  socialWeeklyReports,
} from "../../../../../packages/db/src/schema/socialReports.ts";
import { seedOrg, testDatabase } from "../../testing/db.ts";
import { SocialReportService } from "./SocialReportService.ts";
const { db, close } = testDatabase();
afterAll(close);
const fixtureOwners: string[] = [];
afterEach(async () => {
  if (fixtureOwners.length)
    await db
      .update(socialReportSchedules)
      .set({ enabled: false, nextRunAt: null })
      .where(inArray(socialReportSchedules.userId, fixtureOwners));
});
const preference = { enabled: true, timezone: "America/Toronto", weekday: 1, hour: 9, minute: 0 };
const allUnknown = { views: null, likes: null, comments: null, shares: null };
async function fixture() {
  const owner = await seedOrg(db, "social-recap");
  fixtureOwners.push(owner.userId);
  let clock = new Date("2027-03-07T15:00:00Z");
  const [draft] = await db
    .insert(schema.socialDrafts)
    .values({
      ...owner,
      threadId: crypto.randomUUID(),
      revision: 1,
      content: {
        caption: "approved",
        captions: {},
        mediaFileIds: [],
        accountIds: [],
        scheduledAt: clock.toISOString(),
        timezone: preference.timezone,
      },
    })
    .returning();
  const metrics = vi.fn(async (_scope: unknown, _task: string) => ({
    postUrl: null as string | null,
    metrics: {
      views: 10 as number | null,
      likes: 2 as number | null,
      comments: 0 as number | null,
      shares: null as number | null,
    },
  }));
  const service = new SocialReportService(db, { metrics }, () => clock);
  return {
    owner,
    draft: draft!,
    service,
    metrics,
    setClock: (date: string) => {
      clock = new Date(date);
    },
  };
}
async function post(
  f: Awaited<ReturnType<typeof fixture>>,
  provider: "instagram" | "tiktok",
  patch: { state?: "published" | "queued"; threadId?: string; at?: string } = {},
) {
  const [account] = await db
    .insert(schema.socialAccounts)
    .values({
      ...f.owner,
      provider,
      providerAccountId: crypto.randomUUID(),
      username: "fixture",
      displayName: "Fixture",
      scopes: [],
      capabilities: { publish: true, metrics: true },
      status: "connected",
      expiresAt: new Date("2030-01-01"),
    })
    .returning();
  let draftId = f.draft.id;
  if (patch.threadId) {
    const [draft] = await db
      .insert(schema.socialDrafts)
      .values({ ...f.owner, threadId: patch.threadId, revision: 1, content: f.draft.content })
      .returning();
    draftId = draft!.id;
  }
  const [task] = await db
    .insert(schema.socialPublishTasks)
    .values({
      ...f.owner,
      draftId,
      revision: 1,
      accountId: account!.id,
      state: patch.state ?? "published",
      postId: "official-post",
      dueAt: new Date(0),
      updatedAt: new Date(patch.at ?? "2027-03-07T18:00:00Z"),
    })
    .returning();
  return task!;
}
describe("opt-in durable weekly social recaps", () => {
  it("defaults off, does not create schedules on reads, and generates no jobs or metrics while disabled", async () => {
    const f = await fixture();
    const state = await f.service.getState(f.owner, f.draft.id);
    expect(state.schedule).toMatchObject({ enabled: false, id: null, nextRunAt: null });
    expect(
      await db
        .select()
        .from(socialReportSchedules)
        .where(eq(socialReportSchedules.threadId, f.draft.threadId)),
    ).toHaveLength(0);
    expect(await f.service.due(new Date("2030-01-01"))).toEqual([]);
    await f.service.setSchedule(f.owner, f.draft.id, { ...preference, enabled: false });
    expect(await f.service.tick(new Date("2030-01-01"))).toBe(0);
    expect(f.metrics).not.toHaveBeenCalled();
  });
  it("anchors schedules and reports to an owned draft/thread and rejects cross-user/org requests", async () => {
    const f = await fixture();
    const other = await seedOrg(db, "foreign-recap");
    await f.service.setSchedule(f.owner, f.draft.id, preference);
    for (const foreign of [
      { ...f.owner, userId: other.userId },
      { ...f.owner, orgId: other.orgId },
    ]) {
      await expect(f.service.getState(foreign, f.draft.id)).rejects.toMatchObject({ status: 404 });
      await expect(f.service.setSchedule(foreign, f.draft.id, preference)).rejects.toMatchObject({
        status: 404,
      });
    }
    const [sibling] = await db
      .insert(schema.socialDrafts)
      .values({ ...f.owner, threadId: f.draft.threadId, revision: 1, content: f.draft.content })
      .returning();
    const same = await f.service.setSchedule(f.owner, sibling!.id, preference);
    expect((await f.service.getState(f.owner, f.draft.id)).schedule.id).toBe(same.schedule.id);
    await expect(
      f.service.setSchedule(f.owner, crypto.randomUUID(), preference),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("persists one report per period under duplicate worker ticks and never modifies publication tasks", async () => {
    const f = await fixture();
    const task = await post(f, "instagram");
    await post(f, "tiktok", { state: "queued" });
    await post(f, "instagram", { threadId: "another-thread" });
    await post(f, "instagram", { at: "2027-03-08T14:00:00Z" }); // next period boundary
    await f.service.setSchedule(f.owner, f.draft.id, preference);
    f.setClock("2027-03-08T14:01:00Z");
    const counts = await Promise.all([f.service.tick(), f.service.tick()]);
    expect(counts.reduce((sum, value) => sum + value, 0)).toBe(1);
    const result = await f.service.getState(f.owner, f.draft.id);
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]).toMatchObject({
      publishedPosts: 1,
      inspectedPosts: 1,
      partial: true,
      retrievedAt: "2027-03-08T14:01:00.000Z",
      periodStart: "2027-03-01T14:00:00.000Z",
      periodEnd: "2027-03-08T14:00:00.000Z",
    });
    expect(result.reports[0]!.providers).toEqual([
      {
        provider: "instagram",
        publishedPosts: 1,
        metrics: { views: 10, likes: 2, comments: 0, shares: null },
      },
    ]);
    expect(result.schedule.nextRunAt).toBe("2027-03-15T13:00:00.000Z");
    expect(f.metrics).toHaveBeenCalledTimes(1);
    expect(f.metrics.mock.calls[0]![0]).toMatchObject(f.owner);
    const [unchanged] = await db
      .select()
      .from(schema.socialPublishTasks)
      .where(eq(schema.socialPublishTasks.id, task.id));
    expect(unchanged).toEqual(task);
    expect(await f.service.tick()).toBe(0);
  });
  it("keeps unavailable provider data null and never presents a partial sum as a complete total", async () => {
    const f = await fixture();
    const ig = await post(f, "instagram");
    const unavailable = await post(f, "instagram");
    const tt = await post(f, "tiktok");
    f.metrics.mockImplementation(async (_scope, task) => {
      if (task === unavailable.id) throw new Error("credentials unavailable");
      return {
        postUrl: task === ig.id ? "https://www.instagram.com/p/fixture/" : null,
        metrics: task === tt.id ? allUnknown : { views: 10, likes: 2, comments: 0, shares: null },
      };
    });
    await f.service.setSchedule(f.owner, f.draft.id, preference);
    f.setClock("2027-03-08T14:01:00Z");
    await f.service.tick();
    const report = (await f.service.getState(f.owner, f.draft.id)).reports[0]!;
    expect(report.publishedPosts).toBe(3);
    expect(report.providers).toEqual(
      expect.arrayContaining([
        { provider: "instagram", publishedPosts: 2, metrics: allUnknown },
        { provider: "tiktok", publishedPosts: 1, metrics: allUnknown },
      ]),
    );
    expect(report.posts.find((p) => p.taskId === ig.id)?.metrics.views).toBe(10);
    expect(report.posts.find((p) => p.taskId === unavailable.id)?.metrics).toEqual(allUnknown);
  });
  it("bounds metric collection while keeping complete provider post counts", async () => {
    const f = await fixture();
    for (let index = 0; index < 26; index++) await post(f, "instagram");
    await f.service.setSchedule(f.owner, f.draft.id, preference);
    f.setClock("2027-03-08T14:01:00Z");
    await f.service.tick();
    const report = (await f.service.getState(f.owner, f.draft.id)).reports[0]!;
    expect(report).toMatchObject({
      publishedPosts: 26,
      inspectedPosts: 25,
      truncated: true,
      partial: true,
    });
    expect(report.providers).toEqual([
      { provider: "instagram", publishedPosts: 26, metrics: allUnknown },
    ]);
    expect(f.metrics).toHaveBeenCalledTimes(25);
  });
  it("backfills missed periods within limits, preserves persisted preferences, and skips disabled periods", async () => {
    const f = await fixture();
    await f.service.setSchedule(f.owner, f.draft.id, preference);
    f.setClock("2027-04-01T00:00:00Z");
    expect(await f.service.tick(undefined, { maxPeriodsPerSchedule: 2 })).toBe(2);
    const before = (await f.service.getState(f.owner, f.draft.id)).schedule.nextRunAt;
    await f.service.setSchedule(f.owner, f.draft.id, preference); // repeat enable must not skip the backlog
    expect((await f.service.getState(f.owner, f.draft.id)).schedule.nextRunAt).toBe(before);
    expect(await f.service.tick()).toBe(2);
    await f.service.setSchedule(f.owner, f.draft.id, { ...preference, enabled: false });
    f.setClock("2027-05-01T00:00:00Z");
    expect(await f.service.tick()).toBe(0);
    const enabled = await f.service.setSchedule(f.owner, f.draft.id, preference);
    expect(enabled.schedule.nextRunAt).toBe("2027-05-03T13:00:00.000Z");
    expect(enabled.reports).toHaveLength(4);
  });
  it("retries a rolled-back report safely and disables schedules when ownership eligibility is revoked", async () => {
    const f = await fixture();
    await f.service.setSchedule(f.owner, f.draft.id, preference);
    f.setClock("2027-03-08T14:01:00Z");
    const collect = vi.spyOn(
      f.service as unknown as { collect: (...args: unknown[]) => Promise<unknown> },
      "collect",
    );
    collect.mockRejectedValueOnce(new Error("database temporarily unavailable"));
    await expect(f.service.tick()).rejects.toThrow("temporarily");
    expect(
      await db
        .select()
        .from(socialWeeklyReports)
        .where(eq(socialWeeklyReports.threadId, f.draft.threadId)),
    ).toHaveLength(0);
    expect(await f.service.tick()).toBe(1);
    await db
      .delete(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, f.owner.orgId),
          eq(schema.member.userId, f.owner.userId),
        ),
      );
    f.setClock("2027-03-16T00:00:00Z");
    expect(await f.service.tick()).toBe(0);
    expect((await f.service.getState(f.owner, f.draft.id)).schedule.enabled).toBe(false);
  });
});
