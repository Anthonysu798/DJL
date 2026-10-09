/**
 * Private uploads. The client declares name, type, size, and SHA-256, gets a
 * presigned PUT pinned to that type and size, uploads straight to storage
 * under org/{orgId}/files/{fileId}, then completes the file. Completion reads
 * the bytes back and checks size, hash, and magic bytes before the scan gate;
 * any mismatch rejects the file and deletes the object. Downloads are
 * five-minute signed GETs. Every file belongs to one user in one org.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type {
  CloudFile,
  CloudFileDownloadResponse,
  CloudFilePresignInput,
  CloudFilePresignResponse,
  CloudUserMessagePart,
} from "@synara/contracts/cloud";

import type { Principal } from "../auth/guard.ts";
import type { Settings } from "../config/settings.ts";
import { ApiError } from "../http/errors.ts";
import type { BlobStore } from "../sync/BlobStore.ts";
import { bytesMatchType, isImageType, isSupportedType } from "./fileTypes.ts";

export const DOWNLOAD_URL_SECONDS = 300;

export type FileRow = typeof schema.files.$inferSelect;

/** Scan gate: resolves false to reject a file. The default admits everything. */
export type FileScanner = (file: {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}) => Promise<boolean>;

const notFound = () => new ApiError(404, "not_found", "Not found.");

export const storageKey = (orgId: string, fileId: string) => `org/${orgId}/files/${fileId}`;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Buffer.from(digest).toString("hex");
}

export function toFile(row: FileRow): typeof CloudFile.Encoded {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    size: row.sizeBytes,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export class FileService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly blobs: BlobStore,
    private readonly settings: Settings,
    private readonly scan: FileScanner = async () => true,
  ) {}

  async create(
    p: Principal,
    input: CloudFilePresignInput,
  ): Promise<typeof CloudFilePresignResponse.Encoded> {
    if (!isSupportedType(input.mimeType))
      throw new ApiError(400, "unsupported_type", "This file type is not supported.");
    if (input.purpose === "image" && !isImageType(input.mimeType))
      throw new ApiError(400, "unsupported_type", "Images must be PNG, JPEG, GIF, or WebP.");
    const limit = await this.maxBytes(p.orgId);
    if (input.size > limit)
      throw new ApiError(413, "file_too_large", `Files on your plan can be up to ${limit} bytes.`);
    const id = crypto.randomUUID();
    const key = storageKey(p.orgId, id);
    const [row] = await this.db
      .insert(schema.files)
      .values({
        id,
        orgId: p.orgId,
        userId: p.userId,
        name: input.name,
        mimeType: input.mimeType,
        sizeBytes: input.size,
        sha256: input.sha256,
        purpose: input.purpose,
        storageKey: key,
      })
      .returning();
    const upload = await this.blobs.presignUpload(key, input.mimeType, input.size);
    return { file: toFile(row!), upload: { ...upload, method: "PUT" } };
  }

  async complete(p: Principal, id: string): Promise<typeof CloudFile.Encoded> {
    const row = await this.own(p, id);
    if (row.status === "ready") return toFile(row);
    if (row.status !== "pending")
      throw new ApiError(400, "upload_rejected", "This upload was rejected.");
    const bytes = await this.blobs.read(row.storageKey);
    if (!bytes) throw new ApiError(400, "upload_missing", "Upload the file before completing it.");
    const mismatch =
      bytes.byteLength !== row.sizeBytes
        ? "size"
        : (await sha256Hex(bytes)) !== row.sha256
          ? "hash"
          : !bytesMatchType(row.mimeType, bytes)
            ? "type"
            : null;
    if (mismatch) {
      await this.reject(row);
      throw new ApiError(
        400,
        "upload_mismatch",
        `The uploaded file's ${mismatch} does not match what was declared.`,
      );
    }
    await this.setStatus(row.id, "scanning");
    if (!(await this.scan({ mimeType: row.mimeType, bytes }))) {
      await this.reject(row);
      throw new ApiError(400, "upload_rejected", "This upload was rejected.");
    }
    const [ready] = await this.db
      .update(schema.files)
      .set({ status: "ready", completedAt: new Date() })
      .where(eq(schema.files.id, row.id))
      .returning();
    return toFile(ready!);
  }

  async downloadUrl(p: Principal, id: string): Promise<typeof CloudFileDownloadResponse.Encoded> {
    const row = await this.own(p, id);
    if (row.status !== "ready") throw notFound();
    return this.blobs.presignDownload(row.storageKey, DOWNLOAD_URL_SECONDS);
  }

  /**
   * Files referenced by a message must be the sender's own and ready, and
   * image parts must be images. A foreign id looks exactly like a missing one.
   */
  async assertUsable(p: Principal, parts: readonly CloudUserMessagePart[]): Promise<void> {
    const refs = parts.filter((part) => part.type !== "text");
    if (refs.length === 0) return;
    const rows = await this.db
      .select()
      .from(schema.files)
      .where(
        and(
          inArray(
            schema.files.id,
            refs.map((r) => r.fileId),
          ),
          eq(schema.files.orgId, p.orgId),
          eq(schema.files.userId, p.userId),
          eq(schema.files.status, "ready"),
          isNull(schema.files.deletedAt),
        ),
      );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const ref of refs) {
      const row = byId.get(ref.fileId);
      if (!row || (ref.type === "image_ref" && !isImageType(row.mimeType)))
        throw new ApiError(400, "file_unavailable", "A referenced file is missing or not ready.");
    }
  }

  private async own(p: Principal, id: string): Promise<FileRow> {
    const row = await this.db.query.files.findFirst({
      where: and(
        eq(schema.files.id, id),
        eq(schema.files.orgId, p.orgId),
        eq(schema.files.userId, p.userId),
        isNull(schema.files.deletedAt),
      ),
    });
    if (!row) throw notFound();
    return row;
  }

  private async setStatus(id: string, status: FileRow["status"]) {
    await this.db.update(schema.files).set({ status }).where(eq(schema.files.id, id));
  }

  private async reject(row: FileRow) {
    await this.setStatus(row.id, "rejected");
    await this.blobs.remove(row.storageKey);
  }

  private async maxBytes(orgId: string): Promise<number> {
    const limits = await this.settings.get("files.max_upload_bytes");
    const sub = await this.db.query.subscriptions.findFirst({
      columns: { planId: true },
      where: and(eq(schema.subscriptions.orgId, orgId), eq(schema.subscriptions.status, "active")),
    });
    return (sub && limits[sub.planId]) ?? limits.default ?? 25 * 1024 * 1024;
  }
}
