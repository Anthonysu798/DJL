import { afterAll, describe, expect, it, vi } from "vitest";
import { schema } from "@djl/db";
import { eq } from "drizzle-orm";
import { seedOrg, testDatabase } from "../../testing/db.ts";
import { FakeBlobStore } from "../../sync/BlobStore.ts";
import type { SocialConnectionService } from "../SocialConnectionService.ts";
import { TikTokProvider } from "../providers/index.ts";
import { PublishingService } from "./PublishingService.ts";
import { PublishingWorker } from "./PublishingWorker.ts";

const { db, close } = testDatabase();
afterAll(close);
const approved = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdAAr/2Q==",
  "base64",
);
const tiktokOptions = {
  privacyLevel: "SELF_ONLY",
  disableDuet: false,
  disableStitch: false,
  disableComment: false,
  brandContent: false,
  brandOrganic: false,
  isAigc: true,
  musicUsageConfirmed: true,
};
function box(type: string, ...parts: Uint8Array[]) {
  const bytes = new Uint8Array(8 + parts.reduce((n, p) => n + p.length, 0));
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  bytes.set(new TextEncoder().encode(type), 4);
  let at = 8;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}
// One 12-second AVC track plus an isom file-type box; metadata fixture, not a playable video.
function video() {
  const header = new Uint8Array(20);
  new DataView(header.buffer).setUint32(12, 1000);
  new DataView(header.buffer).setUint32(16, 12000);
  const samples = new Uint8Array(8);
  new DataView(samples.buffer).setUint32(4, 1);
  const type = box("ftyp", new TextEncoder().encode("isom"), new Uint8Array(4));
  const movie = box(
    "moov",
    box("mvhd", header),
    box("trak", box("mdia", box("minf", box("stbl", box("stsd", samples, box("avc1")))))),
  );
  const bytes = new Uint8Array(type.length + movie.length);
  bytes.set(type);
  bytes.set(movie, type.length);
  return bytes;
}
async function fixture(mimeType = "image/jpeg", media: Uint8Array = approved) {
  const p = await seedOrg(db, "tiktok-photo");
  const [account] = await db
    .insert(schema.socialAccounts)
    .values({
      ...p,
      provider: "tiktok",
      providerAccountId: "creator",
      username: "creator",
      displayName: "Creator",
      scopes: ["video.publish"],
      capabilities: { publish: true, metrics: false },
      status: "connected",
      expiresAt: new Date(Date.now() + 3600000),
    })
    .returning();
  const storageKey = `org/${p.orgId}/files/approved`;
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", media as BufferSource)).toString(
    "hex",
  );
  const [file] = await db
    .insert(schema.files)
    .values({
      ...p,
      name: "approved-media",
      mimeType,
      sizeBytes: media.length,
      sha256: digest,
      purpose: mimeType === "video/mp4" ? "video" : "image",
      storageKey,
      status: "ready",
    })
    .returning();
  const blobs = new FakeBlobStore();
  blobs.put(storageKey, media, mimeType);
  let commentDisabled = false;
  let timedOut = false;
  let writes = 0;
  let queries = 0;
  let downloaded: Uint8Array | null = null;
  let writeBody: Record<string, unknown> | undefined;
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith("/creator_info/query/")) {
      queries++;
      return Response.json({
        data: {
          creator_username: "creator",
          creator_nickname: "Creator",
          privacy_level_options: ["SELF_ONLY"],
          duet_disabled: true,
          stitch_disabled: true,
          comment_disabled: commentDisabled,
          max_video_post_duration_sec: 60,
        },
        error: { code: "ok" },
      });
    }
    if (String(url).endsWith("/content/init/") || String(url).endsWith("/video/init/")) {
      writes++;
      const body = JSON.parse(String(init?.body));
      writeBody = body;
      const mediaUrl = new URL(body.source_info.photo_images?.[0] ?? body.source_info.video_url);
      downloaded = await blobs.read(decodeURIComponent(mediaUrl.pathname.slice(1)));
      if (timedOut) throw new Error("accepted write lost receipt");
      return Response.json({ data: { publish_id: "receipt" }, error: { code: "ok" } });
    }
    if (String(url).endsWith("/status/fetch/"))
      return Response.json({
        data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["photo-post"] },
        error: { code: "ok" },
      });
    throw new Error("unexpected endpoint");
  }) as unknown as typeof fetch;
  const provider = new TikTokProvider(
    { clientKey: "fixture", clientSecret: "fixture" },
    { fetch: fetcher },
  );
  const connections = {
    withAccountCredentials: async (
      _p: unknown,
      _id: string,
      use: (a: unknown) => Promise<unknown>,
    ) =>
      use({
        provider,
        providerAccountId: "creator",
        tokens: {
          accessToken: "fixture",
          scope: ["video.publish"],
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      }),
  } as unknown as SocialConnectionService;
  const service = new PublishingService(db, blobs, connections);
  const worker = new PublishingWorker(db, connections, blobs);
  const input = {
    threadId: "thread",
    caption: "approved",
    captions: { [account!.id]: "approved" },
    accountIds: [account!.id],
    mediaFileIds: [file!.id],
    tiktokOptions: {
      ...tiktokOptions,
      disableDuet: mimeType === "video/mp4",
      disableStitch: mimeType === "video/mp4",
    },
    publicationMode: "now" as const,
    scheduledAt: new Date(Date.now() - 1000).toISOString(),
    timezone: "UTC",
  };
  return {
    p,
    input,
    service,
    worker,
    blobs,
    storageKey,
    digest,
    fileId: file!.id,
    setCommentsDisabled: () => {
      commentDisabled = true;
    },
    setTimeout: () => {
      timedOut = true;
    },
    stats: () => ({ writes, queries, downloaded, writeBody }),
  };
}
describe("TikTok JPEG durable publishing", () => {
  it.each([false, true])(
    "publishes an ordered JPEG carousel with selected cover once, including timeout=%j",
    async (timeout) => {
      const f = await fixture();
      const files = [{ id: f.fileId, sha256: f.digest }];
      for (const width of [2, 3]) {
        const bytes = Uint8Array.from(approved);
        const frame = bytes.findIndex((byte, index) => byte === 255 && bytes[index + 1] === 192);
        new DataView(bytes.buffer).setUint16(frame + 7, width);
        const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
        const storageKey = `org/${f.p.orgId}/files/${width}`;
        const [file] = await db
          .insert(schema.files)
          .values({
            ...f.p,
            name: `${width}.jpg`,
            mimeType: "image/jpeg",
            sizeBytes: bytes.length,
            sha256,
            purpose: "image",
            storageKey,
            status: "ready",
          })
          .returning();
        f.blobs.put(storageKey, bytes, "image/jpeg");
        files.push({ id: file!.id, sha256 });
      }
      const ordered = [files[2]!, files[0]!, files[1]!];
      const draft = await f.service.create(f.p, {
        ...f.input,
        mediaFileIds: ordered.map((file) => file.id),
        tiktokOptions: { ...f.input.tiktokOptions, photoCoverIndex: 2 },
      });
      const task = (await f.service.confirm(f.p, draft.id, 1)).tasks[0]!;
      if (timeout) f.setTimeout();
      await f.worker.execute(task.id);
      const source = f.stats().writeBody!.source_info as {
        photo_images: string[];
        photo_cover_index: number;
      };
      expect(source.photo_cover_index).toBe(2);
      expect(
        source.photo_images.map((url) => decodeURIComponent(new URL(url).pathname.slice(1))),
      ).toEqual(ordered.map((file) => `org/${f.p.orgId}/social-publish/${task.id}/${file.sha256}`));
      expect(f.stats().writes).toBe(1);
      expect((await f.service.get(f.p, draft.id)).tasks[0]!.state).toBe(
        timeout ? "uncertain" : "published",
      );
      if (timeout) {
        await db
          .update(schema.socialPublishTasks)
          .set({ dueAt: new Date(0) })
          .where(eq(schema.socialPublishTasks.id, task.id));
        await f.worker.execute(task.id);
        expect(f.stats().writes).toBe(1);
        expect((await f.service.get(f.p, draft.id)).tasks[0]!.errorCode).toBe(
          "manual_reconciliation_required",
        );
      }
    },
  );
  it("keeps MP4 publishing on its video endpoint and applies the video caption limit", async () => {
    const media = video();
    const f = await fixture("video/mp4", media);
    const draft = await f.service.create(f.p, f.input);
    const task = (await f.service.confirm(f.p, draft.id, 1)).tasks[0]!;
    await f.worker.execute(task.id);
    expect(f.stats().downloaded).toEqual(media);
    expect(f.stats().writeBody).toMatchObject({ post_info: { title: "approved" } });
    expect(f.stats().writeBody).not.toHaveProperty("media_type");
    expect((await f.service.get(f.p, draft.id)).tasks[0]!.state).toBe("published");
    await expect(
      f.service.create(f.p, {
        ...f.input,
        captions: { [f.input.accountIds[0]!]: "a".repeat(2201) },
      }),
    ).rejects.toMatchObject({ code: "invalid_draft" });
  });
  it("keeps Instagram's caption limit when a photo targets both providers", async () => {
    const f = await fixture();
    const [instagram] = await db
      .insert(schema.socialAccounts)
      .values({
        ...f.p,
        provider: "instagram",
        providerAccountId: "instagram",
        username: "instagram",
        displayName: "Instagram",
        scopes: [],
        capabilities: { publish: true, metrics: false },
        status: "connected",
        expiresAt: new Date(Date.now() + 3600000),
      })
      .returning();
    const caption = "a".repeat(2201);
    const input = {
      ...f.input,
      caption,
      accountIds: [...f.input.accountIds, instagram!.id],
      captions: { [f.input.accountIds[0]!]: caption, [instagram!.id]: caption },
    };
    await expect(f.service.create(f.p, input)).rejects.toMatchObject({ code: "invalid_draft" });
    const accepted = await f.service.create(f.p, {
      ...input,
      captions: { ...input.captions, [instagram!.id]: "short Instagram caption" },
    });
    expect(accepted.confirmedAt).toBeNull();
    expect(accepted.tasks).toHaveLength(0);
  });
  it("prepares and confirms a photo with current creator permissions, then posts only the verified snapshot", async () => {
    const f = await fixture();
    const caption = "😀".repeat(2000);
    const draft = await f.service.create(f.p, {
      ...f.input,
      caption,
      captions: { [f.input.accountIds[0]!]: caption },
    });
    expect(draft.tasks).toHaveLength(0);
    expect(draft.confirmedAt).toBeNull();
    expect(f.stats().queries).toBe(1);
    const task = (await f.service.confirm(f.p, draft.id, 1)).tasks[0]!;
    expect(f.stats().queries).toBe(2);
    const sign = f.blobs.presignDownload.bind(f.blobs);
    vi.spyOn(f.blobs, "presignDownload").mockImplementation(async (key, seconds) => {
      f.blobs.put(f.storageKey, new Uint8Array([255, 216, 255, 1]), "image/jpeg");
      return sign(key, seconds);
    });
    await Promise.all([f.worker.execute(task.id), f.worker.execute(task.id)]);
    expect(f.stats().writes).toBe(1);
    expect(f.stats().downloaded).toEqual(approved);
    expect(f.stats().writeBody).toMatchObject({
      post_info: { description: caption },
      media_type: "PHOTO",
    });
    expect((await f.service.get(f.p, draft.id)).tasks[0]).toMatchObject({
      state: "published",
      postId: "photo-post",
    });
    expect(await f.blobs.read(`org/${f.p.orgId}/social-publish/${task.id}/${f.digest}`)).toEqual(
      approved,
    );
  });
  it("rejects changed creator permissions at confirmation and before the worker write", async () => {
    const f = await fixture();
    const draft = await f.service.create(f.p, f.input);
    f.setCommentsDisabled();
    await expect(f.service.confirm(f.p, draft.id, 1)).rejects.toMatchObject({
      code: "invalid_tiktok_options",
    });
    expect((await f.service.get(f.p, draft.id)).tasks).toHaveLength(0);
    const g = await fixture();
    const ready = await g.service.create(g.p, g.input);
    const task = (await g.service.confirm(g.p, ready.id, 1)).tasks[0]!;
    g.setCommentsDisabled();
    await g.worker.execute(task.id);
    expect(g.stats().writes).toBe(0);
    expect((await g.service.get(g.p, ready.id)).tasks[0]!.state).toBe("failed");
  });
  it("rejects changed JPEG bytes before writing to TikTok", async () => {
    const f = await fixture();
    const draft = await f.service.create(f.p, f.input);
    const task = (await f.service.confirm(f.p, draft.id, 1)).tasks[0]!;
    f.blobs.put(f.storageKey, new Uint8Array([255, 216, 255]), "image/jpeg");
    await f.worker.execute(task.id);
    expect(f.stats().writes).toBe(0);
    expect((await f.service.get(f.p, draft.id)).tasks[0]).toMatchObject({
      state: "failed",
      errorCode: "media_changed",
    });
  });
  it("keeps missing receipts uncertain and never republishes on reconciliation", async () => {
    const f = await fixture();
    const draft = await f.service.create(f.p, f.input);
    const task = (await f.service.confirm(f.p, draft.id, 1)).tasks[0]!;
    f.setTimeout();
    await f.worker.execute(task.id);
    expect((await f.service.get(f.p, draft.id)).tasks[0]!.state).toBe("uncertain");
    await db
      .update(schema.socialPublishTasks)
      .set({ dueAt: new Date(0) })
      .where(eq(schema.socialPublishTasks.id, task.id));
    await f.worker.execute(task.id);
    expect(f.stats().writes).toBe(1);
    expect((await f.service.get(f.p, draft.id)).tasks[0]!.state).toBe("uncertain");
    await expect(f.service.action(f.p, task.id, 1, "retry")).rejects.toMatchObject({ status: 409 });
  });
  it("rejects uninspectable JPEGs and overlong photo descriptions before creating a draft", async () => {
    const f = await fixture();
    f.blobs.put(f.storageKey, new Uint8Array([255, 216, 255]), "image/jpeg");
    await expect(f.service.create(f.p, f.input)).rejects.toMatchObject({
      code: "media_inspection_required",
    });
    const g = await fixture();
    await expect(
      g.service.create(g.p, {
        ...g.input,
        captions: { [g.input.accountIds[0]!]: "a".repeat(4001) },
      }),
    ).rejects.toMatchObject({ code: "invalid_draft" });
  });
});
