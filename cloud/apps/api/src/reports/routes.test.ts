import { ServiceMap } from "effect";
import { HttpRouter } from "effect/unstable/http";
import type { CloudSendMessageInput } from "@synara/contracts/cloud";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "../auth/guard.ts";
import { createMemoryRateLimiter } from "../gateway/RateLimiter.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import { chatHarness } from "../testing/chat.ts";
import { ContentReportService } from "./ContentReportService.ts";
import { makeContentReportRoutes } from "./routes.ts";

const h = chatHarness();
const sessions = new Map<string, Principal>();
const app = HttpRouter.toWebHandler(
  makeContentReportRoutes({
    contentReports: new ContentReportService(h.db, h.chat, createMemoryRateLimiter()),
    ipSalt: "test-salt",
    principals: {
      resolve: async ({ headers }) => {
        const token = /^Bearer (.+)$/.exec(headers.get("authorization") ?? "")?.[1];
        const p = token ? sessions.get(token) : undefined;
        if (!p) throw new ApiError(401, "unauthorized", "Sign in required.");
        return p;
      },
    },
  }),
  { disableLogger: true },
);
afterAll(async () => {
  await app.dispose();
  await h.close();
});

function post(body: unknown, init: { headers?: Record<string, string>; ip?: string } = {}) {
  return app.handler(
    new Request("https://cloud.test/v1/reports", {
      method: "POST",
      headers: { "content-type": "application/json", ...init.headers },
      body: JSON.stringify(body),
    }),
    ServiceMap.make(RequestContext, {
      traceId: "t",
      ip: init.ip ?? "198.51.100.7",
      userAgent: null,
      region: "test",
      startedAt: 0,
    }),
  );
}

let owner = { token: "", conversationId: "", replyId: "" };
beforeAll(async () => {
  const u = await h.user("report-route");
  const c = await h.chat.create(u.p, {});
  const sent = await h.chat.send(u.facts, c.id, {
    clientMessageId: crypto.randomUUID(),
    parentId: null,
    parts: [{ type: "text", text: "hello" }],
    model: "gpt-5-mini",
    mode: "chat",
  } as unknown as CloudSendMessageInput);
  await h.runner.idle();
  owner = { token: crypto.randomUUID(), conversationId: c.id, replyId: sent.reply.id };
  sessions.set(owner.token, u.p);
});

describe("POST /v1/reports", () => {
  it("accepts a signed-out desktop report", async () => {
    const res = await post(
      { source: "desktop", reason: "harmful", text: "answer", agent: "Codex" },
      { ip: "198.51.100.1" },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { report: { id: string; createdAt: string } };
    expect(body.report.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(body.report.createdAt))).toBe(false);
  });

  it("refuses a signed-out cloud report and any bad credential with 401", async () => {
    const cloud = {
      source: "cloud",
      reason: "offensive",
      conversationId: owner.conversationId,
      messageId: owner.replyId,
    };
    expect((await post(cloud)).status).toBe(401);
    const desktop = { source: "desktop", reason: "other", text: "answer" };
    expect((await post(desktop, { headers: { authorization: "Bearer stale" } })).status).toBe(401);
    expect((await post(desktop, { headers: { cookie: "djl.session_token=forged" } })).status).toBe(
      401,
    );
    // Unrelated cookies are not a credential.
    expect((await post(desktop, { headers: { cookie: "djl_csrf=abc" } })).status).toBe(201);
  });

  it("creates a signed-in cloud report with 201, then returns it with 200", async () => {
    const cloud = {
      source: "cloud",
      reason: "offensive",
      conversationId: owner.conversationId,
      messageId: owner.replyId,
    };
    const auth = { headers: { authorization: `Bearer ${owner.token}` } };
    const first = await post(cloud, auth);
    expect(first.status).toBe(201);
    const again = await post(cloud, auth);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(await first.json());
  });

  it("rejects bodies that break the contract with 400", async () => {
    for (const body of [
      { source: "desktop", reason: "spam", text: "x" },
      { source: "desktop", reason: "other", text: "" },
      { source: "desktop", reason: "other", text: "x".repeat(20_001) },
      { source: "desktop", reason: "other", text: "x", note: "n".repeat(1001) },
      { source: "desktop", reason: "other", text: "x", messageId: owner.replyId },
    ])
      expect((await post(body, { ip: "198.51.100.2" })).status).toBe(400);
  });

  it("limits signed-out callers per IP", async () => {
    const desktop = { source: "desktop", reason: "other", text: "answer" };
    for (let i = 0; i < 10; i++)
      expect((await post(desktop, { ip: "198.51.100.3" })).status).toBe(201);
    const limited = await post(desktop, { ip: "198.51.100.3" });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
    expect((await post(desktop, { ip: "198.51.100.4" })).status).toBe(201);
  });
});
