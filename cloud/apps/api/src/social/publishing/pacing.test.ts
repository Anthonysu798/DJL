import { afterAll, describe, expect, it, vi } from "vitest";
import { schema } from "@djl/db";
import { eq } from "drizzle-orm";
import { seedOrg, testDatabase } from "../../testing/db.ts";
import { PublishingService } from "./PublishingService.ts";
import { PublishingWorker } from "./PublishingWorker.ts";
import type { SocialConnectionService } from "../SocialConnectionService.ts";
import { InstagramProvider } from "../providers/index.ts";
import { FakeBlobStore } from "../../sync/BlobStore.ts";
const { db, close } = testDatabase();
afterAll(close);
describe("durable per-account attempt pacing", () => {
  it("defers a concurrent same-account task without provider IO, then allows it after the interval", async () => {
    const owner = await seedOrg(db, "pacing");
    const [account] = await db
      .insert(schema.socialAccounts)
      .values({
        ...owner,
        provider: "instagram",
        providerAccountId: "fixture",
        username: "fixture",
        displayName: "fixture",
        scopes: [],
        capabilities: { publish: true, metrics: false },
        status: "connected",
        expiresAt: new Date(Date.now() + 3600000),
      })
      .returning();
    const bytes = new Uint8Array([255, 216, 255]);
    const key = `org/${owner.orgId}/pacing.jpg`;
    const [file] = await db
      .insert(schema.files)
      .values({
        ...owner,
        name: "pacing.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 3,
        sha256: Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex"),
        purpose: "image",
        storageKey: key,
        status: "ready",
      })
      .returning();
    const blobs = new FakeBlobStore();
    blobs.put(key, bytes, "image/jpeg");
    let publishes = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/media_publish")) {
        publishes++;
        return Response.json({ id: `post-${publishes}` });
      }
      if (String(input).endsWith("/media")) return Response.json({ id: "container" });
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
    const input = {
      threadId: "thread",
      caption: "fixture",
      captions: { [account!.id]: "fixture" },
      accountIds: [account!.id],
      mediaFileIds: [file!.id],
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
      timezone: "UTC",
    };
    const drafts = await Promise.all([service.create(owner, input), service.create(owner, input)]);
    const confirmed = await Promise.all(drafts.map((d) => service.confirm(owner, d.id, 1)));
    const ids = confirmed.map((d) => d.tasks[0]!.id);
    const worker = new PublishingWorker(db, connections, blobs);
    await Promise.all(ids.map((id) => worker.execute(id)));
    const rows = await Promise.all(
      ids.map(
        async (id) =>
          (
            await db
              .select()
              .from(schema.socialPublishTasks)
              .where(eq(schema.socialPublishTasks.id, id))
          )[0]!,
      ),
    );
    expect(rows.map((row) => row.state).toSorted()).toEqual(["published", "queued"]);
    expect(publishes).toBe(1);
    const deferred = rows.find((row) => row.state === "queued")!;
    const completed = rows.find((row) => row.state === "published")!;
    expect(deferred.attemptId).toBeNull();
    expect(deferred.dueAt.getTime()).toBeGreaterThan(Date.now());
    const calls = vi.mocked(fetcher).mock.calls.length;
    await worker.execute(deferred.id);
    expect(vi.mocked(fetcher).mock.calls).toHaveLength(calls);
    await db
      .update(schema.socialPublishTasks)
      .set({ updatedAt: new Date(Date.now() - 61000) })
      .where(eq(schema.socialPublishTasks.id, completed.id));
    await db
      .update(schema.socialPublishTasks)
      .set({ dueAt: new Date(0) })
      .where(eq(schema.socialPublishTasks.id, deferred.id));
    await worker.execute(deferred.id);
    expect(publishes).toBe(2);
  });
});
