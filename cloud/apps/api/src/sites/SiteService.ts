/**
 * Static sites on `{name}.slcor.site`. A user claims a name, then publishes
 * deploys: a presigned PUT of a zip under org/{orgId}/sites/{siteId}/uploads/,
 * then `complete`, which verifies the zip, checks every path and page, copies
 * the files to sites/{siteId}/{deployId}/ and makes the deploy live, or holds
 * it for review when a page looks like credential theft. Storage keys are
 * always built here; nothing a client sends becomes part of a key except
 * checked file paths inside the deploy's own prefix.
 */
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import { schema, type DjlDatabase, type SiteManifestFile } from "@djl/db";
import { siteContentHold, siteFilesProblem, siteNameProblem, sitePathProblem } from "@djl/domain";
import {
  CLOUD_SITE_FILE_TYPES,
  CLOUD_SITE_MAX_UNZIPPED_BYTES,
  type CloudCreateSiteDeployInput,
  type CloudCreateSiteDeployResponse,
  type CloudCreateSiteInput,
  type CloudCreateSiteReportInput,
  type CloudSite,
  type CloudSiteDeploy,
  type CloudSiteListResponse,
  type CloudSiteNameAvailability,
} from "@djl/contracts/cloud";

import type { Principal } from "../auth/guard.ts";
import type { Settings } from "../config/settings.ts";
import type { RateLimiter } from "../gateway/RateLimiter.ts";
import { ApiError } from "../http/errors.ts";
import type { BlobStore } from "../sync/BlobStore.ts";

export type SiteRow = typeof schema.sites.$inferSelect;
export type SiteDeployRow = typeof schema.siteDeploys.$inferSelect;

const EXTENSIONS = new Set(Object.keys(CLOUD_SITE_FILE_TYPES));
/** Text files read for the content check. */
const SCANNED = /\.(html?|js|mjs)$/i;
const WRITE_CONCURRENCY = 16;
const REPORTS_PER_IP = [
  { windowSeconds: 60, limit: 5 },
  { windowSeconds: 24 * 60 * 60, limit: 30 },
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = () => new ApiError(404, "not_found", "Not found.");
const disabled = () =>
  new ApiError(403, "site_disabled", "This site can't be published right now.");
const invalid = (reason: string) => new ApiError(400, "site_upload_invalid", reason);

export const uploadKey = (orgId: string, siteId: string, deployId: string) =>
  `org/${orgId}/sites/${siteId}/uploads/${deployId}.zip`;
export const fileKey = (siteId: string, deployId: string, path: string) =>
  `sites/${siteId}/${deployId}/${path}`;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Buffer.from(digest).toString("hex");
}

function contentType(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return CLOUD_SITE_FILE_TYPES[extension] ?? "application/octet-stream";
}

async function inBatches<T>(items: readonly T[], run: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += WRITE_CONCURRENCY)
    await Promise.all(items.slice(i, i + WRITE_CONCURRENCY).map(run));
}

function deleteDeployObjects(blobs: BlobStore, siteId: string, deploy: SiteDeployRow) {
  return inBatches(deploy.manifest ?? [], (file) =>
    blobs.remove(fileKey(siteId, deploy.id, file.path)),
  );
}

/** Delete a site row (its deploys and reports cascade), then every object it stored. */
export async function deleteSiteAndFiles(db: DjlDatabase, blobs: BlobStore, site: SiteRow) {
  const deploys = await db.query.siteDeploys.findMany({
    where: eq(schema.siteDeploys.siteId, site.id),
  });
  await db.delete(schema.sites).where(eq(schema.sites.id, site.id));
  for (const deploy of deploys) {
    await deleteDeployObjects(blobs, site.id, deploy);
    await blobs.remove(uploadKey(site.orgId, site.id, deploy.id));
  }
}

export function toDeploy(row: SiteDeployRow): typeof CloudSiteDeploy.Encoded {
  return {
    id: row.id,
    status: row.status === "checking" ? "uploading" : row.status,
    bytes: row.bytes,
    fileCount: row.fileCount,
    createdAt: row.createdAt.toISOString(),
    reason: row.reason,
  };
}

export class SiteService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly blobs: BlobStore,
    private readonly settings: Settings,
    private readonly limiter: RateLimiter,
    private readonly sitesDomain: string,
  ) {}

  siteUrl(name: string) {
    return `https://${name}.${this.sitesDomain}`;
  }

  async nameAvailability(name: string): Promise<typeof CloudSiteNameAvailability.Encoded> {
    const problem = siteNameProblem(name);
    if (problem) return { name, available: false, reason: problem };
    const taken = await this.db.query.sites.findFirst({
      columns: { id: true },
      where: eq(schema.sites.name, name),
    });
    return { name, available: !taken, reason: taken ? "taken" : null };
  }

  async list(p: Principal): Promise<typeof CloudSiteListResponse.Encoded> {
    const rows = await this.db.query.sites.findMany({
      where: and(eq(schema.sites.orgId, p.orgId), eq(schema.sites.userId, p.userId)),
      orderBy: desc(schema.sites.createdAt),
    });
    const sites = await Promise.all(rows.map((row) => this.toSite(row)));
    return { sites, limits: await this.limits(p.orgId) };
  }

  async get(p: Principal, id: string): Promise<typeof CloudSite.Encoded> {
    return this.toSite(await this.own(p, id));
  }

  async create(p: Principal, input: CloudCreateSiteInput): Promise<typeof CloudSite.Encoded> {
    await this.assertEnabled();
    if (input.acceptTerms !== true)
      throw new ApiError(400, "terms_required", "Accept the hosting terms to publish a site.");
    const availability = await this.nameAvailability(input.name);
    if (!availability.available)
      throw new ApiError(
        409,
        `site_name_${availability.reason}`,
        availability.reason === "taken"
          ? "That name is taken. Try another."
          : "That name can't be used. Try another.",
      );
    const { maxSites } = await this.limits(p.orgId);
    const row = await this.db.transaction(async (tx) => {
      // Serialise creates per org so two at once cannot both pass the quota.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`sites:${p.orgId}`}))`);
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(schema.sites)
        .where(eq(schema.sites.orgId, p.orgId));
      if (n >= maxSites)
        throw new ApiError(
          403,
          "site_limit_reached",
          `Your plan allows ${maxSites} sites. Unpublish one to make room.`,
        );
      const [created] = await tx
        .insert(schema.sites)
        .values({ orgId: p.orgId, userId: p.userId, name: input.name, termsAcceptedAt: new Date() })
        .onConflictDoNothing({ target: schema.sites.name })
        .returning();
      if (!created) throw new ApiError(409, "site_name_taken", "That name is taken. Try another.");
      return created;
    });
    return this.toSite(row);
  }

  /** Unpublish: delete the site, its deploys and every stored file, and free the name. */
  async remove(p: Principal, id: string): Promise<typeof CloudSite.Encoded> {
    const site = await this.own(p, id);
    if (site.status === "disabled")
      throw new ApiError(
        403,
        "site_disabled",
        "This site was taken down by DJL. Contact support to remove it.",
      );
    const result = await this.toSite(site);
    await this.deleteSite(site);
    return result;
  }

  async createDeploy(
    p: Principal,
    siteId: string,
    input: CloudCreateSiteDeployInput,
  ): Promise<typeof CloudCreateSiteDeployResponse.Encoded> {
    await this.assertEnabled();
    const site = await this.own(p, siteId);
    if (site.status !== "active") throw disabled();
    const { maxZipBytes } = await this.limits(p.orgId);
    if (input.size > maxZipBytes)
      throw new ApiError(
        413,
        "site_too_large",
        `Sites on your plan can be up to ${Math.floor(maxZipBytes / (1024 * 1024))} MB zipped.`,
      );
    const perHour = await this.settings.get("sites.deploys_per_hour");
    const hit = await this.limiter.hit(`sites:deploy:${p.userId}`, perHour, 3600);
    if (!hit.allowed)
      throw new ApiError(429, "rate_limited", "Too many publishes. Try again in a while.");
    const [deploy] = await this.db
      .insert(schema.siteDeploys)
      .values({
        siteId: site.id,
        orgId: p.orgId,
        userId: p.userId,
        zipBytes: input.size,
        zipSha256: input.sha256,
      })
      .returning();
    const upload = await this.blobs.presignUpload(
      uploadKey(p.orgId, site.id, deploy!.id),
      "application/zip",
      input.size,
    );
    return { deploy: toDeploy(deploy!), upload: { ...upload, method: "PUT" } };
  }

  async completeDeploy(
    p: Principal,
    siteId: string,
    deployId: string,
  ): Promise<typeof CloudSite.Encoded> {
    await this.assertEnabled();
    const site = await this.own(p, siteId);
    if (site.status !== "active") throw disabled();
    if (!UUID.test(deployId)) throw notFound();
    const deploy = await this.db.query.siteDeploys.findFirst({
      where: and(
        eq(schema.siteDeploys.id, deployId),
        eq(schema.siteDeploys.siteId, site.id),
        eq(schema.siteDeploys.orgId, p.orgId),
        eq(schema.siteDeploys.userId, p.userId),
      ),
    });
    if (!deploy) throw notFound();
    if (deploy.status !== "uploading") {
      if (deploy.status === "rejected") throw invalid(deploy.reason ?? "This upload was rejected.");
      if (deploy.status === "checking")
        throw new ApiError(409, "site_deploy_busy", "This publish is already being checked.");
      return this.toSite(site);
    }
    // Claim the deploy so two completes cannot both process it.
    const [claimed] = await this.db
      .update(schema.siteDeploys)
      .set({ status: "checking" })
      .where(and(eq(schema.siteDeploys.id, deploy.id), eq(schema.siteDeploys.status, "uploading")))
      .returning();
    if (!claimed)
      throw new ApiError(409, "site_deploy_busy", "This publish is already being checked.");

    const zipKey = uploadKey(p.orgId, site.id, deploy.id);
    const written: string[] = [];
    try {
      const { files, manifest, hold } = await this.unpack(deploy, zipKey);
      await inBatches(files, async (file) => {
        const key = fileKey(site.id, deploy.id, file.path);
        await this.blobs.write(key, file.bytes, contentType(file.path));
        written.push(key);
      });
      const bytes = manifest.reduce((sum, f) => sum + f.size, 0);
      if (hold) {
        await this.db
          .update(schema.siteDeploys)
          .set({
            status: "held",
            reason: hold,
            bytes,
            fileCount: manifest.length,
            manifest,
            completedAt: new Date(),
          })
          .where(eq(schema.siteDeploys.id, deploy.id));
      } else {
        await this.goLive(site.id, deploy.id, { bytes, fileCount: manifest.length, manifest });
      }
    } catch (error) {
      await Promise.all(written.map((key) => this.blobs.remove(key)));
      const reason =
        error instanceof ApiError && error.code === "site_upload_invalid"
          ? error.message
          : "This upload could not be checked.";
      await this.db
        .update(schema.siteDeploys)
        .set({ status: "rejected", reason, completedAt: new Date() })
        .where(eq(schema.siteDeploys.id, deploy.id));
      throw error;
    } finally {
      await this.blobs.remove(zipKey);
    }
    return this.toSite(await this.own(p, site.id));
  }

  /** Visitor report of an abusive site; no sign-in, limited per hashed IP. */
  async report(ipHash: string | null, input: CloudCreateSiteReportInput): Promise<void> {
    for (const { limit, windowSeconds } of REPORTS_PER_IP) {
      const hit = await this.limiter.hit(
        `sites:report:${ipHash ?? "unknown"}:${windowSeconds}`,
        limit,
        windowSeconds,
      );
      if (!hit.allowed) throw new ApiError(429, "rate_limited", "Too many reports. Try later.");
    }
    const site = await this.db.query.sites.findFirst({
      columns: { id: true },
      where: eq(schema.sites.name, input.name),
    });
    if (!site) throw notFound();
    await this.db.insert(schema.siteReports).values({
      siteId: site.id,
      reason: input.reason,
      note: input.note?.trim() || null,
      ipHash,
    });
  }

  // ---- shared with admin -------------------------------------------------------------

  /** Make a checked deploy live and delete the files of the one it replaces; returns its id. */
  async goLive(
    siteId: string,
    deployId: string,
    facts?: { bytes: number; fileCount: number; manifest: readonly SiteManifestFile[] },
    tx?: Parameters<Parameters<DjlDatabase["transaction"]>[0]>[0],
  ) {
    const run = async (db: NonNullable<typeof tx>) => {
      // Locked so a takedown that commits while this deploy was being checked is seen here.
      const [site] = await db
        .select()
        .from(schema.sites)
        .where(eq(schema.sites.id, siteId))
        .for("update");
      if (!site) throw notFound();
      if (site.status !== "active") throw disabled();
      await db
        .update(schema.siteDeploys)
        .set({ status: "live", completedAt: new Date(), ...facts })
        .where(eq(schema.siteDeploys.id, deployId));
      const replaced =
        site.liveDeployId && site.liveDeployId !== deployId ? site.liveDeployId : null;
      if (replaced)
        await db
          .update(schema.siteDeploys)
          .set({ status: "superseded" })
          .where(eq(schema.siteDeploys.id, replaced));
      await db
        .update(schema.sites)
        .set({ liveDeployId: deployId, lastDeployAt: new Date(), expiryWarnedAt: null })
        .where(eq(schema.sites.id, siteId));
      return replaced;
    };
    // Inside a caller's transaction, the caller deletes the replaced files after committing.
    if (tx) return run(tx);
    const replaced = await this.db.transaction(run);
    if (replaced) await this.deleteDeployFiles(siteId, replaced);
    return replaced;
  }

  deleteSite(site: SiteRow) {
    return deleteSiteAndFiles(this.db, this.blobs, site);
  }

  async deleteDeployFiles(siteId: string, deployId: string) {
    const deploy = await this.db.query.siteDeploys.findFirst({
      where: eq(schema.siteDeploys.id, deployId),
    });
    if (deploy) await this.deleteFiles(siteId, deploy);
  }

  async toSite(row: SiteRow): Promise<typeof CloudSite.Encoded> {
    const ids = [row.liveDeployId].filter((id): id is string => id !== null);
    const live = ids.length
      ? await this.db.query.siteDeploys.findFirst({ where: inArray(schema.siteDeploys.id, ids) })
      : undefined;
    const pending = await this.db.query.siteDeploys.findFirst({
      where: and(
        eq(schema.siteDeploys.siteId, row.id),
        inArray(schema.siteDeploys.status, ["held"]),
        ...(row.liveDeployId ? [ne(schema.siteDeploys.id, row.liveDeployId)] : []),
      ),
      orderBy: desc(schema.siteDeploys.createdAt),
    });
    return {
      id: row.id,
      name: row.name,
      url: this.siteUrl(row.name),
      status: row.status,
      liveDeploy: live ? toDeploy(live) : null,
      pendingDeploy: pending ? toDeploy(pending) : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ---- internals ---------------------------------------------------------------------

  private deleteFiles(siteId: string, deploy: SiteDeployRow) {
    return deleteDeployObjects(this.blobs, siteId, deploy);
  }

  private async unpack(deploy: SiteDeployRow, zipKey: string) {
    const zip = await this.blobs.read(zipKey, deploy.zipBytes).catch(() => {
      throw invalid("The upload is larger than declared.");
    });
    if (!zip) throw new ApiError(400, "upload_missing", "Upload the site before publishing it.");
    if (zip.byteLength !== deploy.zipBytes) throw invalid("The upload's size does not match.");
    if ((await sha256Hex(zip)) !== deploy.zipSha256)
      throw invalid("The upload's checksum does not match.");

    const maxFiles = await this.settings.get("sites.max_files");
    let declared = 0;
    let entries = 0;
    let pathProblem: string | null = null;
    let unpacked: Record<string, Uint8Array>;
    try {
      unpacked = unzipSync(zip, {
        // Sizes come from the zip's own headers; fflate never inflates past them, so the
        // running total bounds memory even when a header lies.
        filter: (file) => {
          if (file.name.endsWith("/")) return false;
          entries += 1;
          declared += file.originalSize;
          pathProblem ??= sitePathProblem(file.name, EXTENSIONS);
          return (
            pathProblem === null && entries <= maxFiles && declared <= CLOUD_SITE_MAX_UNZIPPED_BYTES
          );
        },
      });
    } catch {
      throw invalid("The upload is not a readable zip file.");
    }
    if (pathProblem) throw invalid(pathProblem);
    const files = Object.entries(unpacked).map(([path, bytes]) => ({ path, bytes }));
    const problem = siteFilesProblem(
      files.map((f) => ({ path: f.path, size: f.bytes.byteLength })),
      { maxFiles, maxBytes: CLOUD_SITE_MAX_UNZIPPED_BYTES },
    );
    if (problem || entries > maxFiles || declared > CLOUD_SITE_MAX_UNZIPPED_BYTES)
      throw invalid(problem ?? `A site can have up to ${maxFiles} files and 100 MB unzipped.`);

    const decoder = new TextDecoder("utf-8", { fatal: false });
    let hold: string | null = null;
    for (const file of files) {
      if (!SCANNED.test(file.path)) continue;
      hold = siteContentHold(decoder.decode(file.bytes));
      if (hold) break;
    }
    const manifest: SiteManifestFile[] = await Promise.all(
      files.map(async (f) => ({
        path: f.path,
        size: f.bytes.byteLength,
        sha256: await sha256Hex(f.bytes),
      })),
    );
    return { files, manifest, hold };
  }

  private async own(p: Principal, id: string): Promise<SiteRow> {
    if (!UUID.test(id)) throw notFound();
    const row = await this.db.query.sites.findFirst({
      where: and(
        eq(schema.sites.id, id),
        eq(schema.sites.orgId, p.orgId),
        eq(schema.sites.userId, p.userId),
      ),
    });
    if (!row) throw notFound();
    return row;
  }

  private async assertEnabled() {
    const row = await this.db.query.killSwitches.findFirst({
      where: eq(schema.killSwitches.name, "sites"),
    });
    if (row?.engaged)
      throw new ApiError(503, "sites_paused", "Publishing is paused for now. Try again later.");
  }

  private async limits(orgId: string) {
    const sub = await this.db.query.subscriptions.findFirst({
      columns: { planId: true },
      where: and(eq(schema.subscriptions.orgId, orgId), eq(schema.subscriptions.status, "active")),
    });
    const pick = (byPlan: Readonly<Record<string, number>>, fallback: number) =>
      (sub && byPlan[sub.planId]) ?? byPlan.default ?? fallback;
    return {
      maxSites: pick(await this.settings.get("sites.max_count"), 3),
      maxZipBytes: pick(await this.settings.get("sites.max_zip_bytes"), 25 * 1024 * 1024),
      maxFiles: await this.settings.get("sites.max_files"),
    };
  }
}
