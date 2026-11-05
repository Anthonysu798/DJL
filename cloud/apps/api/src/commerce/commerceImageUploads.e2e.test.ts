/** Real SQL and HTTP route layers with synthetic principals, storage, and inference. */
import { createHash, randomUUID } from "node:crypto";
import { schema } from "@djl/db";
import type { ProviderAdapter } from "@djl/providers";
import type { CommerceImageUploadResponse, CommerceProduct } from "@synara/contracts/cloud";
import { eq } from "drizzle-orm";
import { Layer, ServiceMap } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import type { Principal, PrincipalResolver } from "../auth/guard.ts";
import { Settings } from "../config/settings.ts";
import { FileService, storageKey } from "../files/FileService.ts";
import { createMemoryRateLimiter } from "../gateway/RateLimiter.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import { FakeBlobStore } from "../sync/BlobStore.ts";
import { isolatedCommerceTestDatabase } from "../testing/isolatedDb.ts";
import {
  CommerceImageUploads,
  commerceImageUploadKey,
  purgeExpiredCommerceImageUploads,
} from "./CommerceImageUploads.ts";
import { CommerceImageSearchService } from "./ImageSearchService.ts";
import {
  makeCommerceImageSearchRoutes,
  makeCommerceImageUploadRoutes,
} from "./imageSearchRoutes.ts";

const dbHandle = await isolatedCommerceTestDatabase();
const blob = new FakeBlobStore();
const signDownload = vi.spyOn(blob, "presignDownload");
const limiter = createMemoryRateLimiter();
const settings = new Settings(dbHandle.db);
const files = new FileService(dbHandle.db, blob, settings);
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 4, 9, 12]);
const digest = createHash("sha256").update(png).digest("hex");
const fixturePrincipal = (name: string): Principal => {
  const orgId = randomUUID();
  return {
    userId: randomUUID(),
    email: `${name}@example.invalid`,
    emailVerified: true,
    banned: false,
    sessionId: randomUUID(),
    orgId,
    personalOrgId: orgId,
    role: "owner",
  };
};
const a = fixturePrincipal("shop-image-buyer-a");
const b = fixturePrincipal("shop-image-buyer-b");
beforeAll(async () => {
  for (const p of [a, b]) {
    await dbHandle.db.insert(schema.user).values({ id: p.userId, email: p.email, name: "Fixture" });
    await dbHandle.db.insert(schema.organization).values({
      id: p.orgId,
      name: "Fixture",
      slug: p.orgId,
      createdAt: new Date(),
    });
  }
});

let enabled = false;
const uploads = new CommerceImageUploads(dbHandle.db, blob, { enabled: () => enabled, limiter });
const provider = {
  id: "openai",
  chatStream: vi.fn(async function* () {
    yield {
      delta: { content: '{"isProduct":false,"keywords":[],"description":""}' },
      finish_reason: "stop",
    };
  }),
} as unknown as ProviderAdapter;
const product: CommerceProduct = {
  id: randomUUID(),
  sku: "SYNTHETIC-01",
  name: "Fixture tote",
  category: "Bags",
  description: "Synthetic catalogue item",
  imageUrl: "https://media.example.invalid/tote.png",
  priceCents: 2000,
  commissionBps: 0,
  stock: 4,
  returnDays: 30,
};
const budget = { reserve: vi.fn(async () => ({ accepted: true, settle: vi.fn(async () => {}) })) };
const imageSearch = new CommerceImageSearchService({
  enabled: true,
  async configuration() {
    return {
      modelId: "fixture-vision",
      upstreamModelId: "fixture-vision",
      provider,
      contextWindow: 10_000,
      inputUsdPerMillion: "1",
      outputUsdPerMillion: "2",
      dailyBudgetUsdCents: 100,
      mediaOrigin: "https://media.example.invalid",
    };
  },
  fileUrl: (p, id) => uploads.fileUrl(p, id),
  catalog: async () => ({ products: [product] }),
  limiter,
  budget,
  audit: () => undefined,
});
const principals: PrincipalResolver = {
  resolve: async ({ headers }) => {
    switch (headers.get("x-fixture-buyer")) {
      case "buyer-a":
        return a;
      case "buyer-b":
        return b;
      case "unverified":
        return { ...a, emailVerified: false };
      default:
        throw new ApiError(401, "unauthorized", "Sign in required.");
    }
  },
};
const router = HttpRouter.toWebHandler(
  Layer.mergeAll(
    makeCommerceImageUploadRoutes({ imageUploads: uploads, principals }),
    makeCommerceImageSearchRoutes({ imageSearch, principals }),
  ),
  { disableLogger: true },
);
afterAll(async () => {
  try {
    await router.dispose();
  } finally {
    await dbHandle.close();
  }
});

const path = "/v1/commerce/image-uploads";
const input = {
  expectedUserId: a.userId,
  mimeType: "image/png",
  size: png.byteLength,
  sha256: digest,
};
const context = ServiceMap.make(RequestContext, {
  traceId: "dedicated-photo-fixture",
  ip: "127.0.0.1",
  userAgent: null,
  region: "test",
  startedAt: Date.now(),
});
const post = (url: string, body: object, caller = "buyer-a") =>
  router.handler(
    new Request(`http://127.0.0.1${url}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-fixture-buyer": caller },
      body: JSON.stringify(body),
    }),
    context,
  );

it("does not issue a storage capability when the feature is off or the caller is ineligible", async () => {
  enabled = false;
  expect((await post(path, input)).status).toBe(503);
  enabled = true;
  expect((await post(path, input, "guest")).status).toBe(401);
  expect((await post(path, input, "unverified")).status).toBe(403);
  expect((await post(path, input, "buyer-b")).status).toBe(409);
  expect((await post(path, { ...input, name: "should-not-be-accepted.png" })).status).toBe(400);
  expect(await dbHandle.db.select().from(schema.commerceImageUploads)).toHaveLength(0);
  expect(blob.objects.size).toBe(0);
});

it("keeps valid AI attachments and commerce photos invisible to the other reader", async () => {
  enabled = true;
  signDownload.mockClear();
  const ai = await files.create(a, {
    name: "synthetic-ai.png",
    mimeType: "image/png",
    size: png.byteLength,
    sha256: digest,
    purpose: "image",
  });
  blob.put(storageKey(a.orgId, ai.file.id), png, "image/png");
  expect((await files.complete(a, ai.file.id)).status).toBe("ready");
  const create = await post(path, input);
  expect(create.status).toBe(201);
  const receipt = (await create.json()) as CommerceImageUploadResponse;
  expect(receipt.userId).toBe(a.userId);
  expect(receipt.upload.method).toBe("PUT");
  expect((await post("/v1/commerce/image-search", { fileId: ai.file.id })).status).toBe(404);
  expect((await post("/v1/commerce/image-search", { fileId: receipt.id })).status).toBe(404);
  const finish = `${path}/${receipt.id}/complete`;
  expect((await post(finish, { expectedUserId: b.userId }, "buyer-b")).status).toBe(404);
  expect(signDownload).not.toHaveBeenCalled();
  expect(budget.reserve).not.toHaveBeenCalled();
  expect(provider.chatStream).not.toHaveBeenCalled();

  const staging = commerceImageUploadKey(receipt.id, "staging");
  blob.put(staging, png, "image/png");
  const completed = await post(finish, { expectedUserId: a.userId });
  expect(completed.status).toBe(200);
  expect(await completed.json()).toEqual({ id: receipt.id, userId: a.userId });
  // A replay of the originally signed PUT cannot alter the immutable provider object.
  blob.put(staging, new Uint8Array(png.byteLength), "image/png");
  expect((await post(finish, { expectedUserId: a.userId })).status).toBe(200);
  expect(await blob.read(commerceImageUploadKey(receipt.id, "ready"))).toEqual(png);
  expect((await post("/v1/commerce/image-search", { fileId: receipt.id }, "buyer-b")).status).toBe(
    404,
  );
  await expect(files.downloadUrl(a, receipt.id)).rejects.toMatchObject({ status: 404 });
  expect(signDownload).not.toHaveBeenCalled();
  expect(budget.reserve).not.toHaveBeenCalled();
  const found = await post("/v1/commerce/image-search", { fileId: receipt.id });
  expect(found.status).toBe(200);
  expect(await found.json()).toMatchObject({ products: [], matchType: "similar" });
  expect(signDownload).toHaveBeenCalledExactlyOnceWith(
    commerceImageUploadKey(receipt.id, "ready"),
    60,
  );
  expect(provider.chatStream).toHaveBeenCalledTimes(1);
  expect(await files.downloadUrl(a, ai.file.id)).toHaveProperty("expiresAt");
});

it("cleans expired shop objects while search is disabled without removing any AI attachment", async () => {
  enabled = true;
  const receipt = await uploads.create(a, input);
  const staging = commerceImageUploadKey(receipt.id, "staging");
  const ready = commerceImageUploadKey(receipt.id, "ready");
  blob.put(staging, png, "image/png");
  await uploads.complete(a, receipt.id, { expectedUserId: a.userId });
  blob.put(staging, png, "image/png");
  const aiKey = storageKey(a.orgId, randomUUID());
  blob.put(aiKey, png, "image/png");
  const now = new Date();
  await dbHandle.db
    .update(schema.commerceImageUploads)
    .set({
      createdAt: new Date(now.getTime() - 40 * 60_000),
      expiresAt: new Date(now.getTime() - 10 * 60_000),
    })
    .where(eq(schema.commerceImageUploads.id, receipt.id));
  enabled = false;
  await expect(uploads.readyPhoto(a, receipt.id)).rejects.toMatchObject({ status: 404 });
  await expect(purgeExpiredCommerceImageUploads(dbHandle.db, blob, 20, now)).resolves.toEqual({
    removed: 1,
    failed: 0,
  });
  expect(await blob.read(staging)).toBeNull();
  expect(await blob.read(ready)).toBeNull();
  expect(await blob.read(aiKey)).toEqual(png);
  expect(
    await dbHandle.db.query.commerceImageUploads.findFirst({
      where: eq(schema.commerceImageUploads.id, receipt.id),
    }),
  ).toBeUndefined();
});

it("backs off a full failed cleanup batch while retaining photos and making progress on later rows", async () => {
  const db = dbHandle.db;
  const table = schema.commerceImageUploads;
  const start = Date.now() - 24 * 60 * 60_000;
  const minute = 60_000;
  const photo = (offset: number, status: "pending" | "verifying" = "pending") => ({
    id: randomUUID(),
    userId: a.userId,
    mimeType: "image/png",
    sizeBytes: png.length,
    sha256: digest,
    status,
    createdAt: new Date(start + (offset - 30) * minute),
    expiresAt: new Date(start + offset * minute),
  });
  const failed = Array.from({ length: 20 }, () => photo(-60));
  const healthy = photo(-5);
  const later = photo(10);
  const verifying = photo(-120, "verifying");
  const unexpired = photo(30);
  await db.insert(table).values([...failed, healthy, later, verifying, unexpired]);

  const keys = (id: string) => [
    commerceImageUploadKey(id, "staging"),
    commerceImageUploadKey(id, "ready"),
  ];
  const unknownKey = commerceImageUploadKey(randomUUID(), "staging");
  const fake = new FakeBlobStore();
  for (const key of [...failed, healthy, later, verifying, unexpired].flatMap((row) =>
    keys(row.id),
  ))
    fake.put(key, png, "image/png");
  fake.put(unknownKey, png, "image/png");
  const blocked = new Set(failed.map((row) => keys(row.id)[0]));
  const remove = vi.fn(async (key: string) => {
    if (blocked.has(key)) throw new Error("Synthetic permanent delete failure");
    await fake.remove(key);
  });
  const sweep = (offset: number, max = 20) =>
    purgeExpiredCommerceImageUploads(db, { remove }, max, new Date(start + offset * minute));
  const stored = (id: string) =>
    db.query.commerceImageUploads.findFirst({ where: eq(table.id, id) });

  await expect(sweep(0)).resolves.toEqual({ removed: 0, failed: 20 });
  await expect(stored(failed[0]!.id)).resolves.toMatchObject({
    status: "rejected",
    cleanupRetryAt: new Date(start + 15 * minute),
    expiresAt: failed[0]!.expiresAt,
    userId: a.userId,
    sha256: digest,
  });
  await expect(sweep(5)).resolves.toEqual({ removed: 1, failed: 0 });
  await expect(stored(healthy.id)).resolves.toBeUndefined();
  // Even once the old retries are due, the unattempted row is earlier in the queue.
  await expect(sweep(15, 1)).resolves.toEqual({ removed: 1, failed: 0 });
  await expect(stored(later.id)).resolves.toBeUndefined();
  await expect(sweep(15)).resolves.toEqual({ removed: 0, failed: 20 });
  await expect(stored(failed[0]!.id)).resolves.toMatchObject({
    cleanupRetryAt: new Date(start + 30 * minute),
    expiresAt: failed[0]!.expiresAt,
  });
  await expect(stored(verifying.id)).resolves.toMatchObject({
    status: "verifying",
    cleanupRetryAt: null,
  });
  await expect(stored(unexpired.id)).resolves.toMatchObject({
    status: "pending",
    cleanupRetryAt: null,
  });
  for (const key of [...failed, verifying, unexpired]
    .flatMap((row) => keys(row.id))
    .concat(unknownKey))
    expect(fake.objects.has(key)).toBe(true);
  for (const key of [healthy, later].flatMap((row) => keys(row.id)))
    expect(fake.objects.has(key)).toBe(false);
  for (const key of [verifying, unexpired].flatMap((row) => keys(row.id)).concat(unknownKey))
    expect(remove).not.toHaveBeenCalledWith(key);
});
