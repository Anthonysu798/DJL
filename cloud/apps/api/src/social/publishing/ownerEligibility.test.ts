import { afterAll, expect, it, vi } from "vitest";
import { schema } from "@djl/db";
import { eq } from "drizzle-orm";
import { seedOrg, testDatabase } from "../../testing/db.ts";
import { PublishingService } from "./PublishingService.ts";
import { PublishingWorker } from "./PublishingWorker.ts";
import type { SocialConnectionService } from "../SocialConnectionService.ts";
import { FakeBlobStore } from "../../sync/BlobStore.ts";
const { db, close } = testDatabase();
afterAll(close);
it("does not publish for a suspended owner who still belongs to the organization", async () => {
  const owner = await seedOrg(db, "suspended-publisher");
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
  const [file] = await db
    .insert(schema.files)
    .values({
      ...owner,
      name: "image.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      sha256: "fixture",
      purpose: "image",
      storageKey: `org/${owner.orgId}/files/fixture`,
      status: "ready",
    })
    .returning();
  const service = new PublishingService(db);
  const draft = await service.create(owner, {
    threadId: "thread",
    caption: "fixture",
    captions: { [account!.id]: "fixture" },
    accountIds: [account!.id],
    mediaFileIds: [file!.id],
    scheduledAt: new Date(Date.now() - 1000).toISOString(),
    timezone: "UTC",
  });
  const task = (await service.confirm(owner, draft.id, 1)).tasks[0]!;
  await db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, owner.userId));
  const withAccountCredentials = vi.fn().mockResolvedValue(undefined);
  const worker = new PublishingWorker(
    db,
    { withAccountCredentials } as unknown as SocialConnectionService,
    new FakeBlobStore(),
  );
  await worker.execute(task.id);
  expect(withAccountCredentials).not.toHaveBeenCalled();
  expect((await service.get(owner, draft.id)).tasks[0]).toMatchObject({
    state: "failed",
    errorCode: "owner_unavailable",
  });
  // A previously uncertain provider write remains uncertain, never converted into a retryable failure.
  await db
    .update(schema.socialPublishTasks)
    .set({ state: "uncertain", dueAt: new Date(0), publishStartedAt: new Date() })
    .where(eq(schema.socialPublishTasks.id, task.id));
  await worker.execute(task.id);
  expect(withAccountCredentials).not.toHaveBeenCalled();
  expect((await service.get(owner, draft.id)).tasks[0]).toMatchObject({
    state: "uncertain",
    errorCode: "owner_unavailable",
  });
});
