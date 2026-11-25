/**
 * The whole publish path against a running API: sign up, claim a name, upload a zip to the
 * presigned URL, complete, then load the page through the sites server reading the same
 * database and storage. Also sends a visitor report through the server to the API.
 */
import { eq } from "drizzle-orm";
import { zipSync } from "fflate";
import { schema } from "@djl/db";
import type { FakeBlobStore } from "@djl/api/blobs";
import { startApi, type ApiRuntime } from "@djl/api/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The API's test client is not part of its public exports; reuse it directly.
import { TestClient } from "../../api/src/testing/client.ts";
import { loadApiEnv } from "../../api/src/config/env.ts";
import { createReportForwarder, createSiteLookup } from "./data.ts";
import { BADGE, makeSiteHandler } from "./handler.ts";

let api: ApiRuntime;
beforeAll(async () => {
  const env = loadApiEnv({ ...process.env, DJL_ENV: "test", DJL_MOCK_EXTERNALS: "true" });
  api = await startApi({ env, port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await api.close();
});

const text = (s: string) => new TextEncoder().encode(s);

describe("publishing a site end to end", () => {
  it("serves what was uploaded, with the badge, and forwards reports to the API", async () => {
    const client = TestClient.for(api);
    await client.signUp(api, "site-e2e");
    const name = `e2e-${crypto.randomUUID().slice(0, 8)}`;

    const created = await client.call("/v1/sites", {
      method: "POST",
      json: { name, acceptTerms: true },
    });
    expect(created.status).toBe(201);
    const { site } = (await created.json()) as { site: { id: string; url: string } };
    expect(site.url).toBe(`https://${name}.slcor.site`);

    const zip = zipSync({
      "index.html": text("<html><body><h1>Fresh bread</h1></body></html>"),
      "menu.html": text("<h1>Menu</h1>"),
    });
    const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", zip as BufferSource)).toString(
      "hex",
    );
    const deploy = await client.call(`/v1/sites/${site.id}/deploys`, {
      method: "POST",
      json: { size: zip.byteLength, sha256 },
    });
    expect(deploy.status).toBe(201);
    const { deploy: row, upload } = (await deploy.json()) as {
      deploy: { id: string };
      upload: { url: string };
    };
    // What the desktop's PUT to the presigned URL stores.
    const key = decodeURIComponent(new URL(upload.url).pathname.replace("/upload/", ""));
    (api.blobs as FakeBlobStore).put(key, zip, "application/zip");

    const completed = await client.call(`/v1/sites/${site.id}/deploys/${row.id}/complete`, {
      method: "POST",
      json: {},
    });
    expect(completed.status).toBe(200);
    expect(
      ((await completed.json()) as { site: { liveDeploy: { id: string } } }).site.liveDeploy.id,
    ).toBe(row.id);

    const handle = makeSiteHandler({
      domain: "slcor.site",
      lookup: createSiteLookup(api.db),
      read: (k, max) => api.blobs.read(k, max),
      report: createReportForwarder(`http://127.0.0.1:${api.address.port}`),
    });
    const visit = (path: string, init: RequestInit = {}) =>
      handle(
        new Request(`http://sites${path}`, {
          ...init,
          headers: { host: `${name}.slcor.site`, ...(init.headers as Record<string, string>) },
        }),
        "198.51.100.7",
      );

    const home = await visit("/");
    expect(home.status).toBe(200);
    expect(await home.text()).toBe(`<html><body><h1>Fresh bread</h1>${BADGE}</body></html>`);
    expect(await (await visit("/menu")).text()).toContain("<h1>Menu</h1>");

    const report = await visit("/_djl/report", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "reason=phishing&note=asks+for+bank+login",
    });
    expect(report.status).toBe(200);
    const reports = await api.db.query.siteReports.findMany({
      where: eq(schema.siteReports.siteId, site.id),
    });
    expect(reports.map((r) => [r.reason, r.note])).toEqual([["phishing", "asks for bank login"]]);
    expect(reports[0]!.ipHash).not.toBeNull();

    // Another account cannot see or change this site.
    const stranger = TestClient.for(api);
    await stranger.signUp(api, "site-e2e-stranger");
    expect((await stranger.call(`/v1/sites/${site.id}`)).status).toBe(404);
    expect((await stranger.call(`/v1/sites/${site.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await visit("/")).status).toBe(200);
  });
});
