import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { schema } from "@djl/db";
import { loadApiEnv } from "../../config/env.ts";
import { startApi, type ApiRuntime } from "../../server.ts";
import { TestClient } from "../../testing/client.ts";
import { ReviewLinkService } from "./ReviewLinkService.ts";
let api: ApiRuntime;
beforeAll(async () => {
  api = await startApi({
    env: loadApiEnv({ ...process.env, DJL_ENV: "test" }),
    host: "127.0.0.1",
    port: 0,
  });
});
afterAll(async () => {
  await api?.close();
});
it("serves anonymous header-token previews and bytes with private headers and revocation", async () => {
  const owner = TestClient.for(api);
  const p = await owner.signUp(api, "synthetic-public-review");
  const bytes = new Uint8Array([255, 216, 255]);
  const storageKey = `org/${p.orgId}/synthetic-http-review`;
  await api.blobs.write(storageKey, bytes, "image/jpeg");
  const [account] = await api.db
    .insert(schema.socialAccounts)
    .values({
      ...p,
      provider: "instagram",
      providerAccountId: crypto.randomUUID(),
      username: "synthetic",
      displayName: "Synthetic",
      scopes: [],
      capabilities: { publish: true, metrics: false },
      status: "connected",
      expiresAt: new Date(Date.now() + 3600000),
    })
    .returning();
  const [file] = await api.db
    .insert(schema.files)
    .values({
      ...p,
      name: "synthetic.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 3,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      storageKey,
      status: "ready",
    })
    .returning();
  const [draft] = await api.db
    .insert(schema.socialDrafts)
    .values({
      ...p,
      threadId: "synthetic-http-thread",
      revision: 1,
      content: {
        caption: "Synthetic HTTP caption",
        captions: { [account!.id]: "Synthetic HTTP caption" },
        mediaFileIds: [file!.id],
        accountIds: [account!.id],
        scheduledAt: "2030-01-01T00:00:00Z",
        timezone: "UTC",
      },
    })
    .returning();
  const service = new ReviewLinkService(api.db, api.blobs);
  const createdResponse = await owner.call(`/v1/social/drafts/${draft!.id}/review-links`, {
    method: "POST",
    json: { revision: 1, expiresInHours: 24, disclosureAccepted: true },
  });
  expect(createdResponse.status).toBe(201);
  const created = await createdResponse.json();
  expect(created.reviewUrl).toBe(new URL(created.reviewPath, api.env.webPublicUrl).href);

  const base = `http://127.0.0.1:${api.address.port}`;
  const headers = { "x-review-token": created.token };
  const preview = await fetch(`${base}/v1/social/review`, { headers });
  expect(preview.status).toBe(200);
  expect(preview.headers.get("cache-control")).toBe("no-store, private");
  expect(preview.headers.get("referrer-policy")).toBe("no-referrer");
  expect(preview.headers.get("x-robots-tag")).toContain("noindex");
  const body = await preview.text();
  expect(body).toContain("Synthetic HTTP caption");
  for (const secret of [storageKey, p.userId, p.orgId, file!.id, draft!.id, created.token])
    expect(body).not.toContain(secret);
  const media = await fetch(`${base}/v1/social/review/media/0`, { headers });
  expect(media.status).toBe(200);
  expect(media.headers.get("content-type")).toContain("image/jpeg");
  expect(new Uint8Array(await media.arrayBuffer())).toEqual(bytes);
  const feedback = await fetch(`${base}/v1/social/review/feedback`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ reviewerName: "Synthetic reviewer", comment: "", decision: "approved" }),
  });
  expect(feedback.status).toBe(201);
  expect(await feedback.json()).toMatchObject({ identityVerified: false, decision: "approved" });
  expect((await fetch(`${base}/v1/social/review?token=${created.token}`)).status).toBe(404);
  expect((await fetch(`${base}/v1/social/drafts/${draft!.id}/review-links`)).status).toBe(401);
  const cors = await fetch(`${base}/v1/social/review`, {
    method: "OPTIONS",
    headers: { origin: api.env.webPublicUrl, "access-control-request-headers": "x-review-token" },
  });
  expect(cors.headers.get("access-control-allow-headers")).toContain("x-review-token");
  await service.revoke(p, created.link.id);
  expect((await fetch(`${base}/v1/social/review/media/0`, { headers })).status).toBe(404);
});
