import { eq, inArray } from "drizzle-orm";
import { FakeBlobStore } from "@djl/api/blobs";
import { createDatabase, schema } from "@djl/db";
import { afterAll, describe, expect, it } from "vitest";

import { purgeDeletedConversations } from "./jobs.ts";

const conn = createDatabase(process.env.DATABASE_URL ?? "postgres://djl:djl@localhost:54329/djl", {
  max: 2,
});
afterAll(() => conn.close());

const DAY = 86_400_000;

describe("chat purge", () => {
  it("hard-deletes conversations deleted over 30 days ago with the files only they use", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const [user] = await conn.db
      .insert(schema.user)
      .values({ name: "purge", email: `purge-${suffix}@test.invalid`, emailVerified: true })
      .returning();
    const [org] = await conn.db
      .insert(schema.organization)
      .values({ name: "purge", slug: `purge-${suffix}`, createdAt: new Date() })
      .returning();
    const owner = { orgId: org!.id, userId: user!.id };
    const blobs = new FakeBlobStore();
    const file = async (name: string) => {
      const id = crypto.randomUUID();
      const storageKey = `org/${owner.orgId}/files/${id}`;
      blobs.put(storageKey, new Uint8Array([1]));
      await conn.db.insert(schema.files).values({
        id,
        ...owner,
        name,
        mimeType: "text/plain",
        sizeBytes: 1,
        storageKey,
        status: "ready",
      });
      return { id, storageKey };
    };
    const conversation = async (deletedDaysAgo: number | null, fileIds: string[]) => {
      const [c] = await conn.db
        .insert(schema.conversations)
        .values({
          ...owner,
          deletedAt: deletedDaysAgo === null ? null : new Date(Date.now() - deletedDaysAgo * DAY),
        })
        .returning();
      await conn.db.insert(schema.messages).values({
        conversationId: c!.id,
        role: "user",
        parts: fileIds.map((fileId) => ({
          type: "file_ref",
          fileId,
          name: "f",
          mimeType: "text/plain",
          size: 1,
        })),
      });
      return c!.id;
    };
    const only = await file("only-in-old");
    const shared = await file("also-in-live");
    const old = await conversation(31, [only.id, shared.id]);
    const recent = await conversation(10, []);
    const live = await conversation(null, [shared.id]);

    expect(await purgeDeletedConversations({ db: conn.db, blobs })).toBeGreaterThanOrEqual(1);

    const left = await conn.db
      .select({ id: schema.conversations.id })
      .from(schema.conversations)
      .where(inArray(schema.conversations.id, [old, recent, live]));
    expect(left.map((c) => c.id).toSorted()).toEqual([recent, live].toSorted());
    expect(
      await conn.db.select().from(schema.messages).where(eq(schema.messages.conversationId, old)),
    ).toEqual([]);
    const files = await conn.db
      .select({ id: schema.files.id })
      .from(schema.files)
      .where(inArray(schema.files.id, [only.id, shared.id]));
    expect(files.map((f) => f.id)).toEqual([shared.id]);
    expect(blobs.objects.has(only.storageKey)).toBe(false);
    expect(blobs.objects.has(shared.storageKey)).toBe(true);
  });
});
