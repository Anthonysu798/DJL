/**
 * Static websites served on `{name}.slcor.site`. A site belongs to one user in
 * one org. Each publish is a deploy whose files live in storage under
 * `sites/{siteId}/{deployId}/`; `liveDeployId` names the one visitors see.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { admins } from "./admin.ts";
import { organization, user } from "./auth.ts";

const id = () =>
  uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey();
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/** One file of a finished deploy: path, size in bytes, and SHA-256 (used as the ETag). */
export interface SiteManifestFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export const sites = pgTable(
  "sites",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Subdomain label, lowercase; unique across all sites. */
    name: text("name").notNull(),
    status: text("status").$type<"active" | "disabled">().notNull().default("active"),
    /** Why DJL took the site down, shown to the owner. */
    disabledReason: text("disabled_reason"),
    liveDeployId: uuid("live_deploy_id"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),
    lastDeployAt: timestamp("last_deploy_at", { withTimezone: true }),
    /** Updated in batches by the sites server; null until the first visit. */
    lastVisitAt: timestamp("last_visit_at", { withTimezone: true }),
    /** When the owner was told an idle site will be unpublished. */
    expiryWarnedAt: timestamp("expiry_warned_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sites_name_idx").on(t.name),
    index("sites_org_user_idx").on(t.orgId, t.userId),
    index("sites_status_idx").on(t.status),
  ],
);

export const siteDeploys = pgTable(
  "site_deploys",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** uploading → checking → live | held | rejected; a replaced live deploy becomes superseded. */
    status: text("status")
      .$type<"uploading" | "checking" | "live" | "held" | "rejected" | "superseded">()
      .notNull()
      .default("uploading"),
    zipBytes: integer("zip_bytes").notNull(),
    zipSha256: text("zip_sha256").notNull(),
    /** Unzipped bytes and file count, known once checked. */
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    fileCount: integer("file_count").notNull().default(0),
    manifest: jsonb("manifest").$type<readonly SiteManifestFile[]>(),
    /** Plain-words reason for a held or rejected deploy. */
    reason: text("reason"),
    reviewedBy: uuid("reviewed_by").references(() => admins.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("site_deploys_site_created_idx").on(t.siteId, t.createdAt),
    index("site_deploys_status_idx").on(t.status),
  ],
);

/** Visitor reports of abusive sites, reviewed in the admin app. */
export const siteReports = pgTable(
  "site_reports",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    reason: text("reason")
      .$type<"phishing" | "malware" | "spam" | "illegal" | "impersonation" | "other">()
      .notNull(),
    note: text("note"),
    ipHash: text("ip_hash"),
    status: text("status").$type<"open" | "resolved">().notNull().default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => admins.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("site_reports_status_created_idx").on(t.status, t.createdAt)],
);
