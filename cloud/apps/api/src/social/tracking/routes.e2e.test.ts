import { beforeAll, afterAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { startApi, type ApiRuntime } from "../../server.ts";
import { loadApiEnv } from "../../config/env.ts";
import { TestClient } from "../../testing/client.ts";
import { TrackingLinkService } from "./TrackingLinkService.ts";
import { socialTrackingLinks } from "../../../../../packages/db/src/schema/socialTrackingLinks.ts";
let api: ApiRuntime;
let alice: TestClient;
let bob: TestClient;
let owner: { orgId: string; userId: string };
const input = {
  url: "https://example.com/offer?utm_source=instagram&utm_medium=social&utm_campaign=synthetic",
  campaignId: "synthetic-campaign",
  threadId: "synthetic-chat",
  contentRevision: 2,
  expiresInDays: 7,
  disclosureAccepted: true,
};
beforeAll(async () => {
  api = await startApi({
    env: loadApiEnv({ ...process.env, DJL_ENV: "test" }),
    host: "127.0.0.1",
    port: 0,
  });
  alice = TestClient.for(api);
  bob = TestClient.for(api);
  owner = await alice.signUp(api, "synthetic-tracking-alice");
  await bob.signUp(api, "synthetic-tracking-bob");
});
afterAll(async () => {
  await api?.close();
});
it("counts each normal GET once while HEAD and prefetch preserve the fixed redirect without counting", async () => {
  const createdResponse = await alice.call("/v1/social/tracking-links", {
    method: "POST",
    json: input,
  });
  expect(createdResponse.status).toBe(201);
  const created = await createdResponse.json();
  expect(created.trackingUrl).toBe(new URL(created.publicPath, api.env.webPublicUrl).href);
  expect(created.link.trackingUrl).toBe(created.trackingUrl);
  const slug = created.publicPath.split("/l/")[1];
  const endpoint = `${alice.base}/v1/social/tracking-links/${slug}/open`;
  const normal = await fetch(`${endpoint}?url=https://evil.example.com/&utm_source=evil`, {
    redirect: "manual",
  });
  expect(normal.status).toBe(302);
  expect(normal.headers.get("location")).toBe(input.url);
  expect(normal.headers.get("cache-control")).toBe("no-store, private");
  expect(normal.headers.get("referrer-policy")).toBe("no-referrer");
  expect(await normal.text()).toBe("");
  for (const init of [
    { method: "HEAD" },
    { headers: { purpose: "prefetch" } },
    { headers: { "sec-purpose": "prefetch;prerender" } },
  ]) {
    const response = await fetch(endpoint, { ...init, redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(input.url);
  }
  const result = await (await alice.call(`/v1/social/tracking-links/${created.link.id}`)).json();
  expect(result).toMatchObject({
    linkOpens: 1,
    measurement: "link_opens",
    contentRevision: 2,
    trackingUrl: created.trackingUrl,
  });
  const ownerLinks = await (
    await alice.call(`/v1/social/tracking-links?campaignId=${input.campaignId}`)
  ).json();
  expect(ownerLinks.find((link: { id: string }) => link.id === created.link.id).trackingUrl).toBe(
    created.trackingUrl,
  );
  expect(result.notice).toMatch(/previews and bots/);
  expect(result.daily).toHaveLength(1);
  expect((await bob.call(`/v1/social/tracking-links/${created.link.id}`)).status).toBe(404);
  expect(
    (await bob.call(`/v1/social/tracking-links/${created.link.id}`, { method: "DELETE" })).status,
  ).toBe(404);
  const foreignList = await (
    await bob.call(`/v1/social/tracking-links?campaignId=${input.campaignId}`)
  ).json();
  expect(foreignList).toEqual([]);
  expect((await fetch(`${alice.base}/v1/social/tracking-links/${created.link.id}`)).status).toBe(
    401,
  );
  expect(
    (await alice.call(`/v1/social/tracking-links/${created.link.id}`, { method: "DELETE" })).status,
  ).toBe(200);
  expect((await fetch(endpoint, { redirect: "manual" })).status).toBe(404);
  expect(
    (await (await alice.call(`/v1/social/tracking-links/${created.link.id}`)).json()).linkOpens,
  ).toBe(1);
});
it("returns404 for expired links and refuses unsafe create targets without disclosure or publication", async () => {
  const service = new TrackingLinkService(api.db, () => new Date(Date.now() - 8 * 86400000));
  const expired = await service.create(owner, { ...input, expiresInDays: 7 });
  const response = await fetch(
    `${alice.base}/v1/social/tracking-links/${expired.publicPath.split("/l/")[1]}/open`,
    { redirect: "manual" },
  );
  expect(response.status).toBe(404);
  for (const invalid of [
    { ...input, disclosureAccepted: false },
    { ...input, url: "https://example.com/?access_token=synthetic" },
  ])
    expect(
      (await alice.call("/v1/social/tracking-links", { method: "POST", json: invalid })).status,
    ).toBe(400);
});
it("throttles anonymous opens and bounds per-owner link creation", async () => {
  const created = await (
    await bob.call("/v1/social/tracking-links", { method: "POST", json: input })
  ).json();
  const endpoint = `${bob.base}/v1/social/tracking-links/${created.publicPath.split("/l/")[1]}/open`;
  const responses = await Promise.all(
    Array.from({ length: 121 }, () => fetch(endpoint, { redirect: "manual" })),
  );
  expect(responses.filter((response) => response.status === 302)).toHaveLength(120);
  expect(responses.filter((response) => response.status === 429)).toHaveLength(1);
  expect(
    (await (await bob.call(`/v1/social/tracking-links/${created.link.id}`)).json()).linkOpens,
  ).toBe(120);
  for (let i = 0; i < 19; i++)
    expect(
      (await bob.call("/v1/social/tracking-links", { method: "POST", json: input })).status,
    ).toBe(201);
  expect(
    (await bob.call("/v1/social/tracking-links", { method: "POST", json: input })).status,
  ).toBe(429);
  const rows = await api.db
    .select()
    .from(socialTrackingLinks)
    .where(eq(socialTrackingLinks.userId, (await (await bob.call("/v1/me")).json()).user.id));
  expect(rows).toHaveLength(20);
});
