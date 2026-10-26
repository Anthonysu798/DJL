import { afterAll, describe, expect, it, vi } from "vitest";
import { schema } from "@djl/db";
import { eq } from "drizzle-orm";
import { seedOrg, testDatabase } from "../../testing/db.ts";
import { PublishingService, validateDraft } from "./PublishingService.ts";
import { PublishingWorker } from "./PublishingWorker.ts";
import { SocialConnectionService } from "../SocialConnectionService.ts";
import { InstagramProvider } from "../providers/index.ts";
import { FakeBlobStore } from "../../sync/BlobStore.ts";
const { db, close } = testDatabase();
afterAll(close);
const service = new PublishingService(db);
async function fixture() {
  const p = await seedOrg(db, "publishing");
  const [account] = await db
    .insert(schema.socialAccounts)
    .values({
      ...p,
      provider: "instagram",
      providerAccountId: crypto.randomUUID(),
      username: "test",
      displayName: "test",
      scopes: [],
      capabilities: { publish: true, metrics: false },
      status: "connected",
      expiresAt: new Date(Date.now() + 3600000),
    })
    .returning();
  const [file] = await db
    .insert(schema.files)
    .values({
      ...p,
      name: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      sha256: Buffer.from(
        await crypto.subtle.digest("SHA-256", new Uint8Array([255, 216, 255])),
      ).toString("hex"),
      purpose: "image",
      storageKey: `org/${p.orgId}/test`,
      status: "ready",
    })
    .returning();
  const input = {
    threadId: "thread",
    caption: "hello",
    captions: { [account!.id]: "hello" },
    accountIds: [account!.id],
    mediaFileIds: [file!.id],
    scheduledAt: new Date(Date.now() - 1000).toISOString(),
    timezone: "America/Toronto",
  };
  return { p, input };
}
describe("durable publishing revisions", () => {
  it("concurrent confirmation creates one task and stale edits cannot confirm", async () => {
    const { p, input } = await fixture();
    const draft = await service.create(p, input);
    await Promise.all([service.confirm(p, draft.id, 1), service.confirm(p, draft.id, 1)]);
    expect((await service.get(p, draft.id)).tasks).toHaveLength(1);
    const edited = await service.edit(p, draft.id, 1, {
      ...input,
      caption: "changed",
      captions: { [input.accountIds[0]!]: "changed" },
    });
    expect(edited.confirmedAt).toBeNull();
    expect(edited.revision).toBe(2);
    expect(edited.tasks[0]!.state).toBe("cancelled");
    await expect(service.confirm(p, draft.id, 1)).rejects.toMatchObject({ status: 409 });
  });
  it("scopes reads, edits, confirmation, actions and file/account references to both owners", async () => {
    const { p, input } = await fixture();
    const other = await seedOrg(db, "foreign");
    const draft = await service.create(p, input);
    await service.confirm(p, draft.id, 1);
    const task = (await service.get(p, draft.id)).tasks[0]!;
    for (const foreign of [
      { ...p, userId: other.userId },
      { ...p, orgId: other.orgId },
    ]) {
      await expect(service.get(foreign, draft.id)).rejects.toMatchObject({ status: 404 });
      await expect(service.confirm(foreign, draft.id, 1)).rejects.toMatchObject({ status: 404 });
      await expect(service.action(foreign, task.id, 1, "cancel")).rejects.toMatchObject({
        status: 404,
      });
      await expect(service.create(foreign, input)).rejects.toMatchObject({ status: 400 });
    }
  });
  it("uncertain writes cannot retry, cancel or change their confirmed revision", async () => {
    const { p, input } = await fixture();
    const draft = await service.create(p, input);
    const confirmed = await service.confirm(p, draft.id, 1);
    const task = confirmed.tasks[0]!;
    await db
      .update(schema.socialPublishTasks)
      .set({ state: "uncertain" })
      .where(eq(schema.socialPublishTasks.id, task.id));
    await expect(service.action(p, task.id, 1, "retry")).rejects.toMatchObject({ status: 409 });
    await expect(service.action(p, task.id, 1, "cancel")).rejects.toMatchObject({ status: 409 });
    await expect(service.edit(p, draft.id, 1, input)).rejects.toMatchObject({ status: 409 });
    await db
      .update(schema.socialPublishTasks)
      .set({ state: "published" })
      .where(eq(schema.socialPublishTasks.id, task.id));
    await expect(service.edit(p, draft.id, 1, input)).rejects.toMatchObject({ status: 409 });
  });
  it("reclaims interrupted writes for reconciliation without republishing", async () => {
    const { p, input } = await fixture();
    const draft = await service.create(p, input);
    const confirmed = await service.confirm(p, draft.id, 1);
    const task = confirmed.tasks[0]!;
    await db
      .update(schema.socialPublishTasks)
      .set({ state: "publishing", updatedAt: new Date(Date.now() - 600000) })
      .where(eq(schema.socialPublishTasks.id, task.id));
    const accounts = new SocialConnectionService(
      db,
      {},
      { enabled: false, publicUrl: "https://example.invalid" },
    );
    const worker = new PublishingWorker(db, accounts, new FakeBlobStore());
    expect(await worker.due()).toContain(task.id);
    expect((await service.get(p, draft.id)).tasks[0]!.state).toBe("uncertain");
  });
  it("claims duplicate deliveries once and never blindly retries a timed-out publish", async () => {
    const { p, input } = await fixture();
    const draft = await service.create(p, input);
    const task = (await service.confirm(p, draft.id, 1)).tasks[0]!;
    let publishes = 0;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/media_publish")) {
        publishes++;
        throw new Error("timeout after accepting write");
      }
      if (path.endsWith("/media")) return Response.json({ id: "container" });
      return Response.json({ status_code: "FINISHED" });
    }) as unknown as typeof fetch;
    const provider = new InstagramProvider(
      { clientId: "test", clientSecret: "test", graphVersion: "v22.0" },
      { fetch: fetcher },
    );
    const accounts = {
      withAccountCredentials: async (_p: unknown, _id: string, fn: (a: unknown) => Promise<void>) =>
        fn({
          provider,
          providerAccountId: "owner",
          tokens: {
            accessToken: "test",
            scope: ["instagram_business_content_publish"],
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          },
        }),
    } as unknown as SocialConnectionService;
    const blobs = new FakeBlobStore();
    blobs.put(`org/${p.orgId}/test`, new Uint8Array([255, 216, 255]), "image/jpeg");
    const worker = new PublishingWorker(db, accounts, blobs);
    await Promise.all([worker.execute(task.id), worker.execute(task.id)]);
    expect(publishes).toBe(1);
    expect((await service.get(p, draft.id)).tasks[0]!.state).toBe("uncertain");
    await db
      .update(schema.socialPublishTasks)
      .set({ dueAt: new Date(0) })
      .where(eq(schema.socialPublishTasks.id, task.id));
    await new PublishingWorker(db, accounts, new FakeBlobStore()).execute(task.id);
    expect(publishes).toBe(1);
    expect((await service.get(p, draft.id)).tasks[0]!.state).toBe("uncertain");
  });
  it("scopes metrics and returns unavailable values rather than invented results", async () => {
    const { p, input } = await fixture();
    const draft = await service.create(p, input);
    const task = (await service.confirm(p, draft.id, 1)).tasks[0]!;
    expect(await service.metrics(p, task.id)).toEqual({
      postUrl: null,
      metrics: { views: null, likes: null, comments: null, shares: null },
    });
    const other = await seedOrg(db, "metrics-foreign");
    await expect(service.metrics({ ...p, userId: other.userId }, task.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.metrics({ ...p, orgId: other.orgId }, task.id)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("allows explicit failed-target retry but never retries published targets", async () => {
    const { p, input } = await fixture();
    const draft = await service.create(p, input);
    const task = (await service.confirm(p, draft.id, 1)).tasks[0]!;
    await db
      .update(schema.socialPublishTasks)
      .set({ state: "failed", remoteId: "expired-container", publishStartedAt: new Date() })
      .where(eq(schema.socialPublishTasks.id, task.id));
    const retried = await service.action(p, task.id, 1, "retry");
    expect(retried.tasks[0]!.state).toBe("queued");
    const [stored] = await db
      .select()
      .from(schema.socialPublishTasks)
      .where(eq(schema.socialPublishTasks.id, task.id));
    expect(stored!.remoteId).toBeNull();
    expect(stored!.publishStartedAt).toBeNull();
    await db
      .update(schema.socialPublishTasks)
      .set({ state: "published" })
      .where(eq(schema.socialPublishTasks.id, task.id));
    await expect(service.action(p, task.id, 1, "retry")).rejects.toMatchObject({ status: 409 });
  });
  it("rejects absent caption, local file lists and ambiguous schedule times", () => {
    const valid = {
      threadId: "t",
      caption: "a",
      captions: { a: "a" },
      accountIds: ["a"],
      mediaFileIds: ["f"],
      scheduledAt: "2026-11-01T05:30:00Z",
      timezone: "America/Toronto",
    };
    expect(() => validateDraft(valid)).not.toThrow();
    expect(() => validateDraft({ ...valid, scheduledAt: "2026-11-01T01:30:00" })).toThrow();
    expect(() => validateDraft({ ...valid, timezone: "bad/zone" })).toThrow();
    expect(() => validateDraft({ ...valid, captions: {} })).toThrow();
  });
});
