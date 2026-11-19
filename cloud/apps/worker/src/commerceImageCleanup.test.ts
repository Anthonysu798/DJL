import { blobStoreFromEnv } from "@djl/api/blobs";
import type { DjlDatabase } from "@djl/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { purge } = vi.hoisted(() => ({ purge: vi.fn() }));
vi.mock("@djl/api/commerce-image-uploads", () => ({ purgeExpiredCommerceImageUploads: purge }));

import { COMMERCE_IMAGE_CLEANUP, JOBS } from "./jobs.ts";

const now = new Date("2026-11-05T12:00:00Z");
const deps = { db: {} as DjlDatabase, blobs: { remove: vi.fn(async () => {}) }, now: () => now };

beforeEach(() => {
  purge.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

it("dispatches the periodic cleanup in a fixed small batch without an image-search flag", async () => {
  vi.stubEnv("DJL_COMMERCE_IMAGE_ENABLED", "false");
  expect(COMMERCE_IMAGE_CLEANUP).toEqual({
    name: "commerce.image-uploads.purge-expired",
    schedule: "*/5 * * * *",
  });
  const run = JOBS[COMMERCE_IMAGE_CLEANUP.name];
  purge.mockResolvedValue({ removed: 2, failed: 1, upstreamDetail: "private object URL" });
  await expect(run(deps)).resolves.toEqual({ removed: 2, failed: 1 });
  expect(purge).toHaveBeenCalledExactlyOnceWith(deps.db, deps.blobs, 20, now);
});

it("returns a generic worker failure instead of logging the storage exception", async () => {
  const run = JOBS[COMMERCE_IMAGE_CLEANUP.name];
  purge.mockRejectedValue(new Error("private object URL with signature"));
  await expect(run(deps)).rejects.toEqual(new Error("commerce_image_cleanup_failed"));
});

it("leaves database metadata untouched when the worker falls back to in-memory storage", async () => {
  const blobs = blobStoreFromEnv({}, { mockExternals: true });
  const run = JOBS[COMMERCE_IMAGE_CLEANUP.name];
  purge.mockResolvedValue({ removed: 20, failed: 0 });
  await expect(run({ ...deps, blobs })).resolves.toEqual({
    skipped: "durable_storage_unavailable",
  });
  expect(purge).not.toHaveBeenCalled();
});
