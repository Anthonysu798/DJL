/**
 * Chat over real HTTP: two signed-up users, the real server, the fake
 * provider. Covers the SSE stream, a client leaving mid-reply, cross-user
 * access (always 404), and the public share view.
 */
import { creditsToMicro } from "@djl/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { TestClient, type CallInit } from "../testing/client.ts";

let api: ApiRuntime;

type Call = (path: string, init?: CallInit) => Promise<Response>;

/** A signed-in browser: cookie jar, the web app's CSRF header, and its own client IP. */
function client(): Call {
  const browser = TestClient.for(api);
  return (path, init) => browser.call(path, init);
}

async function signUp(label: string): Promise<{ call: Call; orgId: string }> {
  const call = client();
  const email = `${label}-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
  await call("/v1/auth/sign-up/email", {
    method: "POST",
    json: { email, password: "correct-horse-battery-staple", name: label },
  });
  const otp = api
    .outbox!.emails.find((m) => m.to === email && m.tag === "otp")!
    .subject.match(/^(\d{6})/)![1];
  await call("/v1/auth/email-otp/verify-email", { method: "POST", json: { email, otp } });
  const orgId = (await (await call("/v1/me")).json()).activeOrgId as string;
  await api.ledger.grant({
    orgId,
    bucket: "topup",
    type: "topup",
    amount: creditsToMicro(100),
    idempotencyKey: `chat-e2e:${orgId}`,
    actor: "test",
  });
  return { call, orgId };
}

const send = (call: Call, conversationId: string, text: string) =>
  call(`/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    json: {
      clientMessageId: crypto.randomUUID(),
      parentId: null,
      parts: [{ type: "text", text }],
      model: "gpt-5-mini",
      mode: "chat",
    },
  });

let alice: { call: Call; orgId: string };
let bob: { call: Call; orgId: string };

beforeAll(async () => {
  const env = loadApiEnv({ ...process.env, DJL_ENV: "test", DJL_MOCK_EXTERNALS: "true" });
  api = await startApi({ env, port: 0, host: "127.0.0.1" });
  alice = await signUp("alice");
  bob = await signUp("bob");
});
afterAll(async () => {
  await api.close();
});

describe("chat over HTTP", () => {
  it("requires a session and decodes requests with the contract", async () => {
    const anonymous = client();
    expect((await anonymous("/v1/conversations")).status).toBe(401);
    const c = await (await alice.call("/v1/conversations", { method: "POST", json: {} })).json();
    const bad = await alice.call(`/v1/conversations/${c.id}/messages`, {
      method: "POST",
      json: { clientMessageId: "x", parentId: null, parts: [], model: "m", mode: "chat" },
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("bad_request");
    expect((await alice.call("/v1/conversations/not-a-uuid")).status).toBe(404);
    const search = await alice.call("/v1/conversations/search?q=nothing-matches-this");
    expect(search.status).toBe(200);
    expect(await search.json()).toEqual({ results: [], nextCursor: null });
    expect((await alice.call("/v1/conversations/search")).status).toBe(400);
  });

  it("sends a message and streams the run as SSE until its terminal status", async () => {
    const c = await (await alice.call("/v1/conversations", { method: "POST", json: {} })).json();
    const sent = await send(alice.call, c.id, "hi over http");
    expect(sent.status).toBe(201);
    const { run, reply } = await sent.json();
    const res = await alice.call(`/v1/runs/${run.id}/events?after=0`, {
      headers: { accept: "text/event-stream" },
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    const events = body
      .split("\n\n")
      .filter((b) => b.startsWith("id: "))
      .map((b) => JSON.parse(b.match(/^data: (.+)$/m)![1]!));
    expect(events.at(-1)).toMatchObject({ type: "status", payload: { status: "succeeded" } });
    expect(body).toContain("event: text.delta");
    const text = events
      .filter((e) => e.type === "text.delta")
      .map((e) => e.payload.text)
      .join("");
    expect(text).toBe("echo: hi over http");
    await api.runner.idle();
    const branch = await (await alice.call(`/v1/conversations/${c.id}/messages`)).json();
    expect(branch.messages.at(-1)).toMatchObject({ id: reply.id, parts: [{ type: "text", text }] });
  });

  it("keeps running when the client disconnects mid-stream", async () => {
    const c = await (await alice.call("/v1/conversations", { method: "POST", json: {} })).json();
    const { run } = await (await send(alice.call, c.id, "long:1000")).json();
    const controller = new AbortController();
    const res = await alice.call(`/v1/runs/${run.id}/events`, {
      headers: { accept: "text/event-stream" },
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => undefined);
    await api.runner.idle();
    const after = await (await alice.call(`/v1/runs/${run.id}`)).json();
    expect(after.run.status).toBe("succeeded");
    const branch = await (await alice.call(`/v1/conversations/${c.id}/messages`)).json();
    expect(branch.messages.at(-1).parts[0].text).toHaveLength(40_000);
    // Any device can replay the whole run afterwards as JSON, page by page.
    const seqs: number[] = [];
    let page: { events: { seq: number; type: string; payload: { status?: string } }[] };
    do {
      page = await (await alice.call(`/v1/runs/${run.id}/events?after=${seqs.at(-1) ?? 0}`)).json();
      seqs.push(...page.events.map((e) => e.seq));
    } while (page.events.length > 0 && page.events.at(-1)!.type !== "status");
    expect(seqs).toEqual(seqs.map((_s, i) => i + 1));
    expect(page.events.at(-1)!.payload.status).toBe("succeeded");
  });

  it("answers 404 to another user for every conversation, run, file, and share route", async () => {
    const c = await (await alice.call("/v1/conversations", { method: "POST", json: {} })).json();
    const { run, reply } = await (await send(alice.call, c.id, "alice only")).json();
    await api.runner.idle();
    const file = await (
      await alice.call("/v1/files", {
        method: "POST",
        json: {
          name: "a.txt",
          mimeType: "text/plain",
          size: 3,
          sha256: "0".repeat(64),
          purpose: "attachment",
        },
      })
    ).json();
    const share = await (
      await alice.call(`/v1/conversations/${c.id}/shares`, { method: "POST", json: {} })
    ).json();
    const attempts: [string, string, unknown?][] = [
      ["GET", `/v1/conversations/${c.id}`],
      ["PATCH", `/v1/conversations/${c.id}`, { title: "bob's now" }],
      ["DELETE", `/v1/conversations/${c.id}`],
      ["GET", `/v1/conversations/${c.id}/messages`],
      ["POST", `/v1/conversations/${c.id}/messages/${reply.id}/regenerate`, {}],
      ["POST", `/v1/conversations/${c.id}/shares`, {}],
      ["GET", `/v1/runs/${run.id}`],
      ["GET", `/v1/runs/${run.id}/events`],
      ["POST", `/v1/runs/${run.id}/cancel`],
      ["POST", `/v1/files/${file.file.id}/complete`],
      ["GET", `/v1/files/${file.file.id}/url`],
      ["DELETE", `/v1/shares/${share.share.id}`],
    ];
    for (const [method, path, json] of attempts) {
      const res = await bob.call(path, { method, json });
      expect([path, res.status]).toEqual([path, 404]);
      expect((await res.json()).error.code).toBe("not_found");
    }
    const sent = await send(bob.call, c.id, "intrude");
    expect(sent.status).toBe(404);
    const kept = await (await alice.call(`/v1/conversations/${c.id}`)).json();
    expect(kept.conversation.title).toBe("echo: alice only");
    expect(kept.messages).toHaveLength(2);
  });

  it("serves a public share without a session, marked noindex, until it is revoked", async () => {
    const c = await (await alice.call("/v1/conversations", { method: "POST", json: {} })).json();
    await send(alice.call, c.id, "share me");
    await api.runner.idle();
    const { share, url } = await (
      await alice.call(`/v1/conversations/${c.id}/shares`, { method: "POST", json: {} })
    ).json();
    const token = url.split("/share/")[1];
    const anonymous = client();
    const view = await anonymous(`/v1/public/shares/${token}`);
    expect(view.status).toBe(200);
    expect(view.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await view.json()).messages).toHaveLength(2);
    await alice.call(`/v1/shares/${share.id}`, { method: "DELETE" });
    expect((await anonymous(`/v1/public/shares/${token}`)).status).toBe(404);
  });
});
