import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { creditsToMicro } from "@djl/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "../auth/guard.ts";
import { LedgerService } from "../credits/LedgerService.ts";
import { seedOrg, testDatabase } from "../testing/db.ts";
import { createFakeProvider } from "./fakeProvider.ts";
import { GatewayService } from "./GatewayService.ts";
import { createMemoryRateLimiter } from "./RateLimiter.ts";

const conn = testDatabase();
const ledger = new LedgerService(conn.db);
const firstRequests: string[] = [];
const alerts: string[] = [];
const fake = createFakeProvider();
const gateway = new GatewayService({
  db: conn.db,
  ledger,
  limiter: createMemoryRateLimiter(),
  providers: {
    openai: fake,
    anthropic: { ...fake, id: "anthropic" },
    openrouter: { ...fake, id: "openrouter" },
  },
  trial: { onFirstCloudRequest: async (orgId) => (firstRequests.push(orgId), true) },
  config: {
    region: "test",
    catalogTtlMs: 0,
    refusalFlagThreshold: 2,
    instanceSoftCap: 150,
    instanceHardCap: 200,
  },
  onAlert: (a) => void alerts.push(a.title),
});

async function principalFor(label: string): Promise<Principal> {
  const { orgId, userId } = await seedOrg(conn.db, label);
  return {
    userId,
    email: `${label}@test.invalid`,
    emailVerified: true,
    banned: false,
    sessionId: "s",
    orgId,
    role: "owner",
    personalOrgId: orgId,
  };
}
const facts = (principal: Principal) => ({
  principal,
  traceId: "t",
  ipHash: "iphash",
  deviceId: null,
});

async function readSse(stream: ReadableStream<Uint8Array>) {
  const text = await new Response(stream).text();
  const events = text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1] ?? null;
      const data = block.match(/^data: (.+)$/m)?.[1] ?? "";
      return { event, data };
    });
  const content = events
    .filter((e) => !e.event && e.data !== "[DONE]")
    .map((e) => JSON.parse(e.data).choices?.[0]?.delta?.content ?? "")
    .join("");
  const trailer = events.find((e) => e.event === "djl.usage");
  const error = events.find((e) => e.event === "error");
  return {
    events,
    content,
    trailer: trailer ? JSON.parse(trailer.data) : null,
    error: error ? JSON.parse(error.data).error : null,
    done: events.at(-1)?.data === "[DONE]",
  };
}

beforeAll(async () => {
  await conn.db
    .insert(schema.plans)
    .values({
      id: "trial",
      name: "Trial",
      monthlyPriceUsdCents: 0,
      annualPriceUsdCents: 0,
      includedMicrocredits: creditsToMicro(200),
      concurrentStreams: 2,
      requestsPerMinute: 20,
      priorityWeight: 1,
      syncQuotaBytes: 1n,
    })
    .onConflictDoNothing();
  await conn.db
    .insert(schema.modelCatalog)
    .values([
      {
        modelId: "fake-chat",
        provider: "openai",
        upstreamModelId: "fake-chat",
        displayName: "Fake Chat",
        capabilities: ["text.chat", "tools", "vision", "json"],
        inputMicroPerToken: 1_000n,
        outputMicroPerToken: 10_000n,
        qualityScore: 80,
        sortOrder: 1,
        maxOutputTokens: 1000,
      },
      {
        modelId: "fake-cheap",
        provider: "openrouter",
        upstreamModelId: "fake-cheap",
        displayName: "Fake Cheap",
        capabilities: ["text.chat", "json"],
        inputMicroPerToken: 10n,
        outputMicroPerToken: 100n,
        qualityScore: 40,
        sortOrder: 2,
        maxOutputTokens: 1000,
      },
      {
        modelId: "fake-image",
        provider: "openai",
        upstreamModelId: "fake-image",
        displayName: "Fake Image",
        capabilities: ["image.generate"],
        microPerImage: creditsToMicro(5),
        qualityScore: 80,
        sortOrder: 3,
      },
      {
        modelId: "fake-embed",
        provider: "openai",
        upstreamModelId: "fake-embed",
        displayName: "Fake Embed",
        capabilities: ["embeddings"],
        inputMicroPerToken: 5n,
        qualityScore: 60,
        sortOrder: 4,
      },
    ])
    .onConflictDoNothing();
  await conn.db
    .insert(schema.killSwitches)
    .values({ name: "gateway", engaged: false })
    .onConflictDoUpdate({ target: schema.killSwitches.name, set: { engaged: false } });
});
afterAll(() => conn.close());

describe("GatewayService chat", () => {
  it("streams, settles the actual cost, records usage, and fires the trial hook", async () => {
    const p = await principalFor("gw-chat");
    await ledger.grant({
      orgId: p.orgId,
      bucket: "topup",
      type: "topup",
      amount: creditsToMicro(100),
      idempotencyKey: `g:${p.orgId}`,
      actor: "test",
    });
    const { stream, requestId } = await gateway.chatStream(facts(p), {
      model: "fake-chat",
      messages: [{ role: "user", content: "hello world" }],
      max_tokens: 100,
    });
    const out = await readSse(stream);
    expect(out.content).toBe("echo: hello world");
    expect(out.done).toBe(true);
    expect(out.trailer.requestId).toBe(requestId);
    expect(out.trailer.cutOff).toBe(false);
    // fake usage: input ceil(11/4)+4 = 7 tokens * 1000, output ceil(17/4) = 5 tokens * 10000 → 57,000 microcredits
    expect(out.trailer.settled).toBe("57000");
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(100) - 57_000n);
    const row = await conn.db.query.usageRequests.findFirst({
      where: eq(schema.usageRequests.id, requestId),
    });
    expect(row?.status).toBe("settled");
    expect(row?.routeReason).toBe("explicit");
    expect(firstRequests).toContain(p.orgId);
  });

  it("routes capability aliases with a reason code", async () => {
    const p = await principalFor("gw-alias");
    await ledger.grant({
      orgId: p.orgId,
      bucket: "topup",
      type: "topup",
      amount: creditsToMicro(100),
      idempotencyKey: `g:${p.orgId}`,
      actor: "test",
    });
    const { stream, requestId } = await gateway.chatStream(facts(p), {
      model: "text.fast",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 50,
    });
    await readSse(stream);
    const row = await conn.db.query.usageRequests.findFirst({
      where: eq(schema.usageRequests.id, requestId),
    });
    expect(row?.modelId).toBe("fake-cheap");
    expect(row?.routeReason).toBe("capability:text.fast");
  });

  it("refuses with 402 when the reservation cannot be covered and leaves the balance untouched", async () => {
    const p = await principalFor("gw-poor");
    await ledger.grant({
      orgId: p.orgId,
      bucket: "topup",
      type: "topup",
      amount: 1_000n,
      idempotencyKey: `g:${p.orgId}`,
      actor: "test",
    });
    await expect(
      gateway.chatStream(facts(p), {
        model: "fake-chat",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 100,
      }),
    ).rejects.toMatchObject({ status: 402, code: "insufficient_credits" });
    expect(await ledger.available(p.orgId)).toBe(1_000n);
  });

  it("cuts the stream at zero and settles what was consumed", async () => {
    const p = await principalFor("gw-cut");
    // Enough for the reservation of max_tokens=20 (5*1000 + 20*10000 = 205,000) but the fake produces far more output.
    await ledger.grant({
      orgId: p.orgId,
      bucket: "topup",
      type: "topup",
      amount: 300_000n,
      idempotencyKey: `g:${p.orgId}`,
      actor: "test",
    });
    const { stream } = await gateway.chatStream(facts(p), {
      model: "fake-chat",
      messages: [{ role: "user", content: "long:50" }],
      max_tokens: 20,
    });
    const out = await readSse(stream);
    expect(out.trailer.cutOff).toBe(true);
    expect(out.error?.code).toBe("insufficient_credits");
    expect(out.done).toBe(true);
    expect(await ledger.available(p.orgId)).toBeGreaterThanOrEqual(0n);
    expect(await ledger.available(p.orgId)).toBeLessThan(300_000n);
  });

  it("releases the reservation when the provider fails before any output", async () => {
    const p = await principalFor("gw-fail");
    await ledger.grant({
      orgId: p.orgId,
      bucket: "topup",
      type: "topup",
      amount: creditsToMicro(10),
      idempotencyKey: `g:${p.orgId}`,
      actor: "test",
    });
    const { stream } = await gateway.chatStream(facts(p), {
      model: "fake-chat",
      messages: [{ role: "user", content: "fail" }],
      max_tokens: 10,
    });
    const out = await readSse(stream);
    expect(out.error?.code).toBe("provider_unavailable");
    expect(out.done).toBe(true);
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(10));
  });

  it("passes tool calls through and settles them", async () => {
    const p = await principalFor("gw-tool");
    await ledger.grant({
      orgId: p.orgId,
      bucket: "topup",
      type: "topup",
      amount: creditsToMicro(10),
      idempotencyKey: `g:${p.orgId}`,
      actor: "test",
    });
    const { stream } = await gateway.chatStream(facts(p), {
      model: "fake-chat",
      messages: [{ role: "user", content: "tool" }],
      max_tokens: 10,
      tools: [{ type: "function", function: { name: "lookup" } }],
    });
    const out = await readSse(stream);
    const toolChunk = out.events
      .map((e) => (e.event || e.data === "[DONE]" ? null : JSON.parse(e.data)))
      .find((c) => c?.choices?.[0]?.delta?.tool_calls);
    expect(toolChunk.choices[0].delta.tool_calls[0].function.name).toBe("lookup");
    expect(out.trailer.settled).toBe("68000");
  });

  it("counts refusals and flags the account past the threshold", async () => {
    const p = await principalFor("gw-refuse");
    await ledger.grant({
      orgId: p.orgId,
      bucket: "topup",
      type: "topup",
      amount: creditsToMicro(10),
      idempotencyKey: `g:${p.orgId}`,
      actor: "test",
    });
    for (let i = 0; i < 2; i += 1) {
      const { stream } = await gateway.chatStream(facts(p), {
        model: "fake-chat",
        messages: [{ role: "user", content: "refuse" }],
        max_tokens: 10,
      });
      await readSse(stream);
    }
    await new Promise((r) => setTimeout(r, 50));
    const flags = await conn.db.query.abuseFlags.findMany({
      where: eq(schema.abuseFlags.userId, p.userId),
    });
    expect(flags.length).toBeGreaterThanOrEqual(1);
    expect(flags[0]?.kind).toBe("refusals");
  });

  it("refuses while the gateway kill switch is engaged", async () => {
    const p = await principalFor("gw-kill");
    await conn.db
      .update(schema.killSwitches)
      .set({ engaged: true })
      .where(eq(schema.killSwitches.name, "gateway"));
    await expect(
      gateway.chatStream(facts(p), {
        model: "fake-chat",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toMatchObject({ code: "gateway_paused" });
    await conn.db
      .update(schema.killSwitches)
      .set({ engaged: false })
      .where(eq(schema.killSwitches.name, "gateway"));
  });

  it("enforces the plan's concurrency limit while streams are open, and releases when the client disconnects", async () => {
    const p = await principalFor("gw-conc");
    await ledger.grant({
      orgId: p.orgId,
      bucket: "topup",
      type: "topup",
      amount: creditsToMicro(100),
      idempotencyKey: `g:${p.orgId}`,
      actor: "test",
    });
    // Streams stay open until the client reads them (pull-based), so two unread streams hold both slots.
    const a = await gateway.chatStream(facts(p), {
      model: "fake-chat",
      messages: [{ role: "user", content: "long:5" }],
      max_tokens: 100,
    });
    const b = await gateway.chatStream(facts(p), {
      model: "fake-chat",
      messages: [{ role: "user", content: "long:5" }],
      max_tokens: 100,
    });
    const ra = a.stream.getReader();
    const rb = b.stream.getReader();
    await ra.read();
    await rb.read();
    await expect(
      gateway.chatStream(facts(p), {
        model: "fake-chat",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 10,
      }),
    ).rejects.toMatchObject({ status: 429 });
    // Client disconnects mid-stream: the slot is released and usage so far is settled.
    await ra.cancel();
    await rb.cancel();
    await new Promise((r) => setTimeout(r, 30));
    const c = await gateway.chatStream(facts(p), {
      model: "fake-chat",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 10,
    });
    await readSse(c.stream);
    const rows = await conn.db.query.usageRequests.findMany({
      where: eq(schema.usageRequests.orgId, p.orgId),
    });
    expect(rows.filter((r) => r.status === "settled")).toHaveLength(3);
    const { before, after } = await ledger.refold(p.orgId);
    expect(before).toEqual(after);
  });

  it("rejects unknown models and models lacking a capability", async () => {
    const p = await principalFor("gw-unknown");
    await expect(
      gateway.chatStream(facts(p), { model: "nope", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      gateway.chatStream(facts(p), {
        model: "fake-image",
        messages: [{ role: "user", content: "hi" }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("GatewayService images and embeddings", () => {
  it("charges per image and per input token", async () => {
    const p = await principalFor("gw-img");
    await ledger.grant({
      orgId: p.orgId,
      bucket: "topup",
      type: "topup",
      amount: creditsToMicro(20),
      idempotencyKey: `g:${p.orgId}`,
      actor: "test",
    });
    const img = await gateway.generateImage(facts(p), {
      model: "fake-image",
      prompt: "a cat",
      n: 2,
    });
    expect(img.data).toHaveLength(2);
    expect(img.usage.settled).toBe(creditsToMicro(10).toString());
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(10));
    const emb = await gateway.embed(facts(p), { model: "fake-embed", input: ["hello world"] });
    expect(emb.data[0]?.embedding).toHaveLength(3);
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(10) - 15n);
    await expect(
      gateway.generateImage(facts(p), { model: "fake-image", prompt: "fail", n: 1 }),
    ).rejects.toMatchObject({ code: "provider_error" });
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(10) - 15n);
  });

  it("lists the catalog with display prices", async () => {
    const models = await gateway.listModels();
    const chat = models.find((m) => m.id === "fake-chat");
    expect(chat?.price.inputPer1k).toBe("1.00");
    expect(chat?.price.outputPer1k).toBe("10.00");
    expect(models.find((m) => m.id === "fake-image")?.price.perImage).toBe("5.00");
  });
});
