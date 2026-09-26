/**
 * Private uploads. The client asks for a presigned PUT pinned to the declared
 * size and type, uploads the bytes directly to storage, then completes the
 * file. A file is usable in messages only once its status is `ready`.
 */
import { Schema } from "effect";

import { TrimmedNonEmptyString } from "../baseSchemas";
import { CloudFileId } from "./base";

/** Largest upload the API accepts, in bytes. Plans may allow less. */
export const CLOUD_FILE_MAX_BYTES = 25 * 1024 * 1024;

export const CloudFileStatus = Schema.Literals(["pending", "scanning", "ready", "rejected"]);
export type CloudFileStatus = typeof CloudFileStatus.Type;

export const CloudFile = Schema.Struct({
  id: CloudFileId,
  name: TrimmedNonEmptyString,
  mimeType: TrimmedNonEmptyString,
  size: Schema.Int,
  status: CloudFileStatus,
  createdAt: Schema.String,
});
export type CloudFile = typeof CloudFile.Type;

/** `image` files can be sent as image_ref parts and must be images; `attachment` is anything else. */
export const CloudFilePurpose = Schema.Literals(["attachment", "image"]);
export type CloudFilePurpose = typeof CloudFilePurpose.Type;

// POST /v1/files
export const CloudFilePresignInput = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  size: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(CLOUD_FILE_MAX_BYTES),
  ),
  /** Lowercase hex SHA-256 of the bytes; completing the upload verifies it. */
  sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  purpose: CloudFilePurpose,
});
export type CloudFilePresignInput = typeof CloudFilePresignInput.Type;

export const CloudFilePresignResponse = Schema.Struct({
  file: CloudFile,
  upload: Schema.Struct({
    url: TrimmedNonEmptyString,
    method: Schema.Literal("PUT"),
    /** Headers the PUT must send exactly, including content-type and content-length. */
    headers: Schema.Record(Schema.String, Schema.String),
    expiresAt: Schema.String,
  }),
});
export type CloudFilePresignResponse = typeof CloudFilePresignResponse.Type;

// POST /v1/files/{id}/complete → CloudFile (verifies size, type, and hash)

// GET /v1/files/{id}/url
export const CloudFileDownloadResponse = Schema.Struct({
  /** Signed GET, valid for five minutes. */
  url: TrimmedNonEmptyString,
  expiresAt: Schema.String,
});
export type CloudFileDownloadResponse = typeof CloudFileDownloadResponse.Type;
