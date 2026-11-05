import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lte, ne, or, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type {
  CommerceImageUploadCompleteInput,
  CommerceImageUploadInput,
  CommerceImageUploadReceipt,
  CommerceImageUploadResponse,
} from "@synara/contracts/cloud";

import type { Principal } from "../auth/guard.ts";
import { bytesMatchType } from "../files/fileTypes.ts";
import type { RateLimiter } from "../gateway/RateLimiter.ts";
import { ApiError } from "../http/errors.ts";
import { BlobReadLimitError, type BlobStore } from "../sync/BlobStore.ts";

const MAX_BYTES = 10 * 1024 * 1024;
const RETENTION_MS = 30 * 60_000;
const MAX_PUT_SECONDS = 600;
const MAX_GET_SECONDS = 60;
const CLEANUP_GRACE_MS = 60_000;
const CLEANUP_RETRY_MS = 15 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const unavailable = () =>
  new ApiError(
    503,
    "image_search_unavailable",
    "Image search is not available. Use text search instead.",
  );
const notFound = () => new ApiError(404, "file_unavailable", "Image is unavailable.");
const uploadMismatch = () =>
  new ApiError(400, "upload_mismatch", "The uploaded image did not match what was declared.");
const uploadMissing = () =>
  new ApiError(400, "upload_missing", "Upload the image before completing it.");
const inProgress = () =>
  new ApiError(409, "upload_in_progress", "This upload is being checked. Try again shortly.");
const limit = () =>
  new ApiError(429, "image_search_limit", "Image upload limit reached. Try later.");

export const commerceImageUploadKey = (id: string, phase: "staging" | "ready"): string =>
  `commerce/image-uploads/${id}/${phase}`;

type Owner = Pick<Principal, "userId">;
type Buyer = Owner & Pick<Principal, "emailVerified">;

function verifiedBuyer(p: Buyer, expectedUserId: string): void {
  if (!p.emailVerified)
    throw new ApiError(
      403,
      "email_verification_required",
      "Verify your email before commerce operations.",
    );
  if (p.userId !== expectedUserId)
    throw new ApiError(409, "commerce_account_changed", "The signed-in commerce account changed.");
}

function privateUrl(value: string): string {
  const url = URL.parse(value);
  if (!url || url.protocol !== "https:" || url.username || url.password || url.hash)
    throw unavailable();
  return url.href;
}

const badRequest = () => new ApiError(400, "bad_request", "Invalid commerce image upload request.");

function exactObject(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Object.getPrototypeOf(raw) !== Object.prototype)
    throw badRequest();
  const values = raw as Record<string, unknown>;
  if (Object.keys(values).length !== keys.length || keys.some((key) => !Object.hasOwn(values, key)))
    throw badRequest();
  return values;
}

function uploadInput(raw: unknown): CommerceImageUploadInput {
  const { expectedUserId, mimeType, size, sha256 } = exactObject(raw, [
    "expectedUserId",
    "mimeType",
    "size",
    "sha256",
  ]);
  if (
    typeof expectedUserId !== "string" ||
    !UUID.test(expectedUserId) ||
    typeof mimeType !== "string" ||
    typeof size !== "number" ||
    typeof sha256 !== "string"
  )
    throw badRequest();
  return { expectedUserId, mimeType, size, sha256 };
}

function completionInput(raw: unknown): CommerceImageUploadCompleteInput {
  const { expectedUserId } = exactObject(raw, ["expectedUserId"]);
  if (typeof expectedUserId !== "string" || !UUID.test(expectedUserId)) throw badRequest();
  return { expectedUserId };
}

export class CommerceImageUploads {
  constructor(
    private readonly db: DjlDatabase,
    private readonly blobs: BlobStore,
    private readonly options: {
      readonly enabled: () => boolean | Promise<boolean>;
      readonly limiter: Pick<RateLimiter, "hit" | "acquire">;
      readonly now?: () => Date;
      /** Trusted offline staging may preserve a sealed ID; HTTP inputs cannot set it. */
      readonly allocateUploadId?: () => string;
    },
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async allowUpload(): Promise<void> {
    if (!(await this.options.enabled())) throw unavailable();
  }

  private async own(p: Owner, id: string) {
    if (!UUID.test(id)) throw notFound();
    const t = schema.commerceImageUploads;
    const [row] = await this.db
      .select()
      .from(t)
      .where(and(eq(t.id, id), eq(t.userId, p.userId), gt(t.expiresAt, this.now())))
      .limit(1);
    if (!row) throw notFound();
    return row;
  }

  async create(p: Buyer, raw: unknown): Promise<CommerceImageUploadResponse> {
    await this.allowUpload();
    const input = uploadInput(raw);
    verifiedBuyer(p, input.expectedUserId);
    if (!["image/jpeg", "image/png", "image/webp"].includes(input.mimeType))
      throw new ApiError(400, "unsupported_type", "Images must be JPEG, PNG, or WebP.");
    if (input.size > MAX_BYTES)
      throw new ApiError(413, "file_too_large", "Images must be no larger than 10 MB.");
    if (!Number.isSafeInteger(input.size) || input.size < 1 || !/^[a-f0-9]{64}$/.test(input.sha256))
      throw new ApiError(400, "bad_request", "A positive size and lowercase SHA-256 are required.");

    const userKey = createHash("sha256").update(p.userId).digest("hex");
    for (const [suffix, count, seconds] of [
      ["minute", 6, 60],
      ["day", 30, 86400],
    ] as const) {
      if (
        !(
          await this.options.limiter.hit(
            `commerce:image-upload:${userKey}:${suffix}`,
            count,
            seconds,
          )
        ).allowed
      )
        throw limit();
    }
    const id = (this.options.allocateUploadId ?? randomUUID)();
    if (!UUID.test(id)) throw unavailable();
    const staging = commerceImageUploadKey(id, "staging");
    const signed = await this.blobs.presignUpload(staging, input.mimeType, input.size);
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + RETENTION_MS);
    const grantExpires = Date.parse(signed.expiresAt);
    const url = privateUrl(signed.url);
    if (
      !(
        grantExpires > createdAt.getTime() &&
        grantExpires <= createdAt.getTime() + MAX_PUT_SECONDS * 1000
      ) ||
      signed.headers["content-type"] !== input.mimeType ||
      signed.headers["content-length"] !== String(input.size) ||
      Object.keys(signed.headers).length !== 2
    )
      throw unavailable();

    await this.db.insert(schema.commerceImageUploads).values({
      id,
      userId: p.userId,
      mimeType: input.mimeType,
      sizeBytes: input.size,
      sha256: input.sha256,
      createdAt,
      expiresAt,
    });
    return {
      id,
      userId: p.userId,
      upload: { url, method: "PUT", headers: signed.headers },
    };
  }

  async complete(p: Buyer, id: string, raw: unknown): Promise<CommerceImageUploadReceipt> {
    await this.allowUpload();
    verifiedBuyer(p, completionInput(raw).expectedUserId);
    const userKey = createHash("sha256").update(p.userId).digest("hex");
    if (!(await this.options.limiter.hit(`commerce:image-complete:${userKey}`, 12, 60)).allowed)
      throw limit();
    const row = await this.own(p, id);
    const receipt = { id: row.id, userId: p.userId };
    if (row.status === "ready") return receipt;
    if (row.status === "rejected")
      throw new ApiError(
        400,
        "upload_rejected",
        "This image upload was rejected. Choose it again.",
      );
    if (row.status !== "pending") throw inProgress();

    const hold = await this.options.limiter.acquire(`commerce:image-complete:${userKey}`, 2, 45);
    if (!hold.acquired) throw limit();
    const t = schema.commerceImageUploads;
    const owner = and(eq(t.id, row.id), eq(t.userId, p.userId));
    const claim = and(owner, eq(t.status, "verifying"));
    const staging = commerceImageUploadKey(row.id, "staging");
    const ready = commerceImageUploadKey(row.id, "ready");
    let claimed = false;
    let committed = false;
    let rejected = false;
    let writeUnconfirmed = false;
    try {
      const [reserved] = await this.db
        .update(t)
        .set({ status: "verifying" })
        .where(and(owner, eq(t.status, "pending"), gt(t.expiresAt, this.now())))
        .returning({ id: t.id });
      if (!reserved) throw inProgress();
      claimed = true;

      // The client can only PUT its declared length, and the HEAD checks it before reading.
      const head = await this.blobs.head(staging);
      if (!head) throw uploadMissing();
      if (head.sizeBytes !== row.sizeBytes) {
        rejected = true;
        throw uploadMismatch();
      }
      const bytes = await this.blobs.read(staging, row.sizeBytes).catch((error: unknown) => {
        if (error instanceof BlobReadLimitError) {
          rejected = true;
          throw uploadMismatch();
        }
        throw error;
      });
      if (!bytes) throw uploadMissing();
      if (
        bytes.byteLength !== row.sizeBytes ||
        !bytesMatchType(row.mimeType, bytes) ||
        createHash("sha256").update(bytes).digest("hex") !== row.sha256
      ) {
        rejected = true;
        throw uploadMismatch();
      }
      if (row.expiresAt <= this.now()) throw notFound();

      // The signed client PUT can replay on staging; only the server ever writes ready.
      writeUnconfirmed = true;
      await this.blobs.write(ready, bytes, row.mimeType);
      writeUnconfirmed = false;
      const [saved] = await this.db
        .update(t)
        .set({ status: "ready" })
        .where(and(claim, gt(t.expiresAt, this.now())))
        .returning({ id: t.id });
      if (!saved) {
        await this.blobs.remove(ready).catch(() => undefined);
        throw notFound();
      }
      committed = true;
      await this.blobs.remove(staging).catch(() => undefined);
      return receipt;
    } finally {
      try {
        // A transport failure may have left a remote PUT in flight. Keep its cleanup row.
        if (claimed && !committed && !writeUnconfirmed) {
          // Never delete ready on an ambiguous DB outcome: a committed response may be lost.
          await this.db
            .update(t)
            .set({ status: rejected ? "rejected" : "pending" })
            .where(claim);
          if (rejected) await this.blobs.remove(staging).catch(() => undefined);
        }
      } finally {
        await hold.release().catch(() => undefined);
      }
    }
  }

  /** The offline evaluator reads the same verified, owner-scoped object as live search. */
  async readyPhoto(p: Owner, id: string) {
    const row = await this.own(p, id);
    if (row.status !== "ready") throw notFound();
    return {
      id: row.id,
      storageKey: commerceImageUploadKey(row.id, "ready"),
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      expiresAt: row.expiresAt,
    };
  }

  /** Provider-only. No renderer route returns a signed GET or a storage key. */
  async fileUrl(p: Owner, id: string): Promise<string> {
    const photo = await this.readyPhoto(p, id);
    const before = this.now().getTime();
    const remaining = Math.floor((photo.expiresAt.getTime() - before) / 1000) - 1;
    if (remaining < 1) throw notFound();
    const seconds = Math.min(MAX_GET_SECONDS, remaining);
    const signed = await this.blobs.presignDownload(photo.storageKey, seconds);
    const grantExpires = Date.parse(signed.expiresAt);
    const after = this.now().getTime();
    if (
      !(
        grantExpires > after &&
        grantExpires <= after + seconds * 1000 &&
        grantExpires <= photo.expiresAt.getTime()
      )
    )
      throw unavailable();
    return privateUrl(signed.url);
  }

  async purgeExpired(maxRows = 20): Promise<{ removed: number; failed: number }> {
    return purgeExpiredCommerceImageUploads(this.db, this.blobs, maxRows, this.now());
  }
}

/**
 * Claim expired non-writing records before removing their objects. A verifying
 * row still owns its key even after expiry: a storage write can outlive the
 * request and cannot be cancelled through BlobStore. Keep that row for retry;
 * deploy a storage lifecycle on this prefix to cover crashed verifiers. A
 * claim also schedules the next attempt so failed removals or crashed cleanup
 * workers do not monopolize later sweeps.
 */
export async function purgeExpiredCommerceImageUploads(
  db: DjlDatabase,
  blobs: Pick<BlobStore, "remove">,
  maxRows = 20,
  now = new Date(),
): Promise<{ removed: number; failed: number }> {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100)
    throw new Error("Invalid commerce image cleanup batch size.");
  const t = schema.commerceImageUploads;
  const cutoff = new Date(now.getTime() - CLEANUP_GRACE_MS);
  const retryAt = new Date(now.getTime() + CLEANUP_RETRY_MS);
  const due = and(
    lte(t.expiresAt, cutoff),
    ne(t.status, "verifying"),
    or(isNull(t.cleanupRetryAt), lte(t.cleanupRetryAt, now)),
  );
  const rows = await db
    .select({ id: t.id })
    .from(t)
    .where(due)
    .orderBy(sql`coalesce(${t.cleanupRetryAt}, ${t.expiresAt})`, t.id)
    .limit(maxRows);
  let removed = 0;
  let failed = 0;
  for (const { id } of rows) {
    try {
      const [claimed] = await db
        .update(t)
        .set({ status: "rejected", cleanupRetryAt: retryAt })
        .where(and(eq(t.id, id), due))
        .returning({ id: t.id });
      if (!claimed) continue;
      await blobs.remove(commerceImageUploadKey(id, "staging"));
      await blobs.remove(commerceImageUploadKey(id, "ready"));
      const deleted = await db
        .delete(t)
        .where(
          and(
            eq(t.id, id),
            eq(t.status, "rejected"),
            lte(t.expiresAt, cutoff),
            eq(t.cleanupRetryAt, retryAt),
          ),
        )
        .returning({ id: t.id });
      removed += deleted.length;
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}
