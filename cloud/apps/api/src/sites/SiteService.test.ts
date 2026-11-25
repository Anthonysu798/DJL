import { eq } from "drizzle-orm";
import { zipSync } from "fflate";
import { schema } from "@djl/db";
import { afterAll, describe, expect, it } from "vitest";

import type { Principal } from "../auth/guard.ts";
import { Settings } from "../config/settings.ts";
import { createMemoryRateLimiter } from "../gateway/RateLimiter.ts";
import { ApiError } from "../http/errors.ts";
import { FakeBlobStore } from "../sync/BlobStore.ts";
import { seedOrg, testDatabase } from "../testing/db.ts";
import { fileKey, SiteService, uploadKey } from "./SiteService.ts";

const conn = testDatabase();
const db = conn.db;
const blobs = new FakeBlobStore();
const settings = new Settings(db, { ttlMs: 0 });
const sites = new SiteService(db, blobs, settings, createMemoryRateLimiter(), "slcor.site");
afterAll(() => conn.close());

const text = (s: string) => new TextEncoder().encode(s);
const PAGE = text("<!doctype html><h1>Fresh bread daily</h1>");

function principal(orgId: string, userId: string, role: Principal["role"] = "owner"): Principal {
  return {
    userId,
    email: "x@test.invalid",
    emailVerified: true,
    banned: false,
    sessionId: "s",
    orgId,
    role,
    personalOrgId: orgId,
  };
}

async function user(label: string) {
  const { orgId, userId } = await seedOrg(db, label);
  return principal(orgId, userId);
}

/** A second member of `owner`'s org. */
async function teammate(owner: Principal) {
  const { userId } = await seedOrg(db, "mate");
  await db
    .insert(schema.member)
    .values({ organizationId: owner.orgId, userId, role: "member", createdAt: new Date() });
  return principal(owner.orgId, userId, "member");
}

const unique = (label: string) => `${label}-${crypto.randomUUID().slice(0, 8)}`;

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

async function sha(bytes: Uint8Array) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes as BufferSource)).toString("hex");
}

/** Start a deploy, "PUT" the zip as the client would, and complete it. */
async function publish(
  p: Principal,
  siteId: string,
  files: Record<string, Uint8Array>,
  options: { readonly declaredSha?: string } = {},
) {
  const zip = zipSync(files);
  const created = await sites.createDeploy(p, siteId, {
    size: zip.byteLength,
    sha256: options.declaredSha ?? (await sha(zip)),
  });
  blobs.put(uploadKey(p.orgId, siteId, created.deploy.id), zip, "application/zip");
  return {
    deployId: created.deploy.id,
    created,
    complete: () => sites.completeDeploy(p, siteId, created.deploy.id),
  };
}

describe("site names", () => {
  it("reports invalid, reserved and taken names", async () => {
    const p = await user("names");
    const name = unique("bakery");
    expect(await sites.nameAvailability(name)).toEqual({ name, available: true, reason: null });
    await sites.create(p, { name, acceptTerms: true });
    expect((await sites.nameAvailability(name)).reason).toBe("taken");
    expect((await sites.nameAvailability("paypal-login")).reason).toBe("reserved");
    expect((await sites.nameAvailability("Not Valid")).reason).toBe("invalid");
    expect((await failure(sites.create(p, { name, acceptTerms: true }))).code).toBe(
      "site_name_taken",
    );
  });

  it("limits each org to three sites, even when creates race", async () => {
    const p = await user("quota");
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => sites.create(p, { name: unique("q"), acceptTerms: true })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as ApiError).code).toBe("site_limit_reached");
    expect((await sites.list(p)).sites).toHaveLength(3);
  });
});

describe("publishing", () => {
  it("checks a zip, copies its files, goes live, and replaces the previous deploy", async () => {
    const p = await user("publish");
    const site = await sites.create(p, { name: unique("shop"), acceptTerms: true });
    expect(site.url).toBe(`https://${site.name}.slcor.site`);
    expect(site.liveDeploy).toBeNull();

    const first = await publish(p, site.id, { "index.html": PAGE, "css/site.css": text("h1{}") });
    expect(first.created.upload.headers["content-type"]).toBe("application/zip");
    const live = await first.complete();
    expect(live.liveDeploy).toMatchObject({ id: first.deployId, status: "live", fileCount: 2 });
    expect(blobs.objects.get(fileKey(site.id, first.deployId, "index.html"))?.mimeType).toBe(
      "text/html; charset=utf-8",
    );
    expect(blobs.objects.has(uploadKey(p.orgId, site.id, first.deployId))).toBe(false);
    // Completing again is harmless.
    expect((await first.complete()).liveDeploy?.id).toBe(first.deployId);

    const second = await publish(p, site.id, { "index.html": text("<h1>v2</h1>") });
    expect((await second.complete()).liveDeploy?.id).toBe(second.deployId);
    expect(blobs.objects.has(fileKey(site.id, first.deployId, "index.html"))).toBe(false);
    expect(blobs.objects.has(fileKey(site.id, first.deployId, "css/site.css"))).toBe(false);
    const old = await db.query.siteDeploys.findFirst({
      where: eq(schema.siteDeploys.id, first.deployId),
    });
    expect(old?.status).toBe("superseded");
  });

  it.each([
    [
      "a checksum that does not match",
      { "index.html": PAGE },
      { declaredSha: "0".repeat(64) },
      /checksum/,
    ],
    [
      "a path that escapes the site",
      { "index.html": PAGE, "../evil.html": PAGE },
      {},
      /plain file path/,
    ],
    [
      "a file type websites cannot use",
      { "index.html": PAGE, "run.sh": text("rm -rf /") },
      {},
      /not allowed/,
    ],
    ["no index.html", { "about.html": PAGE }, {}, /index\.html/],
    ["a hidden file", { "index.html": PAGE, ".env": text("SECRET=1") }, {}, /Hidden/],
  ] as const)(
    "rejects an upload with %s and keeps nothing",
    async (_what, files, options, message) => {
      const p = await user("reject");
      const site = await sites.create(p, { name: unique("rej"), acceptTerms: true });
      const deploy = await publish(p, site.id, files, options);
      const error = await failure(deploy.complete());
      expect(error.code).toBe("site_upload_invalid");
      expect(error.message).toMatch(message);
      expect([...blobs.objects.keys()].some((k) => k.startsWith(`sites/${site.id}/`))).toBe(false);
      expect(blobs.objects.has(uploadKey(p.orgId, site.id, deploy.deployId))).toBe(false);
      const row = await db.query.siteDeploys.findFirst({
        where: eq(schema.siteDeploys.id, deploy.deployId),
      });
      expect(row?.status).toBe("rejected");
      // A rejected deploy stays rejected.
      expect((await failure(deploy.complete())).code).toBe("site_upload_invalid");
    },
  );

  it("rejects a file that is not a zip", async () => {
    const p = await user("notzip");
    const site = await sites.create(p, { name: unique("nz"), acceptTerms: true });
    const bytes = text("this is not a zip file at all");
    const created = await sites.createDeploy(p, site.id, {
      size: bytes.byteLength,
      sha256: await sha(bytes),
    });
    blobs.put(uploadKey(p.orgId, site.id, created.deploy.id), bytes);
    expect((await failure(sites.completeDeploy(p, site.id, created.deploy.id))).message).toMatch(
      /zip/,
    );
  });

  it("holds a page that asks for a password, and leaves the live deploy alone", async () => {
    const p = await user("hold");
    const site = await sites.create(p, { name: unique("held"), acceptTerms: true });
    const good = await publish(p, site.id, { "index.html": PAGE });
    await good.complete();
    const bad = await publish(p, site.id, {
      "index.html": PAGE,
      "login.html": text('<form><input type="password" name="pw"></form>'),
    });
    const after = await bad.complete();
    expect(after.liveDeploy?.id).toBe(good.deployId);
    expect(after.pendingDeploy).toMatchObject({ id: bad.deployId, status: "held" });
    expect(after.pendingDeploy?.reason).toMatch(/password/);
  });

  it("refuses zips over the plan size before issuing an upload", async () => {
    const p = await user("big");
    const site = await sites.create(p, { name: unique("big"), acceptTerms: true });
    const error = await failure(
      sites.createDeploy(p, site.id, { size: 25 * 1024 * 1024 + 1, sha256: "a".repeat(64) }),
    );
    expect(error.code).toBe("site_too_large");
  });

  it("stops publishing while the sites kill switch is engaged", async () => {
    const p = await user("kill");
    const site = await sites.create(p, { name: unique("kill"), acceptTerms: true });
    await db
      .insert(schema.killSwitches)
      .values({ name: "sites", engaged: true })
      .onConflictDoUpdate({ target: schema.killSwitches.name, set: { engaged: true } });
    try {
      expect((await failure(sites.create(p, { name: unique("k2"), acceptTerms: true }))).code).toBe(
        "sites_paused",
      );
      expect(
        (await failure(sites.createDeploy(p, site.id, { size: 100, sha256: "a".repeat(64) }))).code,
      ).toBe("sites_paused");
    } finally {
      await db
        .update(schema.killSwitches)
        .set({ engaged: false })
        .where(eq(schema.killSwitches.name, "sites"));
    }
  });
});

describe("unpublishing", () => {
  it("deletes the site and its files and frees the name", async () => {
    const p = await user("remove");
    const site = await sites.create(p, { name: unique("gone"), acceptTerms: true });
    const deploy = await publish(p, site.id, { "index.html": PAGE });
    await deploy.complete();
    await sites.remove(p, site.id);
    expect(blobs.objects.has(fileKey(site.id, deploy.deployId, "index.html"))).toBe(false);
    expect((await sites.nameAvailability(site.name)).available).toBe(true);
    expect((await sites.list(p)).sites).toHaveLength(0);
  });

  it("does not let an owner delete a site DJL took down", async () => {
    const p = await user("takedown");
    const site = await sites.create(p, { name: unique("down"), acceptTerms: true });
    await db.update(schema.sites).set({ status: "disabled" }).where(eq(schema.sites.id, site.id));
    expect((await failure(sites.remove(p, site.id))).code).toBe("site_disabled");
    expect(
      (await failure(sites.createDeploy(p, site.id, { size: 100, sha256: "a".repeat(64) }))).code,
    ).toBe("site_disabled");
  });
});

describe("isolation", () => {
  it("hides one user's sites and deploys from other users, in other orgs and the same org", async () => {
    const owner = await user("iso-owner");
    const stranger = await user("iso-stranger");
    const mate = await teammate(owner);
    const site = await sites.create(owner, { name: unique("iso"), acceptTerms: true });
    const deploy = await publish(owner, site.id, { "index.html": PAGE });

    for (const other of [stranger, mate]) {
      expect((await sites.list(other)).sites.map((s) => s.id)).not.toContain(site.id);
      expect((await failure(sites.get(other, site.id))).status).toBe(404);
      expect(
        (await failure(sites.createDeploy(other, site.id, { size: 100, sha256: "a".repeat(64) })))
          .status,
      ).toBe(404);
      expect((await failure(sites.completeDeploy(other, site.id, deploy.deployId))).status).toBe(
        404,
      );
      expect((await failure(sites.remove(other, site.id))).status).toBe(404);
    }
    // Pairing a deploy with another of the owner's own sites does not work either.
    const otherSite = await sites.create(owner, { name: unique("iso2"), acceptTerms: true });
    expect((await failure(sites.completeDeploy(owner, otherSite.id, deploy.deployId))).status).toBe(
      404,
    );
    // The owner's deploy was untouched by all of that.
    expect((await deploy.complete()).liveDeploy?.id).toBe(deploy.deployId);
  });

  it("treats malformed ids as missing", async () => {
    const p = await user("iso-ids");
    expect((await failure(sites.get(p, "not-a-uuid"))).status).toBe(404);
    expect((await failure(sites.get(p, "../../x"))).status).toBe(404);
  });
});

describe("reports", () => {
  it("records a visitor report and limits reports per IP", async () => {
    const p = await user("report");
    const site = await sites.create(p, { name: unique("rep"), acceptTerms: true });
    const ip = `ip-${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i++) await sites.report(ip, { name: site.name, reason: "phishing" });
    expect((await failure(sites.report(ip, { name: site.name, reason: "spam" }))).status).toBe(429);
    const rows = await db.query.siteReports.findMany({
      where: eq(schema.siteReports.siteId, site.id),
    });
    expect(rows).toHaveLength(5);
    expect(
      (
        await failure(
          sites.report(`ip-${crypto.randomUUID()}`, { name: unique("none"), reason: "spam" }),
        )
      ).status,
    ).toBe(404);
  });
});
