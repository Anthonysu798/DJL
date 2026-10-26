import { afterAll, describe, expect, it, vi } from "vitest";
import { schema } from "@djl/db";
import { seedOrg, testDatabase } from "../../testing/db.ts";
import { PublishingService } from "./PublishingService.ts";
import { PublishingWorker } from "./PublishingWorker.ts";
import type { SocialConnectionService } from "../SocialConnectionService.ts";
import { InstagramProvider } from "../providers/index.ts";
import { FakeBlobStore } from "../../sync/BlobStore.ts";
const { db, close } = testDatabase();
afterAll(close);

// Real database/service/worker state transitions; every provider response is an injected fixture.
describe("multi-target publication fixture", () => {
  it("keeps successful and failed targets separate and retries only the explicitly failed target", async () => {
    const owner = await seedOrg(db, "partial-publication");
    const inserted = await db
      .insert(schema.socialAccounts)
      .values(
        ["first", "second"].map((name) => ({
          userId: owner.userId,
          orgId: owner.orgId,
          provider: "instagram" as const,
          providerAccountId: name,
          username: name,
          displayName: name,
          scopes: ["instagram_business_content_publish"],
          capabilities: { publish: true, metrics: false },
          status: "connected" as const,
          expiresAt: new Date(Date.now() + 3600000),
        })),
      )
      .returning();
    const first = inserted.find((account) => account.providerAccountId === "first")!;
    const second = inserted.find((account) => account.providerAccountId === "second")!;
    const bytes = new Uint8Array([255, 216, 255]);
    const key = `org/${owner.orgId}/partial.jpg`;
    const [file] = await db
      .insert(schema.files)
      .values({
        ...owner,
        name: "partial.jpg",
        mimeType: "image/jpeg",
        sizeBytes: bytes.length,
        sha256: Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex"),
        purpose: "image",
        storageKey: key,
        status: "ready",
      })
      .returning();
    const blobs = new FakeBlobStore();
    blobs.put(key, bytes, "image/jpeg");
    let secondContainers = 0;
    const publishCalls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/first/media")) return Response.json({ id: "first-container" });
      if (url.endsWith("/second/media")) {
        secondContainers++;
        return Response.json({ id: `second-container-${secondContainers}` });
      }
      if (url.includes("second-container-1?fields=status_code"))
        return Response.json({ status_code: "ERROR" });
      if (url.includes("?fields=status_code")) return Response.json({ status_code: "FINISHED" });
      if (url.endsWith("/media_publish")) {
        const container = (JSON.parse(String(init?.body)) as { creation_id: string }).creation_id;
        publishCalls.push(container);
        return Response.json({ id: `post-${container}` });
      }
      throw new Error("Unexpected fixture request");
    }) as unknown as typeof fetch;
    const provider = new InstagramProvider(
      { clientId: "fixture", clientSecret: "fixture", graphVersion: "v25.0" },
      { fetch: fetcher },
    );
    const connections = {
      withAccountCredentials: async (
        _owner: unknown,
        id: string,
        use: (value: unknown) => Promise<void>,
      ) =>
        use({
          provider,
          providerAccountId: id === first.id ? "first" : "second",
          tokens: {
            accessToken: "fixture-token",
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            scope: ["instagram_business_content_publish"],
          },
        }),
    } as unknown as SocialConnectionService;
    const service = new PublishingService(db);
    const draft = await service.create(owner, {
      threadId: "partial-thread",
      caption: "fixture",
      captions: { [first.id]: "first caption", [second.id]: "second caption" },
      accountIds: [first.id, second.id],
      mediaFileIds: [file!.id],
      scheduledAt: new Date(Date.now() - 1000).toISOString(),
      timezone: "America/Toronto",
    });
    const confirmed = await service.confirm(owner, draft.id, 1);
    const firstTask = confirmed.tasks.find((task) => task.accountId === first.id)!;
    const secondTask = confirmed.tasks.find((task) => task.accountId === second.id)!;
    const worker = new PublishingWorker(db, connections, blobs);
    await worker.execute(firstTask.id);
    await worker.execute(secondTask.id);
    const partial = await service.get(owner, draft.id);
    expect(partial.tasks.find((task) => task.id === firstTask.id)).toMatchObject({
      state: "published",
      postId: "post-first-container",
    });
    expect(partial.tasks.find((task) => task.id === secondTask.id)).toMatchObject({
      state: "failed",
      postId: null,
      errorCode: "provider_rejected",
    });
    expect(publishCalls).toEqual(["first-container"]);
    await expect(service.action(owner, firstTask.id, 1, "retry")).rejects.toMatchObject({
      status: 409,
    });
    await service.action(owner, secondTask.id, 1, "retry");
    await worker.execute(firstTask.id); // duplicate delivery of the successful target
    await worker.execute(secondTask.id);
    expect(publishCalls).toEqual(["first-container", "second-container-2"]);
    expect((await service.get(owner, draft.id)).tasks.map((task) => task.state)).toEqual([
      "published",
      "published",
    ]);
    expect(secondContainers).toBe(2);
  });
});
