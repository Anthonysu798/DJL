import { createHash, randomUUID } from "node:crypto";
import type { DjlDatabase } from "@djl/db";
import { drizzle } from "drizzle-orm/pg-proxy";
import { expect, it, vi } from "vitest";

import { createMemoryRateLimiter } from "../gateway/RateLimiter.ts";
import { FakeBlobStore } from "../sync/BlobStore.ts";
import { CommerceImageUploads, commerceImageUploadKey } from "./CommerceImageUploads.ts";

const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x12);
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const buyer = { userId: "00000000-0000-4000-8000-000000000011", emailVerified: true };
const foreign = { userId: "00000000-0000-4000-8000-000000000022", emailVerified: true };
const complete = { expectedUserId: buyer.userId };
const declaration = { ...complete, mimeType: "image/png", size: png.length, sha256: hash(png) };

type Row = {
  id: string;
  owner: string | null;
  mimeType: string;
  bytes: number;
  sha256: string;
  status: string;
  created: string;
  expires: string;
  retry: string | null;
};

// No Postgres service. Drizzle emits its actual SQL to this controlled row fixture.
function fixture(enabled = true, allocateUploadId?: () => string) {
  const records = new Map<string, Row>();
  let time = Date.parse("2026-11-05T12:00:00.000Z");
  const query = vi.fn(async (statement: string, values: unknown[]) => {
    expect(statement).toContain('"commerce_image_uploads"');
    expect(statement).not.toContain('"files"');
    if (statement.startsWith('insert into "commerce_image_uploads"')) {
      const [id, owner, mimeType, bytes, sha256, created, expires] = values as [
        string,
        string,
        string,
        number,
        string,
        string,
        string,
      ];
      records.set(id, {
        id,
        owner,
        mimeType,
        bytes,
        sha256,
        status: "pending",
        created,
        expires,
        retry: null,
      });
      return { rows: [] };
    }
    if (statement.startsWith('select "id", "user_id"')) {
      expect(statement).toContain('"commerce_image_uploads"."id" = $1');
      expect(statement).toContain('"commerce_image_uploads"."user_id" = $2');
      expect(statement).toContain('"commerce_image_uploads"."expires_at" > $3');
      const [id, owner, cutoff] = values as [string, string, string];
      const row = records.get(id);
      return {
        rows:
          row && row.owner === owner && row.expires > cutoff
            ? [
                [
                  row.id,
                  row.owner,
                  row.mimeType,
                  row.bytes,
                  row.sha256,
                  row.status,
                  row.created,
                  row.expires,
                  row.retry,
                ],
              ]
            : [],
      };
    }
    if (statement.startsWith('update "commerce_image_uploads"')) {
      if (statement.includes('"commerce_image_uploads"."cleanup_retry_at" is null')) {
        const [status, retry, id, cutoff, excluded, now] = values as [
          string,
          string,
          string,
          string,
          string,
          string,
        ];
        const row = records.get(id);
        if (
          !row ||
          row.status === excluded ||
          row.expires > cutoff ||
          (row.retry && row.retry > now)
        )
          return { rows: [] };
        row.status = status;
        row.retry = retry;
        return { rows: [[id]] };
      }
      expect(statement).toContain('"commerce_image_uploads"."user_id" = $3');
      expect(statement).toContain('"commerce_image_uploads"."status" = $4');
      const [status, id, owner, current, cutoff] = values as [
        string,
        string,
        string,
        string,
        string?,
      ];
      const row = records.get(id);
      if (
        !row ||
        row.owner !== owner ||
        row.status !== current ||
        (cutoff && row.expires <= cutoff)
      )
        return { rows: [] };
      row.status = status;
      return { rows: statement.endsWith('returning "id"') ? [[id]] : [] };
    }
    if (statement.startsWith('select "id"')) {
      expect(statement).toContain('"commerce_image_uploads"."expires_at" <= $1');
      expect(statement).toContain('"commerce_image_uploads"."cleanup_retry_at" is null');
      expect(statement).toContain("order by coalesce(");
      const [cutoff, excluded, now, max] = values as [string, string, string, number];
      return {
        rows: [...records.values()]
          .filter(
            (row) =>
              row.expires <= cutoff && row.status !== excluded && (!row.retry || row.retry <= now),
          )
          .toSorted(
            (a, b) =>
              (a.retry ?? a.expires).localeCompare(b.retry ?? b.expires) ||
              a.id.localeCompare(b.id),
          )
          .slice(0, max)
          .map(({ id }) => [id]),
      };
    }
    if (statement.startsWith('delete from "commerce_image_uploads"')) {
      const [id, status, cutoff, retry] = values as [string, string, string, string];
      const row = records.get(id);
      if (!row || row.status !== status || row.expires > cutoff || row.retry !== retry)
        return { rows: [] };
      records.delete(id);
      return { rows: [[id]] };
    }
    throw new Error("Unexpected commerce image database statement.");
  });
  const db = drizzle(query) as unknown as DjlDatabase;
  const blobs = new FakeBlobStore();
  const presign = vi
    .spyOn(blobs, "presignUpload")
    .mockImplementation(async (key, mimeType, bytes) => ({
      ...(await FakeBlobStore.prototype.presignUpload.call(blobs, key, mimeType, bytes)),
      expiresAt: new Date(time + 600_000).toISOString(),
    }));
  const sign = vi
    .spyOn(blobs, "presignDownload")
    .mockImplementation(async (key, seconds = 600) => ({
      ...(await FakeBlobStore.prototype.presignDownload.call(blobs, key, seconds)),
      expiresAt: new Date(time + seconds * 1000).toISOString(),
    }));
  const head = vi.spyOn(blobs, "head");
  const read = vi.spyOn(blobs, "read");
  const write = vi.spyOn(blobs, "write");
  const remove = vi.spyOn(blobs, "remove");
  const limiter = createMemoryRateLimiter(() => time);
  const quota = vi.spyOn(limiter, "hit");
  const uploads = new CommerceImageUploads(db, blobs, {
    enabled: () => enabled,
    limiter,
    now: () => new Date(time),
    ...(allocateUploadId ? { allocateUploadId } : {}),
  });
  return {
    uploads,
    blobs,
    records,
    query,
    presign,
    sign,
    head,
    read,
    write,
    remove,
    quota,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

it("allows only a trusted constructor to allocate a fixed upload ID", async () => {
  const id = randomUUID();
  const allocate = vi.fn(() => id);
  const f = fixture(true, allocate);
  await expect(f.uploads.create(buyer, { ...declaration, id })).rejects.toMatchObject({
    code: "bad_request",
  });
  expect(allocate).not.toHaveBeenCalled();
  await expect(f.uploads.create(buyer, declaration)).resolves.toMatchObject({ id });
  expect(allocate).toHaveBeenCalledOnce();
  expect(f.records.get(id)?.status).toBe("pending");
});

it("fails closed before quota, database or storage when uploads are not enabled", async () => {
  const f = fixture(false);
  await expect(f.uploads.create(buyer, declaration)).rejects.toMatchObject({
    status: 503,
    code: "image_search_unavailable",
  });
  await expect(f.uploads.complete(buyer, randomUUID(), complete)).rejects.toMatchObject({
    status: 503,
    code: "image_search_unavailable",
  });
  expect(f.query).not.toHaveBeenCalled();
  expect(f.quota).not.toHaveBeenCalled();
  expect(f.presign).not.toHaveBeenCalled();
});

it("rejects account changes, unverified buyers and invalid upload declarations before side effects", async () => {
  const f = fixture();
  await expect(f.uploads.create(foreign, declaration)).rejects.toMatchObject({
    status: 409,
    code: "commerce_account_changed",
  });
  await expect(f.uploads.complete(foreign, randomUUID(), complete)).rejects.toMatchObject({
    status: 409,
    code: "commerce_account_changed",
  });
  await expect(
    f.uploads.create({ ...buyer, emailVerified: false }, declaration),
  ).rejects.toMatchObject({
    status: 403,
    code: "email_verification_required",
  });
  for (const [overrides, status] of [
    [{ mimeType: "image/gif" }, 400],
    [{ size: 0 }, 400],
    [{ size: 10 * 1024 * 1024 + 1 }, 413],
    [{ sha256: "not-a-hash" }, 400],
  ] as const)
    await expect(f.uploads.create(buyer, { ...declaration, ...overrides })).rejects.toMatchObject({
      status,
    });
  expect(f.quota).not.toHaveBeenCalled();
  expect(f.query).not.toHaveBeenCalled();
  expect(f.presign).not.toHaveBeenCalled();
});

it("seals verified staging bytes into a server-only key and does not overwrite it on completion replay", async () => {
  const f = fixture();
  const grant = await f.uploads.create(buyer, declaration);
  const staging = commerceImageUploadKey(grant.id, "staging");
  const ready = commerceImageUploadKey(grant.id, "ready");
  expect(grant).toEqual({
    userId: buyer.userId,
    id: grant.id,
    upload: {
      url: `https://blob.test/upload/${encodeURIComponent(staging)}`,
      method: "PUT",
      headers: { "content-type": "image/png", "content-length": String(png.length) },
    },
  });
  await expect(f.uploads.fileUrl(buyer, grant.id)).rejects.toMatchObject({ status: 404 });
  expect(f.sign).not.toHaveBeenCalled();

  f.blobs.put(staging, png, "image/png");
  await expect(f.uploads.complete(buyer, grant.id, complete)).resolves.toEqual({
    id: grant.id,
    userId: buyer.userId,
  });
  expect(f.write).toHaveBeenCalledExactlyOnceWith(ready, png, "image/png");
  expect(f.blobs.objects.has(staging)).toBe(false);
  f.blobs.put(staging, new Uint8Array(png.length).fill(9), "image/png"); // replay of still-live PUT
  await expect(f.uploads.complete(buyer, grant.id, complete)).resolves.toEqual({
    id: grant.id,
    userId: buyer.userId,
  });
  expect(f.write).toHaveBeenCalledOnce();
  expect(f.blobs.objects.get(ready)?.bytes).toEqual(png);
  await expect(f.uploads.readyPhoto(buyer, grant.id)).resolves.toMatchObject({
    id: grant.id,
    storageKey: ready,
    sha256: declaration.sha256,
    sizeBytes: png.length,
    mimeType: "image/png",
  });
  await expect(f.uploads.fileUrl(buyer, grant.id)).resolves.toContain(encodeURIComponent(ready));
  expect(f.sign).toHaveBeenCalledExactlyOnceWith(ready, 60);
});

it("never reads or signs foreign, legacy AI, expired or deleted-owner photo ids", async () => {
  const f = fixture();
  const { id } = await f.uploads.create(buyer, declaration);
  const wrongOwner = { expectedUserId: foreign.userId };
  await expect(f.uploads.complete(foreign, id, wrongOwner)).rejects.toMatchObject({
    status: 404,
    code: "file_unavailable",
  });
  await expect(f.uploads.fileUrl(foreign, id)).rejects.toMatchObject({
    status: 404,
    code: "file_unavailable",
  });
  await expect(f.uploads.fileUrl(buyer, randomUUID())).rejects.toMatchObject({
    status: 404,
    code: "file_unavailable",
  });
  expect(f.head).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();

  f.blobs.put(commerceImageUploadKey(id, "staging"), png, "image/png");
  await f.uploads.complete(buyer, id, complete);
  const row = f.records.get(id)!;
  row.owner = null;
  await expect(f.uploads.fileUrl(buyer, id)).rejects.toMatchObject({
    status: 404,
    code: "file_unavailable",
  });
  row.owner = buyer.userId;
  f.advance(30 * 60_000);
  await expect(f.uploads.fileUrl(buyer, id)).rejects.toMatchObject({
    status: 404,
    code: "file_unavailable",
  });
  expect(f.sign).not.toHaveBeenCalled();
});

it.each(["size", "hash", "magic"] as const)(
  "rejects a %s mismatch without producing a ready object",
  async (kind) => {
    const f = fixture();
    const invalid = png.slice();
    invalid[0] = 0;
    const input = kind === "magic" ? { ...declaration, sha256: hash(invalid) } : declaration;
    const { id } = await f.uploads.create(buyer, input);
    const bytes =
      kind === "size"
        ? png.slice(0, -1)
        : kind === "magic"
          ? invalid
          : png.map((n, i) => (i === png.length - 1 ? 0 : n));
    f.blobs.put(commerceImageUploadKey(id, "staging"), bytes, "image/png");
    await expect(f.uploads.complete(buyer, id, complete)).rejects.toMatchObject({
      status: 400,
      code: "upload_mismatch",
    });
    expect(f.records.get(id)?.status).toBe("rejected");
    expect(f.write).not.toHaveBeenCalled();
    expect(f.read).toHaveBeenCalledTimes(kind === "size" ? 0 : 1);
    await expect(f.uploads.complete(buyer, id, complete)).rejects.toMatchObject({
      status: 400,
      code: "upload_rejected",
    });
    await expect(f.uploads.fileUrl(buyer, id)).rejects.toMatchObject({ status: 404 });
    expect(f.sign).not.toHaveBeenCalled();
  },
);

it("bounds staging bytes after a matching HEAD and never writes ready on size drift", async () => {
  const f = fixture();
  const { id } = await f.uploads.create(buyer, declaration);
  const staging = commerceImageUploadKey(id, "staging");
  f.blobs.put(staging, new Uint8Array(png.length + 1), "image/png");
  f.head.mockResolvedValueOnce({ sizeBytes: png.length });
  await expect(f.uploads.complete(buyer, id, complete)).rejects.toMatchObject({
    status: 400,
    code: "upload_mismatch",
  });
  expect(f.read).toHaveBeenCalledExactlyOnceWith(staging, png.length);
  expect(f.write).not.toHaveBeenCalled();
  expect(f.records.get(id)?.status).toBe("rejected");
  expect(f.blobs.objects.has(staging)).toBe(false);
});

it("allows an absent upload to retry but admits only one completion while checking bytes", async () => {
  const f = fixture();
  const { id } = await f.uploads.create(buyer, declaration);
  await expect(f.uploads.complete(buyer, id, complete)).rejects.toMatchObject({
    code: "upload_missing",
  });
  expect(f.records.get(id)?.status).toBe("pending");
  f.blobs.put(commerceImageUploadKey(id, "staging"), png, "image/png");
  let finish!: (bytes: Uint8Array) => void;
  let started!: () => void;
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.read.mockImplementationOnce(() => {
    started();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = f.uploads.complete(buyer, id, complete);
  await active;
  await expect(f.uploads.complete(buyer, id, complete)).rejects.toMatchObject({
    status: 409,
    code: "upload_in_progress",
  });
  finish(png);
  await expect(first).resolves.toMatchObject({ id });
  expect(f.write).toHaveBeenCalledOnce();
});

it("limits upload issuance and caps provider signing to the remaining retention", async () => {
  const f = fixture();
  const grants = [];
  for (let i = 0; i < 6; i++) grants.push(await f.uploads.create(buyer, declaration));
  await expect(f.uploads.create(buyer, declaration)).rejects.toMatchObject({ status: 429 });
  expect(f.presign).toHaveBeenCalledTimes(6);
  const { id } = grants[0]!;
  f.blobs.put(commerceImageUploadKey(id, "staging"), png, "image/png");
  await f.uploads.complete(buyer, id, complete);
  f.advance(30 * 60_000 - 9000);
  await f.uploads.fileUrl(buyer, id);
  expect(f.sign).toHaveBeenCalledExactlyOnceWith(commerceImageUploadKey(id, "ready"), 8);
});

it("purges expired staging and ready keys in bounded batches and retains a row after storage failure", async () => {
  const f = fixture();
  const { id } = await f.uploads.create(buyer, declaration);
  const staging = commerceImageUploadKey(id, "staging");
  const ready = commerceImageUploadKey(id, "ready");
  f.blobs.put(staging, png, "image/png");
  await f.uploads.complete(buyer, id, complete);
  f.blobs.put(staging, png, "image/png");
  const second = await f.uploads.create(buyer, declaration);
  f.advance(30 * 60_000);
  await expect(f.uploads.purgeExpired(1)).resolves.toEqual({ removed: 0, failed: 0 });
  f.advance(60_000);
  f.remove.mockRejectedValueOnce(new Error("Storage temporarily unavailable"));
  await expect(f.uploads.purgeExpired(1)).resolves.toEqual({ removed: 0, failed: 1 });
  expect(f.records.size).toBe(2);
  await expect(f.uploads.purgeExpired(1)).resolves.toEqual({ removed: 1, failed: 0 });
  await expect(f.uploads.purgeExpired(1)).resolves.toEqual({ removed: 0, failed: 0 });
  f.advance(15 * 60_000);
  await expect(f.uploads.purgeExpired(1)).resolves.toEqual({ removed: 1, failed: 0 });
  expect(f.records.size).toBe(0);
  expect(f.blobs.objects.has(staging)).toBe(false);
  expect(f.blobs.objects.has(ready)).toBe(false);
  expect(f.blobs.objects.has(commerceImageUploadKey(second.id, "staging"))).toBe(false);
});

it("does not let a full batch of permanently failing older rows block newer expired photos", async () => {
  const f = fixture();
  const old = new Set<string>();
  const oldExpiry = "2026-11-05T11:00:00.000Z";
  const healthyExpiry = "2026-11-05T11:30:00.000Z";
  const seed = (expires: string, status = "pending") => {
    const id = randomUUID();
    f.records.set(id, {
      id,
      owner: buyer.userId,
      mimeType: "image/png",
      bytes: png.length,
      sha256: hash(png),
      status,
      created: new Date(Date.parse(expires) - 30 * 60_000).toISOString(),
      expires,
      retry: null,
    });
    return id;
  };
  for (let i = 0; i < 20; i++) old.add(commerceImageUploadKey(seed(oldExpiry), "staging"));
  const verifying = seed(oldExpiry, "verifying");
  const healthy = seed(healthyExpiry);
  f.remove.mockImplementation(async (key) => {
    if (old.has(key)) throw new Error("Synthetic permanent removal failure");
    await FakeBlobStore.prototype.remove.call(f.blobs, key);
  });

  await expect(f.uploads.purgeExpired()).resolves.toEqual({ removed: 0, failed: 20 });
  f.advance(5 * 60_000);
  await expect(f.uploads.purgeExpired()).resolves.toEqual({ removed: 1, failed: 0 });
  expect(f.records.has(healthy)).toBe(false);
  expect(f.records.get(verifying)?.status).toBe("verifying");
  expect(f.remove).not.toHaveBeenCalledWith(commerceImageUploadKey(verifying, "staging"));
  f.advance(10 * 60_000 - 1);
  await expect(f.uploads.purgeExpired()).resolves.toEqual({ removed: 0, failed: 0 });
  f.advance(1);
  await expect(f.uploads.purgeExpired()).resolves.toEqual({ removed: 0, failed: 20 });
  expect(f.records.size).toBe(21);
});

it("claims expired photos once when cleanup sweeps overlap", async () => {
  const f = fixture();
  const { id } = await f.uploads.create(buyer, declaration);
  f.advance(31 * 60_000);
  const active = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  f.remove.mockImplementationOnce(async () => {
    active.resolve();
    await finish.promise;
  });
  const first = f.uploads.purgeExpired();
  await active.promise;
  try {
    await expect(f.uploads.purgeExpired()).resolves.toEqual({ removed: 0, failed: 0 });
    expect(f.remove).toHaveBeenCalledExactlyOnceWith(commerceImageUploadKey(id, "staging"));
  } finally {
    finish.resolve();
  }
  await expect(first).resolves.toEqual({ removed: 1, failed: 0 });
  expect(f.remove).toHaveBeenCalledTimes(2);
  expect(f.records.has(id)).toBe(false);
});

it("validates the exact JSON body before quota, presign or database calls", async () => {
  const f = fixture();
  for (const body of [
    null,
    [],
    true,
    "image/png",
    {},
    { ...declaration, name: "legacy.png" },
    { ...declaration, size: String(declaration.size) },
    { ...declaration, mimeType: ["image/png"] },
    { ...declaration, sha256: [declaration.sha256] },
    { ...declaration, expectedUserId: "not-an-account-id" },
  ])
    await expect(f.uploads.create(buyer, body)).rejects.toMatchObject({
      status: 400,
      code: "bad_request",
    });
  for (const body of [
    null,
    [],
    buyer.userId,
    { ...complete, fileId: randomUUID() },
    { expectedUserId: [buyer.userId] },
  ])
    await expect(f.uploads.complete(buyer, randomUUID(), body)).rejects.toMatchObject({
      status: 400,
      code: "bad_request",
    });
  expect(f.quota).not.toHaveBeenCalled();
  expect(f.query).not.toHaveBeenCalled();
  expect(f.presign).not.toHaveBeenCalled();
});

it("does not orphan a ready key when expiry cleanup overlaps a still-running storage write", async () => {
  const f = fixture();
  const { id } = await f.uploads.create(buyer, declaration);
  const staging = commerceImageUploadKey(id, "staging");
  const ready = commerceImageUploadKey(id, "ready");
  f.blobs.put(staging, png, "image/png");
  let finishWrite!: () => void;
  let started!: () => void;
  const active = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.write.mockImplementationOnce(async (key, bytes, mime) => {
    started();
    await new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    await FakeBlobStore.prototype.write.call(f.blobs, key, bytes, mime);
  });
  const finishing = f.uploads.complete(buyer, id, complete);
  await active;
  f.advance(31 * 60_000);
  await expect(f.uploads.purgeExpired()).resolves.toEqual({ removed: 0, failed: 0 });
  expect(f.remove).not.toHaveBeenCalled();
  expect(f.records.get(id)?.status).toBe("verifying");
  await expect(f.uploads.fileUrl(buyer, id)).rejects.toMatchObject({ status: 404 });
  const expired = expect(finishing).rejects.toMatchObject({ status: 404 });
  finishWrite();
  await expired;
  expect(f.records.get(id)?.status).toBe("pending");
  await expect(f.uploads.purgeExpired()).resolves.toEqual({ removed: 1, failed: 0 });
  expect(f.blobs.objects.has(staging)).toBe(false);
  expect(f.blobs.objects.has(ready)).toBe(false);
});

it("does not delete sealed bytes when the ready database commit succeeded but the response was lost", async () => {
  const f = fixture();
  const { id } = await f.uploads.create(buyer, declaration);
  const staging = commerceImageUploadKey(id, "staging");
  const ready = commerceImageUploadKey(id, "ready");
  f.blobs.put(staging, png, "image/png");
  const query = f.query.getMockImplementation()!;
  f.query.mockImplementation(async (statement, values) => {
    const result = await query(statement, values);
    if (statement.startsWith('update "commerce_image_uploads"') && values[0] === "ready")
      throw new Error("Synthetic ready response lost");
    return result;
  });
  await expect(f.uploads.complete(buyer, id, complete)).rejects.toThrow();
  expect(f.records.get(id)?.status).toBe("ready");
  expect(f.blobs.objects.get(ready)?.bytes).toEqual(png);
  await expect(f.uploads.complete(buyer, id, complete)).resolves.toMatchObject({ id });
  expect(f.write).toHaveBeenCalledOnce();
});

it("retains the cleanup row if a failed storage response may hide a late PUT", async () => {
  const f = fixture();
  const { id } = await f.uploads.create(buyer, declaration);
  const staging = commerceImageUploadKey(id, "staging");
  const ready = commerceImageUploadKey(id, "ready");
  f.blobs.put(staging, png, "image/png");
  f.write.mockRejectedValueOnce(new Error("Synthetic PUT response lost"));
  await expect(f.uploads.complete(buyer, id, complete)).rejects.toThrow(
    "Synthetic PUT response lost",
  );
  expect(f.records.get(id)?.status).toBe("verifying");
  f.advance(31 * 60_000);
  await expect(f.uploads.purgeExpired()).resolves.toEqual({ removed: 0, failed: 0 });
  f.blobs.put(ready, png, "image/png"); // Simulate storage finishing after its response was lost.
  await expect(f.uploads.fileUrl(buyer, id)).rejects.toMatchObject({ status: 404 });
  expect(f.records.has(id)).toBe(true);
  expect(f.sign).not.toHaveBeenCalled();
});
