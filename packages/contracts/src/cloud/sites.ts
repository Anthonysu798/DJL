/**
 * Static websites on `{name}.slcor.site`. A user claims a name, then publishes
 * deploys: the client zips the built site, uploads the zip to a presigned PUT,
 * and completes the deploy. The server checks every file before the deploy
 * goes live; a deploy that looks like phishing is held for review instead and
 * the previous deploy stays live.
 */
import { Schema } from "effect";

import { TrimmedNonEmptyString } from "../baseSchemas";

/** Domain every site is served under. */
export const CLOUD_SITES_DOMAIN = "slcor.site";
/** Largest zip a deploy may upload, in bytes. Plans may allow less. */
export const CLOUD_SITE_MAX_ZIP_BYTES = 25 * 1024 * 1024;
/** Most bytes a deploy may hold once unzipped. */
export const CLOUD_SITE_MAX_UNZIPPED_BYTES = 100 * 1024 * 1024;
/** Most files a deploy may hold. Plans may allow less. */
export const CLOUD_SITE_MAX_FILES = 2000;
/** 3-40 characters, lowercase letters, digits and single hyphens, no hyphen at either end. */
export const CLOUD_SITE_NAME_PATTERN = /^(?=.{3,40}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The only file types a site may contain (lowercase extension → served content type). */
export const CLOUD_SITE_FILE_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  pdf: "application/pdf",
};

export const CloudSiteId = TrimmedNonEmptyString.pipe(Schema.brand("CloudSiteId"));
export type CloudSiteId = typeof CloudSiteId.Type;
export const CloudSiteDeployId = TrimmedNonEmptyString.pipe(Schema.brand("CloudSiteDeployId"));
export type CloudSiteDeployId = typeof CloudSiteDeployId.Type;

export const CloudSiteName = Schema.String.check(Schema.isPattern(CLOUD_SITE_NAME_PATTERN));

/** `disabled`: taken down by DJL. Idle sites are unpublished (deleted), not kept. */
export const CloudSiteStatus = Schema.Literals(["active", "disabled"]);
export type CloudSiteStatus = typeof CloudSiteStatus.Type;

export const CloudSiteDeployStatus = Schema.Literals([
  "uploading",
  "live",
  "held",
  "rejected",
  "superseded",
]);
export type CloudSiteDeployStatus = typeof CloudSiteDeployStatus.Type;

export const CloudSiteDeploy = Schema.Struct({
  id: CloudSiteDeployId,
  status: CloudSiteDeployStatus,
  bytes: Schema.Int,
  fileCount: Schema.Int,
  createdAt: Schema.String,
  /** Why the deploy was held or rejected, in plain words. */
  reason: Schema.NullOr(Schema.String),
});
export type CloudSiteDeploy = typeof CloudSiteDeploy.Type;

export const CloudSite = Schema.Struct({
  id: CloudSiteId,
  name: CloudSiteName,
  url: TrimmedNonEmptyString,
  status: CloudSiteStatus,
  /** The deploy visitors see, or null before the first deploy goes live. */
  liveDeploy: Schema.NullOr(CloudSiteDeploy),
  /** The newest finished deploy when it is not the live one (held for review). */
  pendingDeploy: Schema.NullOr(CloudSiteDeploy),
  createdAt: Schema.String,
});
export type CloudSite = typeof CloudSite.Type;

export const CloudSiteLimits = Schema.Struct({
  maxSites: Schema.Int,
  maxZipBytes: Schema.Int,
  maxFiles: Schema.Int,
});
export type CloudSiteLimits = typeof CloudSiteLimits.Type;

// GET /v1/sites
export const CloudSiteListResponse = Schema.Struct({
  sites: Schema.Array(CloudSite),
  limits: CloudSiteLimits,
});
export type CloudSiteListResponse = typeof CloudSiteListResponse.Type;

// GET /v1/sites/name-available?name=
export const CloudSiteNameUnavailableReason = Schema.Literals(["invalid", "reserved", "taken"]);
export type CloudSiteNameUnavailableReason = typeof CloudSiteNameUnavailableReason.Type;
export const CloudSiteNameAvailability = Schema.Struct({
  name: Schema.String,
  available: Schema.Boolean,
  reason: Schema.NullOr(CloudSiteNameUnavailableReason),
});
export type CloudSiteNameAvailability = typeof CloudSiteNameAvailability.Type;

// POST /v1/sites
export const CloudCreateSiteInput = Schema.Struct({
  name: CloudSiteName,
  /** Must be true: the caller accepts the hosting terms. */
  acceptTerms: Schema.Literal(true),
});
export type CloudCreateSiteInput = typeof CloudCreateSiteInput.Type;

export const CloudSiteResponse = Schema.Struct({ site: CloudSite });
export type CloudSiteResponse = typeof CloudSiteResponse.Type;

// POST /v1/sites/{id}/deploys
export const CloudCreateSiteDeployInput = Schema.Struct({
  size: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(22),
    Schema.isLessThanOrEqualTo(CLOUD_SITE_MAX_ZIP_BYTES),
  ),
  /** Lowercase hex SHA-256 of the zip; completing the deploy verifies it. */
  sha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
});
export type CloudCreateSiteDeployInput = typeof CloudCreateSiteDeployInput.Type;

export const CloudCreateSiteDeployResponse = Schema.Struct({
  deploy: CloudSiteDeploy,
  upload: Schema.Struct({
    url: TrimmedNonEmptyString,
    method: Schema.Literal("PUT"),
    /** Headers the PUT must send exactly. */
    headers: Schema.Record(Schema.String, Schema.String),
    expiresAt: Schema.String,
  }),
});
export type CloudCreateSiteDeployResponse = typeof CloudCreateSiteDeployResponse.Type;

/**
 * POST /v1/sites/{id}/deploys/{deployId}/complete → CloudSiteResponse.
 * Checks the zip and every file, then makes the deploy live or holds it for
 * review. A bad upload fails with `site_upload_invalid` and a plain reason.
 *
 * DELETE /v1/sites/{id} → CloudSiteResponse: unpublishes the site, deletes its
 * files, and frees its name.
 */

// POST /v1/public/sites/reports (no sign-in; rate limited per IP)
export const CloudSiteReportReason = Schema.Literals([
  "phishing",
  "malware",
  "spam",
  "illegal",
  "impersonation",
  "other",
]);
export type CloudSiteReportReason = typeof CloudSiteReportReason.Type;

export const CloudCreateSiteReportInput = Schema.Struct({
  name: CloudSiteName,
  reason: CloudSiteReportReason,
  note: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2000))),
});
export type CloudCreateSiteReportInput = typeof CloudCreateSiteReportInput.Type;
