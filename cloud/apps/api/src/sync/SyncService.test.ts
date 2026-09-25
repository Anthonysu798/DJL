import { eq } from "drizzle-orm";
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
    .onConflictDoNothing();
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
    const hash = "a".repeat(64);
    const begin = await sync.beginAttachmentUpload(p, {
      contentHash: hash,
      mimeType: "image/png",
      sizeBytes: 1234,
    });
    expect(begin.alreadyPresent).toBe(false);
    if (begin.alreadyPresent) throw new Error("unexpected");
    expect(begin.upload.url).toContain("blob.test/upload");
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
});
