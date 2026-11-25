/**
 * Desktop side of publishing a chat's project to `{name}.slcor.site`. The server resolves
 * the project folder from the chat, so a client never names a path to build or upload.
 */
import { Schema } from "effect";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas";
import {
  CloudSite,
  CloudSiteLimits,
  CloudSiteName,
  CloudSiteNameAvailability,
} from "./cloud/sites";

export const SitesThreadInput = Schema.Struct({ threadId: ThreadId });
export type SitesThreadInput = typeof SitesThreadInput.Type;

export const SitesProjectStatus = Schema.Struct({
  signedIn: Schema.Boolean,
  /** False when the chat has no project folder (a plain chat). */
  projectAvailable: Schema.Boolean,
  /** The site this project publishes to, if it still belongs to this account. */
  linkedSite: Schema.NullOr(CloudSite),
  suggestedName: Schema.String,
});
export type SitesProjectStatus = typeof SitesProjectStatus.Type;

export const SitesListResult = Schema.Struct({
  signedIn: Schema.Boolean,
  sites: Schema.Array(CloudSite),
  limits: Schema.NullOr(CloudSiteLimits),
});
export type SitesListResult = typeof SitesListResult.Type;

export const SitesNameInput = Schema.Struct({ name: Schema.String.check(Schema.isMaxLength(64)) });
export type SitesNameInput = typeof SitesNameInput.Type;
export const SitesNameResult = CloudSiteNameAvailability;
export type SitesNameResult = typeof SitesNameResult.Type;

export const SitesPublishInput = Schema.Struct({
  threadId: ThreadId,
  /** Required for the first publish of a project; later publishes reuse its site. */
  name: Schema.optional(CloudSiteName),
  acceptTerms: Schema.optional(Schema.Boolean),
});
export type SitesPublishInput = typeof SitesPublishInput.Type;

/**
 * `failed.code` is one the modal explains: not_signed_in, build_failed (with `log`),
 * no_site, site_invalid, site_upload_invalid, name_required, terms_required,
 * site_name_taken, site_name_reserved, site_name_invalid, site_limit_reached,
 * site_too_large, site_disabled, sites_paused, rate_limited, cloud_error.
 */
export const SitesPublishResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("published"), site: CloudSite }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    code: TrimmedNonEmptyString,
    message: Schema.String,
    log: Schema.optional(Schema.String),
  }),
]);
export type SitesPublishResult = typeof SitesPublishResult.Type;

export const SitesUnpublishInput = Schema.Struct({ siteId: TrimmedNonEmptyString });
export type SitesUnpublishInput = typeof SitesUnpublishInput.Type;

/** Thread activity kind the Website tool appends when a site is ready to publish. */
export const SITE_READY_ACTIVITY_KIND = "site.ready";
export const SiteReadyActivityPayload = Schema.Struct({
  fileCount: Schema.Int,
  bytes: Schema.Int,
  suggestedName: Schema.String,
  linkedSiteName: Schema.NullOr(Schema.String),
  linkedSiteUrl: Schema.NullOr(Schema.String),
});
export type SiteReadyActivityPayload = typeof SiteReadyActivityPayload.Type;
