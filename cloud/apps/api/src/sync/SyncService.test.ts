import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "../auth/guard.ts";
import { seedOrg, testDatabase } from "../testing/db.ts";
import { FakeBlobStore } from "./BlobStore.ts";
import { SyncService, type SyncEventInput } from "./SyncService.ts";

const conn = testDatabase();
const blobs = new FakeBlobStore();
const sync = new SyncService(conn.db, blobs);
let p: Principal;
let desktop = "";
let phone = "";

async function device(userId: string, kind: string) {
  const [row] = await conn.db
    .insert(schema.devices)
    .values({ userId, kind, fingerprint: `fp-${crypto.randomUUID()}`, syncEnabled: true })
    .returning({ id: schema.devices.id });
  return row!.id;
}

const ev = (
  id: string,
  streamId: string,
  version: number,
  type = "thread.message.appended",
  payload: unknown = { text: "hi" },
): SyncEventInput => ({
  eventId: id,
  aggregateKind: "thread",
  streamId,
  streamVersion: version,
  eventType: type,
  occurredAt: new Date(Date.now() + version).toISOString(),
  actorKind: "user",
  payload,
});

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const MB = 1024 * 1024;

/** What the client's PUT to the presigned URL stores. */
function put(begin: { readonly upload: { readonly url: string } }, bytes: Uint8Array) {
  const key = decodeURIComponent(new URL(begin.upload.url).pathname.replace("/upload/", ""));
  blobs.put(key, bytes);
  return key;
}

/** A fresh org on the 100 MB trial quota with `freeBytes` of it left. */
async function orgWithFreeBytes(freeBytes: number): Promise<Principal> {
  const org = await seedOrg(conn.db, "sync-quota");
  await conn.db
    .insert(schema.syncUsage)
    .values({ orgId: org.orgId, eventBytes: BigInt(100 * MB - freeBytes) });
  return { ...p, userId: org.userId, orgId: org.orgId, personalOrgId: org.orgId };
}

beforeAll(async () => {
  const seeded = await seedOrg(conn.db, "sync");
  p = {
    userId: seeded.userId,
    email: "s@test.invalid",
    emailVerified: true,
    banned: false,
    sessionId: "s",
    orgId: seeded.orgId,
    role: "owner",
    personalOrgId: seeded.orgId,
  };
  desktop = await device(p.userId, "desktop");
  phone = await device(p.userId, "ios");
  await conn.db
    .insert(schema.plans)
    .values({
      id: "trial",
      name: "Trial",
      monthlyPriceUsdCents: 0,
      annualPriceUsdCents: 0,
      includedMicrocredits: 0n,
      concurrentStreams: 2,
      requestsPerMinute: 20,
      priorityWeight: 1,
      syncQuotaBytes: 100n * 1024n * 1024n,
    })
    .onConflictDoUpdate({
      target: schema.plans.id,
      // Other suites seed the shared trial row with a different quota.
      set: { syncQuotaBytes: 100n * 1024n * 1024n },
    });
  await conn.db
    .insert(schema.killSwitches)
    .values({ name: "sync", engaged: false })
    .onConflictDoUpdate({ target: schema.killSwitches.name, set: { engaged: false } });
});
afterAll(() => conn.close());

describe("SyncService", () => {
  it("pushes events idempotently, indexes threads, and pulls them on another device with a cursor", async () => {
    const first = await sync.push(p, desktop, [
      ev("e1", "thread-A", 1, "thread.created", {
        title: "Plan the launch",
        modelSelection: { provider: "djlCloud", model: "gpt-5" },
      }),
      ev("e2", "thread-A", 2),
    ]);
    expect(first.accepted).toBe(2);
    const replay = await sync.push(p, desktop, [ev("e2", "thread-A", 2), ev("e3", "thread-A", 3)]);
    expect(replay).toMatchObject({ accepted: 1, duplicates: 1 });
    const threads = await sync.listThreads(p);
    expect(threads[0]).toMatchObject({
      threadId: "thread-A",
      title: "Plan the launch",
      model: "gpt-5",
      eventCount: 3,
    });

    const pulled = await sync.pull(p, phone, 0n);
    expect(pulled.events.map((e) => e.eventId)).toEqual(["e1", "e2", "e3"]);
    expect(pulled.hasMore).toBe(false);
    // The desktop pulling its own events gets nothing unless it asks.
    const own = await sync.pull(p, desktop, 0n);
    expect(own.events).toHaveLength(0);
    expect((await sync.pull(p, desktop, 0n, { includeOwn: true })).events).toHaveLength(3);
    // Cursor advances; nothing new after the head.
    const again = await sync.pull(p, phone, BigInt(pulled.cursor));
    expect(again.events).toHaveLength(0);
    const status = await sync.status(p, phone);
    expect(status.pulledThrough).toBe(pulled.cursor);
    expect(Number(status.quota.usedBytes)).toBeGreaterThan(0);
  });

  it("merges events from two devices in one thread without losing either side", async () => {
    await sync.push(p, desktop, [ev("d1", "thread-B", 1, "thread.created", { title: "B" })]);
    await sync.push(p, phone, [ev("p1", "thread-B", 2)]);
    await sync.push(p, desktop, [ev("d2", "thread-B", 2)]); // same version from another device is kept
    const events = await sync.threadEvents(p, "thread-B");
    expect(events.map((e) => e.eventId)).toEqual(["d1", "p1", "d2"]);
  });

  it("refuses devices that are not the caller's, disabled sync, and the kill switch", async () => {
    const other = await seedOrg(conn.db, "sync-other");
    const strangerDevice = await device(other.userId, "desktop");
    await expect(sync.push(p, strangerDevice, [ev("x", "t", 1)])).rejects.toMatchObject({
      code: "unknown_device",
    });
    await sync.setDeviceSync(p, desktop, false);
    await expect(sync.push(p, desktop, [ev("x", "t", 1)])).rejects.toMatchObject({
      code: "sync_disabled",
    });
    await sync.setDeviceSync(p, desktop, true);
    await conn.db
      .update(schema.killSwitches)
      .set({ engaged: true })
      .where(eq(schema.killSwitches.name, "sync"));
    await expect(sync.push(p, desktop, [ev("x", "t", 1)])).rejects.toMatchObject({
      code: "sync_paused",
    });
    expect((await sync.pull(p, phone, 0n)).events.length).toBeGreaterThan(0); // reads keep working
    await conn.db
      .update(schema.killSwitches)
      .set({ engaged: false })
      .where(eq(schema.killSwitches.name, "sync"));
  });

  it("enforces the plan quota", async () => {
    const tiny = await seedOrg(conn.db, "sync-tiny");
    const tp: Principal = {
      ...p,
      userId: tiny.userId,
      orgId: tiny.orgId,
      personalOrgId: tiny.orgId,
    };
    const dev = await device(tiny.userId, "desktop");
    await conn.db
      .insert(schema.syncUsage)
      .values({ orgId: tiny.orgId, eventBytes: 100n * 1024n * 1024n - 10n });
    await expect(
      sync.push(tp, dev, [ev("q1", "t", 1, "thread.created", { title: "x".repeat(100) })]),
    ).rejects.toMatchObject({ code: "sync_quota_exceeded" });
  });

  it("uploads attachments by content hash and dedupes them", async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(1234));
    const hash = sha256(bytes);
    const begin = await sync.beginAttachmentUpload(p, {
      contentHash: hash,
      mimeType: "image/png",
      sizeBytes: 1234,
    });
    expect(begin.alreadyPresent).toBe(false);
    if (begin.alreadyPresent) throw new Error("unexpected");
    expect(begin.upload.url).toContain("blob.test/upload");
    put(begin, bytes);
    expect(await sync.completeAttachmentUpload(p, hash)).toEqual({ status: "ready" });
    expect(
      (
        await sync.beginAttachmentUpload(p, {
          contentHash: hash,
          mimeType: "image/png",
          sizeBytes: 1234,
        })
      ).alreadyPresent,
    ).toBe(true);
    const download = await sync.attachmentDownload(p, hash);
    expect(download.url).toContain("blob.test");
    expect(download.sizeBytes).toBe(1234);
    await expect(
      sync.beginAttachmentUpload(p, { contentHash: "zz", mimeType: "x", sizeBytes: 1 }),
    ).rejects.toMatchObject({ code: "bad_hash" });
    const other = await seedOrg(conn.db, "sync-other2");
    const op: Principal = {
      ...p,
      userId: other.userId,
      orgId: other.orgId,
      personalOrgId: other.orgId,
    };
    await expect(sync.attachmentDownload(op, hash)).rejects.toMatchObject({ status: 404 }); // no cross-org reads
  });

  it.each([
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
    "application/xml",
    "text/xml",
    "text/javascript",
    "application/javascript",
    "text/html; charset=utf-8",
    "IMAGE/PNG",
  ])("refuses to store an attachment declared as %s", async (mimeType) => {
    await expect(
      sync.beginAttachmentUpload(p, { contentHash: "b".repeat(64), mimeType, sizeBytes: 10 }),
    ).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("rejects and deletes an upload whose bytes do not match the declared hash", async () => {
    const real = crypto.getRandomValues(new Uint8Array(64));
    const hash = sha256(real);
    const input = { contentHash: hash, mimeType: "image/png", sizeBytes: real.byteLength };
    const begin = await sync.beginAttachmentUpload(p, input);
    if (begin.alreadyPresent) throw new Error("unexpected");
    // Another member files different bytes of the same size under the victim's hash.
    const key = put(begin, crypto.getRandomValues(new Uint8Array(64)));
    await expect(sync.completeAttachmentUpload(p, hash)).rejects.toMatchObject({
      code: "upload_mismatch",
    });
    expect(blobs.objects.has(key)).toBe(false);
    await expect(sync.attachmentDownload(p, hash)).rejects.toMatchObject({ status: 404 });
    // The hash is free again for the real bytes.
    const retry = await sync.beginAttachmentUpload(p, input);
    if (retry.alreadyPresent) throw new Error("unexpected");
    put(retry, real);
    expect(await sync.completeAttachmentUpload(p, hash)).toEqual({ status: "ready" });
  });

  it("keeps verified bytes out of reach of the still-valid upload URL and serves them inert", async () => {
    const real = new TextEncoder().encode("the real attachment");
    const hash = sha256(real);
    const begin = await sync.beginAttachmentUpload(p, {
      contentHash: hash,
      mimeType: "text/plain",
      sizeBytes: real.byteLength,
    });
    if (begin.alreadyPresent) throw new Error("unexpected");
    const uploadKey = put(begin, real);
    await sync.completeAttachmentUpload(p, hash);
    // The presigned PUT is good for minutes more: writing to it again changes nothing served.
    blobs.put(uploadKey, new TextEncoder().encode("<script>alert(1)"), "text/html");
    const download = await sync.attachmentDownload(p, hash);
    const url = new URL(download.url);
    const servedKey = decodeURIComponent(url.pathname.slice(1));
    expect(servedKey).not.toBe(uploadKey);
    expect(blobs.objects.get(servedKey)).toMatchObject({
      bytes: real,
      mimeType: "application/octet-stream",
    });
    expect(url.searchParams.get("response-content-disposition")).toBe("attachment");
    expect(url.searchParams.get("response-content-type")).toBe("application/octet-stream");
    // A second completion neither fails nor counts the bytes twice.
    const before = (await sync.status(p, desktop)).quota.usedBytes;
    expect(await sync.completeAttachmentUpload(p, hash)).toEqual({ status: "ready" });
    expect((await sync.status(p, desktop)).quota.usedBytes).toBe(before);
  });

  it("counts uploads that were started but never completed against the quota", async () => {
    const tp = await orgWithFreeBytes(60 * MB);
    const begin = (n: number) =>
      sync.beginAttachmentUpload(tp, {
        contentHash: n.toString(16).padStart(64, "0"),
        mimeType: "application/octet-stream",
        sizeBytes: 40 * MB,
      });
    expect((await begin(1)).alreadyPresent).toBe(false);
    await expect(begin(2)).rejects.toMatchObject({ code: "sync_quota_exceeded" });
    // Starting the same upload again is not a second reservation.
    expect((await begin(1)).alreadyPresent).toBe(false);

    // An abandoned upload gives its bytes back and its object is removed.
    const pendingOne = and(
      eq(schema.attachments.orgId, tp.orgId),
      eq(schema.attachments.contentHash, (1).toString(16).padStart(64, "0")),
    );
    const [row] = await conn.db
      .update(schema.attachments)
      .set({ createdAt: new Date(Date.now() - 2 * 3_600_000) })
      .where(pendingOne)
      .returning({ bucketKey: schema.attachments.bucketKey });
    expect(blobs.objects.has(row!.bucketKey)).toBe(true);
    expect((await begin(2)).alreadyPresent).toBe(false);
    expect(blobs.objects.has(row!.bucketKey)).toBe(false);
    expect(await conn.db.select().from(schema.attachments).where(pendingOne)).toHaveLength(0);
  });

  it("does not let a parallel burst of upload starts outrun the quota", async () => {
    const tp = await orgWithFreeBytes(60 * MB);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, n) =>
        sync.beginAttachmentUpload(tp, {
          contentHash: (n + 1).toString(16).padStart(64, "0"),
          mimeType: "application/octet-stream",
          sizeBytes: 40 * MB,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results)
      if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "sync_quota_exceeded" });
  });
});

describe("team orgs", () => {
  it("keeps each member's synced history in their personal org, invisible to teammates", async () => {
    const team = await seedOrg(conn.db, "sync-team");
    const memberOf = async (label: string): Promise<Principal> => {
      const own = await seedOrg(conn.db, label);
      await conn.db.insert(schema.member).values({
        organizationId: team.orgId,
        userId: own.userId,
        role: "member",
        createdAt: new Date(),
      });
      // Signed in with the team org active, as the web app allows.
      return {
        ...p,
        userId: own.userId,
        orgId: team.orgId,
        role: "member",
        personalOrgId: own.orgId,
      };
    };
    const alice = await memberOf("sync-alice");
    const bob = await memberOf("sync-bob");
    const aliceDesktop = await device(alice.userId, "desktop");
    const bobDesktop = await device(bob.userId, "desktop");
    const thread = `thread-${crypto.randomUUID()}`;
    await sync.push(alice, aliceDesktop, [
      ev(crypto.randomUUID(), thread, 1, "thread.created", { title: "Private plans" }),
    ]);

    expect((await sync.listThreads(alice)).map((t) => t.threadId)).toContain(thread);
    expect((await sync.listThreads(bob)).map((t) => t.threadId)).not.toContain(thread);
    expect(await sync.threadEvents(bob, thread)).toEqual([]);
    const pulled = await sync.pull(bob, bobDesktop, 0n, { includeOwn: true, limit: 500 });
    expect(pulled.events.map((e) => e.streamId)).not.toContain(thread);

    // Bob deleting "the same" thread id only touches his own history.
    await sync.push(bob, bobDesktop, [ev(crypto.randomUUID(), thread, 1, "thread.deleted", {})]);
    expect((await sync.listThreads(alice)).map((t) => t.threadId)).toContain(thread);
    const stored = await conn.db.query.threadEvents.findMany({
      where: eq(schema.threadEvents.streamId, thread),
    });
    expect(new Set(stored.map((e) => e.orgId))).toEqual(
      new Set([alice.personalOrgId, bob.personalOrgId]),
    );
  });
});
