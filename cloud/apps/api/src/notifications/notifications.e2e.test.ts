import { eq, sql } from "drizzle-orm";
import { schema } from "@djl/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { TestClient } from "../testing/client.ts";

let api: ApiRuntime;
let alice: Awaited<ReturnType<typeof signUp>>;
let bob: Awaited<ReturnType<typeof signUp>>;
let own: Awaited<ReturnType<typeof task>>;
let foreign: Awaited<ReturnType<typeof task>>;

async function signUp(label: string) {
  const client = TestClient.for(api);
  const email = `${label}-${crypto.randomUUID()}@test.invalid`;
  await client.call("/v1/auth/sign-up/email", {
    method: "POST",
    json: { email, name: label, password: "correct-horse-battery-staple" },
  });
  const otp = api.outbox!.emails.find((entry) => entry.to === email)!.subject.match(/^(\d{6})/)![1];
  await client.call("/v1/auth/email-otp/verify-email", { method: "POST", json: { email, otp } });
  const me = await (await client.call("/v1/me")).json();
  return { client, userId: me.user.id as string, orgId: me.activeOrgId as string };
}

async function task(
  owner: typeof alice,
  status: "succeeded" | "failed" | "cancelled" = "succeeded",
  mode: "task" | "chat" = "task",
) {
  const [conversation] = await api.db
    .insert(schema.conversations)
    .values({ orgId: owner.orgId, userId: owner.userId, title: "QA task" })
    .returning();
  const [message] = await api.db
    .insert(schema.messages)
    .values({ conversationId: conversation!.id, role: "assistant", parts: [] })
    .returning();
  const [run] = await api.db
    .insert(schema.runs)
    .values({
      orgId: owner.orgId,
      userId: owner.userId,
      conversationId: conversation!.id,
      messageId: message!.id,
      model: "test",
      mode,
      status,
      finishedAt: new Date(),
    })
    .returning();
  return run!;
}

beforeAll(async () => {
  api = await startApi({
    env: loadApiEnv({ ...process.env, DJL_ENV: "test" }),
    port: 0,
    host: "127.0.0.1",
  });
  alice = await signUp("notification-alice");
  bob = await signUp("notification-bob");
  own = await task(alice);
  foreign = await task(bob);
  await task(alice, "cancelled");
  await task(alice, "succeeded", "chat");
});
afterAll(async () => {
  await api?.close();
});

it("lists durable task completions only for their owner", async () => {
  const response = await alice.client.call("/v1/notifications");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.notifications.map((entry: { id: string }) => entry.id)).toEqual([own.id]);
  expect(body.unreadCount).toBe(1);
  expect(body.notifications[0].readAt).toBeNull();
});

it("marks read once and rejects foreign or mixed ownership batches atomically", async () => {
  const mixed = await alice.client.call("/v1/notifications/read", {
    method: "POST",
    json: { ids: [own.id, foreign.id] },
  });
  expect(mixed.status).toBe(404);
  expect((await (await alice.client.call("/v1/notifications")).json()).unreadCount).toBe(1);
  for (let i = 0; i < 2; i++) {
    const response = await alice.client.call("/v1/notifications/read", {
      method: "POST",
      json: { ids: [own.id] },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).unreadCount).toBe(0);
  }
  expect(
    (await bob.client.call("/v1/notifications/read", { method: "POST", json: { ids: [own.id] } }))
      .status,
  ).toBe(404);
});

it("excludes deleted conversations and requires sign-in", async () => {
  const removed = await task(alice, "failed");
  await api.db
    .update(schema.conversations)
    .set({ deletedAt: new Date() })
    .where(eq(schema.conversations.id, removed.conversationId));
  const body = await (await alice.client.call("/v1/notifications")).json();
  expect(body.notifications.map((entry: { id: string }) => entry.id)).not.toContain(removed.id);
  expect((await fetch(`http://127.0.0.1:${api.address.port}/v1/notifications`)).status).toBe(401);
});

it("paginates deterministically and counts unread entries beyond the page", async () => {
  for (let i = 0; i < 31; i++) await task(alice);
  const first = await (await alice.client.call("/v1/notifications")).json();
  expect(first.notifications).toHaveLength(30);
  expect(first.unreadCount).toBe(31);
  const second = await (
    await alice.client.call(`/v1/notifications?cursor=${encodeURIComponent(first.nextCursor)}`)
  ).json();
  const ids = [...first.notifications, ...second.notifications].map(
    (entry: { id: string }) => entry.id,
  );
  expect(ids).toHaveLength(32);
  expect(new Set(ids).size).toBe(32);
  expect(second.nextCursor).toBeNull();
});

it("rejects malformed cursor UUIDs as client errors", async () => {
  const cursor = Buffer.from(
    JSON.stringify({ at: new Date().toISOString(), id: "-".repeat(36) }),
  ).toString("base64url");
  const response = await alice.client.call(`/v1/notifications?cursor=${cursor}`);
  expect(response.status).toBe(400);
  const invalidDate = Buffer.from(
    JSON.stringify({ at: "2026-02-30T00:00:00Z", id: own.id }),
  ).toString("base64url");
  expect((await alice.client.call(`/v1/notifications?cursor=${invalidDate}`)).status).toBe(400);
});

it("does not lose completions that share a millisecond at a page boundary", async () => {
  const owner = await signUp("notification-precision");
  for (let i = 1; i <= 31; i++) {
    const run = await task(owner);
    await api.db
      .update(schema.runs)
      .set({
        finishedAt: sql`'2000-01-01T00:00:00Z'::timestamptz + ${i} * interval '1 microsecond'`,
      })
      .where(eq(schema.runs.id, run.id));
  }
  const first = await (await owner.client.call("/v1/notifications")).json();
  const next = await (
    await owner.client.call(`/v1/notifications?cursor=${encodeURIComponent(first.nextCursor)}`)
  ).json();
  expect(first.notifications).toHaveLength(30);
  expect(next.notifications).toHaveLength(1);
});
