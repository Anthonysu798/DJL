import { eq, and } from "drizzle-orm";
import { schema } from "@djl/db";
import { Redis } from "ioredis";
import { afterAll, beforeAll, expect, it } from "vitest";
import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { TestClient } from "../testing/client.ts";
import { ImageRunExecutor } from "./ImageRunExecutor.ts";
import { RunLog } from "../runs/RunLog.ts";
let api: ApiRuntime, alice: TestClient, bob: TestClient;
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:63799");
async function signUp(label: string) {
  const client = TestClient.for(api);
  const email = `${label}-${crypto.randomUUID()}@test.invalid`;
  await client.call("/v1/auth/sign-up/email", {
    method: "POST",
    json: { email, name: label, password: "correct-horse-battery-staple" },
  });
  const otp = api.outbox!.emails.find((e) => e.to === email)!.subject.match(/^(\d{6})/)![1];
  await client.call("/v1/auth/email-otp/verify-email", { method: "POST", json: { email, otp } });
  return client;
}
beforeAll(async () => {
  api = await startApi({
    env: loadApiEnv({ ...process.env, DJL_ENV: "test" }),
    port: 0,
    host: "127.0.0.1",
  });
  alice = await signUp("image-alice");
  bob = await signUp("image-bob");
});
afterAll(async () => {
  redis.disconnect();
  await api?.close();
});
it("creates an owned image task over HTTP, settles once, and lists a private gallery", async () => {
  const conversation = await (
    await alice.call("/v1/conversations", { method: "POST", json: { title: "Image QA" } })
  ).json();
  const input = { clientMessageId: crypto.randomUUID(), prompt: "A blue desk", aspectRatio: "1:1" };
  const send = () =>
    alice.call(`/v1/conversations/${conversation.id}/images`, { method: "POST", json: input });
  const response = await send();
  expect(response.status).toBe(200);
  const first = await response.json();
  const retry = await (await send()).json();
  expect(retry.run.id).toBe(first.run.id);
  const me = await (await alice.call("/v1/me")).json();
  await api.ledger.grant({
    orgId: me.activeOrgId,
    bucket: "topup",
    type: "topup",
    amount: 100_000_000n,
    idempotencyKey: `image-http:${conversation.id}`,
    actor: "test",
  });
  const executor = new ImageRunExecutor({
    db: api.db,
    blobs: api.blobs,
    log: new RunLog(api.db, redis),
    gateway: api.gateway,
  });
  await executor.execute(first.run.id, new AbortController().signal);
  await executor.execute(first.run.id, new AbortController().signal);
  const gallery = await (await alice.call("/v1/images")).json();
  expect(gallery.images).toHaveLength(1);
  expect(gallery.images[0].mimeType).toBe("image/png");
  expect(gallery.images[0].conversationId).toBe(conversation.id);
  const usage = await api.db
    .select()
    .from(schema.usageRequests)
    .where(
      and(
        eq(schema.usageRequests.orgId, me.activeOrgId),
        eq(schema.usageRequests.endpoint, "images.generations"),
      ),
    );
  expect(usage).toHaveLength(1);
  expect(usage[0]?.status).toBe("settled");
  expect((await (await bob.call("/v1/images")).json()).images).toHaveLength(0);
  expect(
    (await bob.call(`/v1/conversations/${conversation.id}/images`, { method: "POST", json: input }))
      .status,
  ).toBe(404);
  expect((await alice.call("/v1/images?cursor=bad")).status).toBe(400);
  expect(
    (await alice.call(`/v1/conversations/not-a-uuid/images`, { method: "POST", json: input }))
      .status,
  ).toBe(404);
});
it("validates aspect ratios and prompt before enqueue", async () => {
  const c = await (await alice.call("/v1/conversations", { method: "POST", json: {} })).json();
  const response = await alice.call(`/v1/conversations/${c.id}/images`, {
    method: "POST",
    json: { clientMessageId: crypto.randomUUID(), prompt: "", aspectRatio: "9:16" },
  });
  expect(response.status).toBe(400);
  expect(
    await api.db.select().from(schema.runs).where(eq(schema.runs.conversationId, c.id)),
  ).toHaveLength(0);
});
