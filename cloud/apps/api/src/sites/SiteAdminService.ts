/**
 * Moderation of slcor.site sites: list and search sites, review deploys held
 * for possible phishing, take sites down or restore them, delete them, and
 * resolve visitor reports. Every change writes an audit row in the same
 * transaction.
 */
import { and, desc, eq, ilike, inArray, type SQL } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";

import { requirePermission, type AdminPrincipal } from "../admin/AdminAuth.ts";
import { writeAudit } from "../audit/AuditLog.ts";
import { ApiError } from "../http/errors.ts";
import type { SiteService } from "./SiteService.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERMISSION = "sites.moderate";
const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found.`);
const needReason = (reason: string | null) => {
  if (!reason?.trim()) throw new ApiError(400, "bad_request", "A reason is required.");
  return reason.trim();
};

export class SiteAdminService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly sites: SiteService,
  ) {}

  async list(
    p: AdminPrincipal,
    input: { readonly query?: string; readonly status?: string; readonly limit?: number },
  ) {
    requirePermission(p, PERMISSION);
    const limit = Math.min(Math.max(Number.isFinite(input.limit) ? input.limit! : 50, 1), 200);
    const filters: SQL[] = [];
    if (input.query?.trim())
      filters.push(ilike(schema.sites.name, `%${input.query.trim().replace(/[%_\\]/g, "")}%`));
    if (input.status === "active" || input.status === "disabled")
      filters.push(eq(schema.sites.status, input.status));
    const rows = await this.db
      .select()
      .from(schema.sites)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(schema.sites.createdAt))
      .limit(limit);
    return {
      sites: await Promise.all(
        rows.map(async (row) => ({
          ...(await this.sites.toSite(row)),
          orgId: row.orgId,
          userId: row.userId,
          disabledReason: row.disabledReason,
          lastVisitAt: row.lastVisitAt,
        })),
      ),
    };
  }

  /** Deploys held for review, oldest first, with the reason they were held. */
  async held(p: AdminPrincipal) {
    requirePermission(p, PERMISSION);
    const rows = await this.db
      .select({ deploy: schema.siteDeploys, name: schema.sites.name })
      .from(schema.siteDeploys)
      .innerJoin(schema.sites, eq(schema.sites.id, schema.siteDeploys.siteId))
      .where(eq(schema.siteDeploys.status, "held"))
      .orderBy(schema.siteDeploys.createdAt)
      .limit(100);
    return {
      deploys: rows.map(({ deploy, name }) => ({
        id: deploy.id,
        siteId: deploy.siteId,
        name,
        url: this.sites.siteUrl(name),
        reason: deploy.reason,
        fileCount: deploy.fileCount,
        bytes: deploy.bytes,
        files: (deploy.manifest ?? []).map((f) => f.path),
        createdAt: deploy.createdAt,
      })),
    };
  }

  async reports(p: AdminPrincipal, input: { readonly status?: string }) {
    requirePermission(p, PERMISSION);
    const status = input.status === "resolved" ? "resolved" : "open";
    const rows = await this.db
      .select({
        report: schema.siteReports,
        name: schema.sites.name,
        siteStatus: schema.sites.status,
      })
      .from(schema.siteReports)
      .innerJoin(schema.sites, eq(schema.sites.id, schema.siteReports.siteId))
      .where(eq(schema.siteReports.status, status))
      .orderBy(desc(schema.siteReports.createdAt))
      .limit(200);
    return {
      reports: rows.map(({ report, name, siteStatus }) => ({
        id: report.id,
        siteId: report.siteId,
        name,
        url: this.sites.siteUrl(name),
        siteStatus,
        reason: report.reason,
        note: report.note,
        status: report.status,
        createdAt: report.createdAt,
      })),
    };
  }

  /** Take a site down (`disabled`) or restore it (`active`). */
  async setStatus(
    p: AdminPrincipal,
    siteId: string,
    status: "active" | "disabled",
    reason: string | null,
  ) {
    requirePermission(p, PERMISSION);
    const why = needReason(reason);
    if (!UUID.test(siteId)) throw notFound("Site");
    return this.db.transaction(async (tx) => {
      const site = await tx.query.sites.findFirst({ where: eq(schema.sites.id, siteId) });
      if (!site) throw notFound("Site");
      await tx
        .update(schema.sites)
        .set({ status, disabledReason: status === "disabled" ? why : null })
        .where(eq(schema.sites.id, siteId));
      // Close uploads still open so none can finish into the site once it is restored.
      if (status === "disabled")
        await tx
          .update(schema.siteDeploys)
          .set({ status: "rejected", reason: "The site was taken down.", completedAt: new Date() })
          .where(
            and(eq(schema.siteDeploys.siteId, siteId), eq(schema.siteDeploys.status, "uploading")),
          );
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: status === "disabled" ? "admin.site.disable" : "admin.site.enable",
        targetType: "site",
        targetId: siteId,
        before: { status: site.status },
        after: { status },
        reason: why,
      });
      return { id: siteId, status };
    });
  }

  /** Approve a held deploy (it goes live) or reject it (its files are deleted). */
  async review(
    p: AdminPrincipal,
    deployId: string,
    decision: "approve" | "reject",
    reason: string | null,
  ) {
    requirePermission(p, PERMISSION);
    const why = needReason(reason);
    if (!UUID.test(deployId)) throw notFound("Deploy");
    const { siteId, replaced } = await this.db.transaction(async (tx) => {
      const [deploy] = await tx
        .update(schema.siteDeploys)
        .set({
          reviewedBy: p.adminId,
          reviewedAt: new Date(),
          ...(decision === "reject" ? { status: "rejected" as const, reason: why } : {}),
        })
        .where(and(eq(schema.siteDeploys.id, deployId), eq(schema.siteDeploys.status, "held")))
        .returning();
      if (!deploy) {
        const found = await tx.query.siteDeploys.findFirst({
          where: eq(schema.siteDeploys.id, deployId),
        });
        if (!found) throw notFound("Deploy");
        throw new ApiError(409, "not_held", "That deploy is not waiting for review.");
      }
      const replaced =
        decision === "approve"
          ? await this.sites.goLive(deploy.siteId, deploy.id, undefined, tx)
          : null;
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: `admin.site_deploy.${decision}`,
        targetType: "site_deploy",
        targetId: deployId,
        before: { status: "held" },
        after: { status: decision === "approve" ? "live" : "rejected" },
        reason: why,
      });
      return { siteId: deploy.siteId, replaced };
    });
    if (decision === "reject") await this.sites.deleteDeployFiles(siteId, deployId);
    if (replaced) await this.sites.deleteDeployFiles(siteId, replaced);
    return { id: deployId, status: decision === "approve" ? "live" : "rejected" };
  }

  async remove(p: AdminPrincipal, siteId: string, reason: string | null) {
    requirePermission(p, PERMISSION);
    const why = needReason(reason);
    if (!UUID.test(siteId)) throw notFound("Site");
    const site = await this.db.query.sites.findFirst({ where: eq(schema.sites.id, siteId) });
    if (!site) throw notFound("Site");
    // The audit row is written first, in its own transaction with the lock-out, so
    // a failed file cleanup can never leave a deletion without a record.
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.sites)
        .set({ status: "disabled", disabledReason: why })
        .where(eq(schema.sites.id, siteId));
      await writeAudit(tx, {
        actorType: "admin",
        actorId: p.adminId,
        action: "admin.site.delete",
        targetType: "site",
        targetId: siteId,
        before: { name: site.name, status: site.status, orgId: site.orgId },
        after: null,
        reason: why,
      });
    });
    await this.sites.deleteSite(site);
    return { id: siteId, deleted: true };
  }

  async resolveReports(p: AdminPrincipal, reportIds: readonly string[], reason: string | null) {
    requirePermission(p, PERMISSION);
    const ids = reportIds.filter((id) => UUID.test(id));
    if (ids.length === 0) throw notFound("Report");
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(schema.siteReports)
        .set({ status: "resolved", resolvedAt: new Date(), resolvedBy: p.adminId })
        .where(and(inArray(schema.siteReports.id, ids), eq(schema.siteReports.status, "open")))
        .returning({ id: schema.siteReports.id });
      for (const row of rows)
        await writeAudit(tx, {
          actorType: "admin",
          actorId: p.adminId,
          action: "admin.site_report.resolve",
          targetType: "site_report",
          targetId: row.id,
          before: { status: "open" },
          after: { status: "resolved" },
          reason,
        });
      return { resolved: rows.map((r) => r.id) };
    });
  }
}
