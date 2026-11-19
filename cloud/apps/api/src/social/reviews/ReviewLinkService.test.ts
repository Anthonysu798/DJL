import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { schema } from "@djl/db";
import { and, eq } from "drizzle-orm";
import { seedOrg, testDatabase } from "../../testing/db.ts";
import { FakeBlobStore } from "../../sync/BlobStore.ts";
import { ReviewLinkService } from "./ReviewLinkService.ts";
const { db, close } = testDatabase();
afterAll(close);
async function fixture() {
  const p = await seedOrg(db, "review-fixture");
  const blobs = new FakeBlobStore();
  const bytes = new Uint8Array([255, 216, 255]);
  const storageKey = `org/${p.orgId}/synthetic-only`;
  blobs.put(storageKey, bytes, "image/jpeg");
  const [account] = await db
    .insert(schema.socialAccounts)
    .values({
      ...p,
      provider: "instagram",
      providerAccountId: "private-provider-id",
      username: "synthetic",
      displayName: "Synthetic fixture",
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
      name: "synthetic.jpg",
      mimeType: "image/jpeg",
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      purpose: "image",
      storageKey,
      status: "ready",
    })
    .returning();
  const [draft] = await db
    .insert(schema.socialDrafts)
    .values({
      ...p,
      threadId: "private-thread-id",
      revision: 1,
      content: {
        caption: "Synthetic caption",
        captions: { [account!.id]: "Synthetic platform caption" },
        mediaFileIds: [file!.id],
        accountIds: [account!.id],
        scheduledAt: "2030-01-01T12:00:00Z",
        timezone: "America/Toronto",
      },
    })
    .returning();
  let clock = new Date();
  const service = new ReviewLinkService(db, blobs, () => clock);
  return {
    p,
    draft: draft!,
    file: file!,
    service,
    blobs,
    storageKey,
    expire: () => {
      clock = new Date(clock.getTime() + 25 * 3600000);
    },
  };
}
const input = { revision: 1, expiresInHours: 24 as const, disclosureAccepted: true };
describe("version-bound public social review", () => {
  it("requires disclosure, exact revision and both owner scopes for creation, list and revocation", async () => {
    const { p, draft, service } = await fixture();
    await expect(
      service.create(p, draft.id, { ...input, disclosureAccepted: false }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(service.create(p, draft.id, { ...input, revision: 2 })).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      service.create(p, draft.id, { ...input, expiresInHours: 999 as 24 }),
    ).rejects.toMatchObject({ status: 400 });
    const created = await service.create(p, draft.id, input);
    const other = await seedOrg(db, "review-other");
    for (const foreign of [
      { ...p, orgId: other.orgId },
      { ...p, userId: other.userId },
    ]) {
      await expect(service.create(foreign, draft.id, input)).rejects.toMatchObject({ status: 404 });
      await expect(service.list(foreign, draft.id)).rejects.toMatchObject({ status: 404 });
      await expect(service.revoke(foreign, created.link.id)).rejects.toMatchObject({ status: 404 });
    }
  });
  it("stores only hashed tokens and explicitly redacts private identifiers and media keys", async () => {
    const { p, draft, service, storageKey, file } = await fixture();
    const created = await service.create(p, draft.id, input);
    expect(created.token).toMatch(/^[\w-]{43}$/);
    expect(created.reviewPath).toBe(`/social/review#token=${created.token}`);
    const [stored] = await db
      .select()
      .from(schema.socialReviewLinks)
      .where(eq(schema.socialReviewLinks.id, created.link.id));
    expect(stored!.tokenHash).not.toBe(created.token);
    expect(stored!.tokenHash).toBe(createHash("sha256").update(created.token).digest("hex"));
    const value = await service.read(created.token);
    expect(value.caption).toBe("Synthetic caption");
    expect(value.targets).toEqual([
      { provider: "instagram", caption: "Synthetic platform caption" },
    ]);
    for (const secret of [
      p.userId,
      p.orgId,
      draft.id,
      draft.threadId,
      storageKey,
      file.id,
      "private-provider-id",
      "tokenHash",
      "mediaFileIds",
      "accountIds",
    ])
      expect(JSON.stringify(value)).not.toContain(secret);
    expect((await service.media(created.token, 0)).bytes).toEqual(new Uint8Array([255, 216, 255]));
    await expect(service.media(created.token, 1)).rejects.toMatchObject({ status: 404 });
    await expect(service.read("invalid")).rejects.toMatchObject({ status: 404 });
  });
  it("keeps the snapshot immutable after edit and invalidates earlier approval without publishing", async () => {
    const { p, draft, service } = await fixture();
    const { token } = await service.create(p, draft.id, input);
    const entry = await service.submit(token, {
      reviewerName: "Test reviewer",
      comment: "",
      decision: "approved",
    });
    expect(entry.identityVerified).toBe(false);
    await db
      .update(schema.socialDrafts)
      .set({ revision: 2, content: { ...draft.content, caption: "Changed caption" } })
      .where(eq(schema.socialDrafts.id, draft.id));
    expect(await service.read(token)).toMatchObject({
      caption: "Synthetic caption",
      revision: 1,
      isCurrent: false,
    });
    await expect(
      service.submit(token, {
        reviewerName: "Test",
        comment: "Changed",
        decision: "changes_requested",
      }),
    ).rejects.toMatchObject({ status: 409 });
    const links = await service.list(p, draft.id);
    expect(links[0]!.isCurrent).toBe(false);
    expect(links[0]!.feedback[0]!.identityVerified).toBe(false);
    const [stored] = await db
      .select()
      .from(schema.socialDrafts)
      .where(eq(schema.socialDrafts.id, draft.id));
    expect(stored!.confirmedAt).toBeNull();
    expect(
      await db
        .select()
        .from(schema.socialPublishTasks)
        .where(eq(schema.socialPublishTasks.draftId, draft.id)),
    ).toHaveLength(0);
  });
  it("blocks preview, media and feedback after expiration or owner revocation", async () => {
    for (const mode of ["expiry", "revoke"]) {
      const { p, draft, service, expire } = await fixture();
      const created = await service.create(p, draft.id, input);
      if (mode === "expiry") expire();
      else await service.revoke(p, created.link.id);
      await expect(service.read(created.token)).rejects.toMatchObject({ status: 404 });
      await expect(service.media(created.token, 0)).rejects.toMatchObject({ status: 404 });
      await expect(
        service.submit(created.token, {
          reviewerName: "Test",
          comment: "Fine",
          decision: "approved",
        }),
      ).rejects.toMatchObject({ status: 404 });
    }
  });
  it("revalidates revocation after media IO and refuses changed or deleted bytes", async () => {
    const { p, draft, service, blobs, storageKey, file } = await fixture();
    const created = await service.create(p, draft.id, input);
    blobs.put(storageKey, new Uint8Array([1, 2, 3]), "image/jpeg");
    await expect(service.media(created.token, 0)).rejects.toMatchObject({ status: 404 });
    blobs.put(storageKey, new Uint8Array([255, 216, 255]), "image/jpeg");
    const read = blobs.read.bind(blobs);
    blobs.read = async (key) => {
      await service.revoke(p, created.link.id);
      return read(key);
    };
    await expect(service.media(created.token, 0)).rejects.toMatchObject({ status: 404 });
    await db
      .update(schema.files)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.files.id, file.id), eq(schema.files.orgId, p.orgId)));
    await expect(service.create(p, draft.id, input)).rejects.toMatchObject({ status: 404 });
  });
  it("bounds feedback and labels every reviewer-provided identity unverified", async () => {
    const { p, draft, service } = await fixture();
    const { token } = await service.create(p, draft.id, input);
    for (const value of [
      { reviewerName: " ", comment: "Fine", decision: "approved" as const },
      { reviewerName: "A", comment: "", decision: "comment" as const },
      { reviewerName: "A", comment: "x".repeat(2001), decision: "approved" as const },
    ])
      await expect(service.submit(token, value)).rejects.toMatchObject({ status: 400 });
    const entry = await service.submit(token, {
      reviewerName: "  Unverified name  ",
      comment: "Revise copy",
      decision: "changes_requested",
    });
    expect(entry.reviewerName).toBe("Unverified name");
    expect(entry.identityVerified).toBe(false);
    expect((await service.list(p, draft.id))[0]!.feedback).toHaveLength(1);
  });
});
