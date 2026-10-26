import { afterAll, expect, it, vi } from "vitest";
import { schema } from "@djl/db";
import { seedOrg, testDatabase } from "../../testing/db.ts";
import { PublishingService } from "./PublishingService.ts";
import { PublishingWorker } from "./PublishingWorker.ts";
import type { SocialConnectionService } from "../SocialConnectionService.ts";
import { InstagramProvider } from "../providers/index.ts";
import { FakeBlobStore } from "../../sync/BlobStore.ts";
const { db, close } = testDatabase();
afterAll(close);
it("publishes verified snapshot bytes even if a still-valid client upload overwrites the original before provider download", async () => {
  const owner = await seedOrg(db, "snapshot-race");
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
  const approved = new Uint8Array([255, 216, 255, 1]);
  const replacement = new Uint8Array([255, 216, 255, 2]);
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", approved)).toString("hex");
  const originalKey = `org/${owner.orgId}/files/${crypto.randomUUID()}`;
  const [file] = await db
    .insert(schema.files)
    .values({
      ...owner,
      name: "approved.jpg",
      mimeType: "image/jpeg",
      sizeBytes: approved.length,
      sha256: digest,
      purpose: "image",
      storageKey: originalKey,
      status: "ready",
    })
    .returning();
  const blobs = new FakeBlobStore();
  blobs.put(originalKey, approved, "image/jpeg");
  const baseSign = blobs.presignDownload.bind(blobs);
  const signed = vi.spyOn(blobs, "presignDownload").mockImplementation(async (key, seconds) => {
    // Deterministically exercise the race after worker digest verification, before remote pull.
    blobs.put(originalKey, replacement, "image/jpeg");
    return baseSign(key, seconds);
  });
  let downloaded: Uint8Array | null = null;
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith("/media")) {
      const remote = new URL((JSON.parse(String(init?.body)) as { image_url: string }).image_url);
      downloaded = await blobs.read(decodeURIComponent(remote.pathname.slice(1)));
      return Response.json({ id: "container" });
    }
    if (String(input).endsWith("/media_publish")) return Response.json({ id: "fixture-post" });
    return Response.json({ status_code: "FINISHED" });
  }) as unknown as typeof fetch;
  const provider = new InstagramProvider(
    { clientId: "fixture", clientSecret: "fixture", graphVersion: "v25.0" },
    { fetch: fetcher },
  );
  const connections = {
    withAccountCredentials: async (
      _p: unknown,
      _id: string,
      use: (value: unknown) => Promise<void>,
    ) =>
      use({
        provider,
        providerAccountId: "fixture",
        tokens: {
          accessToken: "fixture",
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          scope: ["instagram_business_content_publish"],
        },
      }),
  } as unknown as SocialConnectionService;
  const service = new PublishingService(db);
  const draft = await service.create(owner, {
    threadId: "thread",
    caption: "approved",
    captions: { [account!.id]: "approved" },
    accountIds: [account!.id],
    mediaFileIds: [file!.id],
    scheduledAt: new Date(Date.now() - 1000).toISOString(),
    timezone: "UTC",
  });
  const task = (await service.confirm(owner, draft.id, 1)).tasks[0]!;
  await new PublishingWorker(db, connections, blobs).execute(task.id);
  expect(downloaded).toEqual(approved);
  expect(await blobs.read(originalKey)).toEqual(replacement);
  expect(signed).toHaveBeenCalledWith(
    `org/${owner.orgId}/social-publish/${task.id}/${digest}`,
    7200,
  );
  expect((await service.get(owner, draft.id)).tasks[0]!.state).toBe("published");
});
