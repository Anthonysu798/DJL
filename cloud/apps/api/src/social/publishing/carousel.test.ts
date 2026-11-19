import { afterAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { seedOrg, testDatabase } from "../../testing/db.ts";
import { PublishingService, validateDraft } from "./PublishingService.ts";
import { PublishingWorker } from "./PublishingWorker.ts";
import { InstagramProvider } from "../providers/index.ts";
import type { SocialConnectionService } from "../SocialConnectionService.ts";
import { FakeBlobStore } from "../../sync/BlobStore.ts";
const { db, close } = testDatabase();
afterAll(close);
async function fixture() {
  const owner = await seedOrg(db, "carousel");
  const [account] = await db
    .insert(schema.socialAccounts)
    .values({
      ...owner,
      provider: "instagram",
      providerAccountId: "fixture",
      username: "fixture",
      displayName: "Fixture",
      scopes: [],
      capabilities: { publish: true, metrics: false },
      status: "connected",
      expiresAt: new Date(Date.now() + 3600000),
    })
    .returning();
  const blobs = new FakeBlobStore();
  const files = [];
  for (let index = 0; index < 3; index++) {
    const bytes = new Uint8Array([255, 216, 255, index]);
    const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
    const storageKey = `org/${owner.orgId}/files/${index}`;
    const [file] = await db
      .insert(schema.files)
      .values({
        ...owner,
        name: `${index}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: bytes.length,
        sha256,
        purpose: "image",
        storageKey,
        status: "ready",
      })
      .returning();
    blobs.put(storageKey, bytes, "image/jpeg");
    files.push(file!);
  }
  const service = new PublishingService(db);
  const input = {
    threadId: "thread",
    caption: "approved",
    captions: { [account!.id]: "approved" },
    accountIds: [account!.id],
    mediaFileIds: [files[2]!.id, files[0]!.id, files[1]!.id],
    publicationMode: "now" as const,
    scheduledAt: new Date(0).toISOString(),
    timezone: "UTC",
  };
  const draft = await service.create(owner, input);
  const task = (await service.confirm(owner, draft.id, 1)).tasks[0]!;
  const writes: Record<string, unknown>[] = [];
  let failAt = -1;
  let childrenProcessing = false;
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/media")) {
      const body = JSON.parse(String(init?.body));
      writes.push(body);
      if (writes.length === failAt) throw new Error("timeout after acceptance");
      return Response.json({
        id: body.media_type === "CAROUSEL" ? "parent" : `child-${writes.length}`,
      });
    }
    if (String(url).endsWith("/media_publish")) {
      writes.push(JSON.parse(String(init?.body)));
      if (writes.length === failAt) throw new Error("publish accepted without response");
      return Response.json({ id: "post" });
    }
    return Response.json({
      status_code:
        childrenProcessing && String(url).includes("/child-") ? "IN_PROGRESS" : "FINISHED",
    });
  }) as unknown as typeof fetch;
  const provider = new InstagramProvider(
    { clientId: "fixture", clientSecret: "fixture", graphVersion: "v25.0" },
    { fetch: fetcher },
  );
  const accounts = {
    withAccountCredentials: async (
      _scope: unknown,
      _id: string,
      use: (value: unknown) => Promise<void>,
    ) =>
      use({
        provider,
        providerAccountId: "fixture",
        tokens: {
          accessToken: "fixture",
          scope: ["instagram_business_content_publish"],
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      }),
  } as unknown as SocialConnectionService;
  const worker = new PublishingWorker(db, accounts, blobs);
  const stored = async () =>
    (
      await db
        .select()
        .from(schema.socialPublishTasks)
        .where(eq(schema.socialPublishTasks.id, task.id))
    )[0]!;
  const retryReconcile = async () => {
    await db
      .update(schema.socialPublishTasks)
      .set({ dueAt: new Date(0), state: "uncertain" })
      .where(eq(schema.socialPublishTasks.id, task.id));
    await worker.execute(task.id);
  };
  return {
    owner,
    files,
    blobs,
    service,
    input,
    draft,
    task,
    writes,
    worker,
    stored,
    retryReconcile,
    setChildrenProcessing: (processing: boolean) => {
      childrenProcessing = processing;
    },
    setFailAt: (n: number) => {
      failAt = n;
    },
  };
}
it("preserves confirmed order and snapshots every JPEG before creating children and publishing the parent once", async () => {
  const f = await fixture();
  await Promise.all([f.worker.execute(f.task.id), f.worker.execute(f.task.id)]);
  expect((await f.stored()).state).toBe("published");
  expect(f.writes).toHaveLength(5);
  for (const [index, body] of f.writes.slice(0, 3).entries()) {
    expect(body.is_carousel_item).toBe(true);
    expect(body.caption).toBeUndefined();
    const key = decodeURIComponent(new URL(String(body.image_url)).pathname.slice(1));
    const bytes = await f.blobs.read(key);
    expect(bytes?.[3]).toBe([2, 0, 1][index]);
    expect(key).toContain(`/social-publish/${f.task.id}/`);
  }
  expect(f.writes[3]).toMatchObject({
    media_type: "CAROUSEL",
    children: "child-1,child-2,child-3",
    caption: "approved",
  });
  expect(f.writes[4]).toMatchObject({ creation_id: "parent" });
  await f.retryReconcile();
  expect(f.writes).toHaveLength(5);
});
it("waits for every child then resumes without recreating completed children", async () => {
  const f = await fixture();
  f.setChildrenProcessing(true);
  await f.worker.execute(f.task.id);
  expect((await f.stored()).state).toBe("uncertain");
  expect(f.writes).toHaveLength(3);
  f.setChildrenProcessing(false);
  await f.retryReconcile();
  expect(f.writes).toHaveLength(5);
  expect((await f.stored()).state).toBe("published");
});
it("reconciles a lost parent publication response without publishing the carousel twice", async () => {
  const f = await fixture();
  f.setFailAt(5);
  await f.worker.execute(f.task.id);
  const stored = await f.stored();
  expect(stored.state).toBe("uncertain");
  expect(stored.publishStartedAt).not.toBeNull();
  expect(JSON.parse(stored.remoteId!).parentId).toBe("parent");
  await f.retryReconcile();
  expect(f.writes).toHaveLength(5);
  expect((await f.stored()).state).toBe("uncertain");
});
it.each([2, 4])(
  "persists child receipts and an unknown-write marker when request %i times out; never blindly retries",
  async (at) => {
    const f = await fixture();
    f.setFailAt(at);
    await f.worker.execute(f.task.id);
    const task = await f.stored();
    expect(task.state).toBe("uncertain");
    const receipt = JSON.parse(task.remoteId!);
    expect(receipt.pending).toBe(true);
    expect(receipt.children).toHaveLength(at === 2 ? 1 : 3);
    await f.retryReconcile();
    expect(f.writes).toHaveLength(at);
    expect((await f.stored()).errorCode).toBe("manual_reconciliation_required");
  },
);
it("resumes a durably completed child stage using snapshots when original files have changed", async () => {
  const f = await fixture();
  // Simulate process death immediately after the first child receipt was persisted.
  const snapshots = [];
  for (const fileId of f.input.mediaFileIds) {
    const file = f.files.find((r) => r.id === fileId)!;
    const key = `org/${f.owner.orgId}/social-publish/${f.task.id}/${file.sha256}`;
    await f.blobs.write(key, (await f.blobs.read(file.storageKey))!, file.mimeType);
    snapshots.push({
      key,
      mimeType: file.mimeType,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
    });
    f.blobs.put(file.storageKey, new Uint8Array([255, 216, 255, 99]), file.mimeType);
  }
  await db
    .update(schema.socialPublishTasks)
    .set({
      state: "uncertain",
      remoteId: JSON.stringify({
        kind: "instagram-carousel-v1",
        snapshots,
        children: ["saved-child"],
        pending: false,
      }),
    })
    .where(eq(schema.socialPublishTasks.id, f.task.id));
  await f.worker.execute(f.task.id);
  expect((await f.stored()).state).toBe("published");
  expect(f.writes.filter((b) => b.is_carousel_item)).toHaveLength(2);
  expect(f.writes.find((b) => b.media_type === "CAROUSEL")?.children).toBe(
    "saved-child,child-1,child-2",
  );
});
it("checks the later item's ownership, deletion, digest and mixed-media status before any provider write", async () => {
  for (const mutation of ["foreign", "deleted", "digest", "video"]) {
    const f = await fixture();
    const file = f.files[1]!;
    if (mutation === "foreign") {
      const other = await seedOrg(db, "other-carousel");
      await db
        .update(schema.files)
        .set({ userId: other.userId })
        .where(eq(schema.files.id, file.id));
    } else if (mutation === "deleted")
      await db
        .update(schema.files)
        .set({ deletedAt: new Date() })
        .where(eq(schema.files.id, file.id));
    else if (mutation === "video")
      await db
        .update(schema.files)
        .set({ mimeType: "video/mp4" })
        .where(eq(schema.files.id, file.id));
    else f.blobs.put(file.storageKey, new Uint8Array([255, 216, 255, 99]), "image/jpeg");
    await f.worker.execute(f.task.id);
    expect((await f.stored()).state).toBe("failed");
    expect(f.writes).toHaveLength(0);
  }
});
it("rejects duplicate/over-limit files and invalid covers; reordered drafts invalidate old confirmation", async () => {
  const f = await fixture();
  expect(() =>
    validateDraft({ ...f.input, mediaFileIds: [f.files[0]!.id, f.files[0]!.id] }),
  ).toThrow();
  expect(() =>
    validateDraft({ ...f.input, mediaFileIds: Array.from({ length: 36 }, (_, i) => String(i)) }),
  ).toThrow();
  const extra = await db
    .insert(schema.files)
    .values(
      Array.from({ length: 11 }, (_, index) => ({
        ...f.owner,
        name: `extra-${index}.jpg`,
        mimeType: "image/jpeg",
        sizeBytes: 4,
        sha256: f.files[0]!.sha256,
        purpose: "image" as const,
        storageKey: `org/${f.owner.orgId}/extra-${index}`,
        status: "ready" as const,
      })),
    )
    .returning();
  await expect(
    f.service.create(f.owner, { ...f.input, mediaFileIds: extra.map((file) => file.id) }),
  ).rejects.toMatchObject({ code: "media_limit" });
  const options = {
    privacyLevel: "SELF_ONLY",
    disableDuet: false,
    disableStitch: false,
    disableComment: false,
    brandContent: false,
    brandOrganic: false,
    isAigc: false,
    musicUsageConfirmed: true,
  };
  for (const photoCoverIndex of [-1, 3, 0.5])
    expect(() =>
      validateDraft({ ...f.input, tiktokOptions: { ...options, photoCoverIndex } }),
    ).toThrow();
  await db
    .update(schema.files)
    .set({ mimeType: "video/mp4" })
    .where(eq(schema.files.id, extra[0]!.id));
  await expect(
    f.service.create(f.owner, {
      ...f.input,
      mediaFileIds: extra.slice(0, 2).map((file) => file.id),
    }),
  ).rejects.toMatchObject({ code: "media_unsupported" });
  await f.service.edit(f.owner, f.draft.id, 1, {
    ...f.input,
    mediaFileIds: f.input.mediaFileIds.toReversed(),
  });
  await expect(f.service.confirm(f.owner, f.draft.id, 1)).rejects.toMatchObject({ status: 409 });
});
