import { and, eq } from "drizzle-orm";
import { zipSync } from "fflate";
import { schema } from "@djl/db";
import { afterAll, describe, expect, it } from "vitest";

import type { AdminPrincipal } from "../admin/AdminAuth.ts";
import type { Principal } from "../auth/guard.ts";
import { Settings } from "../config/settings.ts";
import { createMemoryRateLimiter } from "../gateway/RateLimiter.ts";
import { ApiError } from "../http/errors.ts";
import { FakeBlobStore } from "../sync/BlobStore.ts";
import { seedOrg, testDatabase } from "../testing/db.ts";
import { SiteAdminService } from "./SiteAdminService.ts";
import { fileKey, SiteService, uploadKey } from "./SiteService.ts";

const conn = testDatabase();
const db = conn.db;
const blobs = new FakeBlobStore();
const sites = new SiteService(
  db,
  blobs,
  new Settings(db, { ttlMs: 0 }),
  createMemoryRateLimiter(),
  "slcor.site",
);
const moderation = new SiteAdminService(db, sites);
afterAll(() => conn.close());

const text = (s: string) => new TextEncoder().encode(s);
const unique = (label: string) => `${label}-${crypto.randomUUID().slice(0, 8)}`;

async function admin(role: AdminPrincipal["role"]): Promise<AdminPrincipal> {
  const [row] = await db
    .insert(schema.admins)
    .values({ email: `${unique("mod")}@test.invalid`, name: "Mod", role })
    .returning();
  return { adminId: row!.id, email: row!.email, role, sessionId: "s", mfaVerified: true };
}

async function owner(): Promise<Principal> {
  const { orgId, userId } = await seedOrg(db, "mod-owner");
  return {
    userId,
    email: "o@test.invalid",
    emailVerified: true,
    banned: false,
    sessionId: "s",
    orgId,
    role: "owner",
    personalOrgId: orgId,
  };
}

async function publish(p: Principal, siteId: string, files: Record<string, Uint8Array>) {
  const zip = zipSync(files);
  const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", zip as BufferSource)).toString(
    "hex",
  );
  const { deploy } = await sites.createDeploy(p, siteId, { size: zip.byteLength, sha256 });
  blobs.put(uploadKey(p.orgId, siteId, deploy.id), zip);
  await sites.completeDeploy(p, siteId, deploy.id);
  return deploy.id;
}

async function audits(targetId: string) {
  return db.query.auditEvents.findMany({ where: eq(schema.auditEvents.targetId, targetId) });
}

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

/** A site with a live deploy and a held one. */
async function heldSite() {
  const p = await owner();
  const site = await sites.create(p, { name: unique("mod"), acceptTerms: true });
  const live = await publish(p, site.id, { "index.html": text("<h1>ok</h1>") });
  const held = await publish(p, site.id, {
    "index.html": text('<input type="password">'),
  });
  return { p, site, live, held };
}

describe("site moderation", () => {
  it("approves a held deploy: it goes live, the old files go, and it is audited", async () => {
    const mod = await admin("employee");
    const { site, live, held } = await heldSite();
    expect((await moderation.held(mod)).deploys.map((d) => d.id)).toContain(held);
    expect(
      await moderation.review(mod, held, "approve", "Login page for a school project"),
    ).toEqual({
      id: held,
      status: "live",
    });
    const row = await db.query.sites.findFirst({ where: eq(schema.sites.id, site.id) });
    expect(row?.liveDeployId).toBe(held);
    expect(blobs.objects.has(fileKey(site.id, live, "index.html"))).toBe(false);
    expect((await audits(held)).map((a) => a.action)).toEqual(["admin.site_deploy.approve"]);
    expect((await failure(moderation.review(mod, held, "approve", "again"))).code).toBe("not_held");
  });

  it("rejects a held deploy: its files are deleted and the live deploy stays", async () => {
    const mod = await admin("employee");
    const { site, live, held } = await heldSite();
    await moderation.review(mod, held, "reject", "Phishing");
    expect(blobs.objects.has(fileKey(site.id, held, "index.html"))).toBe(false);
    const row = await db.query.sites.findFirst({ where: eq(schema.sites.id, site.id) });
    expect(row?.liveDeployId).toBe(live);
    expect((await audits(held))[0]?.reason).toBe("Phishing");
  });

  it("takes a site down and restores it, with a reason each time", async () => {
    const mod = await admin("employee");
    const { site } = await heldSite();
    expect((await failure(moderation.setStatus(mod, site.id, "disabled", " "))).status).toBe(400);
    await moderation.setStatus(mod, site.id, "disabled", "Reported for phishing");
    expect(
      (await db.query.sites.findFirst({ where: eq(schema.sites.id, site.id) }))?.disabledReason,
    ).toBe("Reported for phishing");
    await moderation.setStatus(mod, site.id, "active", "Cleared");
    expect((await audits(site.id)).map((a) => a.action).toSorted()).toEqual([
      "admin.site.disable",
      "admin.site.enable",
    ]);
  });

  it("deletes a site with its files and keeps the audit row", async () => {
    const mod = await admin("admin");
    const { site, live } = await heldSite();
    await moderation.remove(mod, site.id, "Malware");
    expect(await db.query.sites.findFirst({ where: eq(schema.sites.id, site.id) })).toBeUndefined();
    expect(blobs.objects.has(fileKey(site.id, live, "index.html"))).toBe(false);
    expect((await audits(site.id)).map((a) => a.action)).toEqual(["admin.site.delete"]);
  });

  it("resolves reports and lists them by status", async () => {
    const mod = await admin("employee");
    const { site } = await heldSite();
    await sites.report(`ip-${crypto.randomUUID()}`, {
      name: site.name,
      reason: "phishing",
      note: "fake bank",
    });
    const open = (await moderation.reports(mod, {})).reports.filter((r) => r.siteId === site.id);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ reason: "phishing", note: "fake bank" });
    const { resolved } = await moderation.resolveReports(mod, [open[0]!.id], "Took it down");
    expect(resolved).toEqual([open[0]!.id]);
    const after = await db.query.siteReports.findFirst({
      where: and(eq(schema.siteReports.id, open[0]!.id), eq(schema.siteReports.status, "resolved")),
    });
    expect(after?.resolvedBy).toBe(mod.adminId);
  });

  it("refuses commerce staff", async () => {
    const commerce: AdminPrincipal = {
      adminId: crypto.randomUUID(),
      email: "c@test.invalid",
      role: "commerce",
      commerceRole: "finance" as never,
      sessionId: "s",
      mfaVerified: true,
    };
    expect((await failure(moderation.held(commerce))).status).toBe(403);
    expect((await failure(moderation.list(commerce, {}))).status).toBe(403);
  });
});
