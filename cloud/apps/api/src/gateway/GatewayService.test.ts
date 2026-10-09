import { eq, inArray } from "drizzle-orm";
import { schema } from "@djl/db";
import { creditsToMicro } from "@djl/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Principal } from "../auth/guard.ts";
import { Settings } from "../config/settings.ts";
import { LedgerService } from "../credits/LedgerService.ts";
import { ApiError } from "../http/errors.ts";
import { seedOrg, testDatabase } from "../testing/db.ts";
import { createFakeProvider } from "./fakeProvider.ts";
import { GatewayService, type GatewayDeps } from "./GatewayService.ts";
import { createMemoryRateLimiter } from "./RateLimiter.ts";
import { planForOrg } from "../usage/plans.ts";
import { UsageService } from "../usage/UsageService.ts";
import { windowPolicy } from "../usage/windowPolicy.ts";

const conn = testDatabase();
const ledger = new LedgerService(conn.db);
const firstRequests: string[] = [];
const alerts: string[] = [];
const fake = createFakeProvider();
const makeGateway = (overrides: Partial<GatewayDeps> = {}) =>
  new GatewayService({
    db: conn.db,
    ledger,
    limiter: createMemoryRateLimiter(),
    settings: new Settings(conn.db, { ttlMs: 0 }),
    providers: {
      openai: fake,
      anthropic: { ...fake, id: "anthropic" },
      openrouter: { ...fake, id: "openrouter" },
    },
    trial: { onFirstCloudRequest: async (orgId) => (firstRequests.push(orgId), true) },
    config: { region: "test", catalogTtlMs: 0, refusalFlagThreshold: 2 },
    onAlert: (a) => void alerts.push(a.title),
    ...overrides,
  });
const gateway = makeGateway();

/** Temporarily override settings rows for one test. */
async function withSettings(values: Record<string, unknown>, run: () => Promise<void>) {
  const keys = Object.keys(values);
  const saved = await conn.db.query.settings.findMany({
    where: inArray(schema.settings.key, keys),
  });
  for (const [key, value] of Object.entries(values))
    await conn.db
      .insert(schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
  try {
    await run();
  } finally {
    await conn.db.delete(schema.settings).where(inArray(schema.settings.key, keys));
    if (saved.length) await conn.db.insert(schema.settings).values(saved);
  }
}

async function fund(p: Principal, amount = creditsToMicro(100)) {
  await ledger.grant({
    orgId: p.orgId,
    bucket: "topup",
    type: "topup",
    amount,
    idempotencyKey: `g:${p.orgId}`,
    actor: "test",
  });
}

/** A phone-verified trial account, so limits come from the trial plan. */
async function principalFor(label: string): Promise<Principal> {
  const { orgId, userId } = await seedOrg(conn.db, label);
  await conn.db.insert(schema.trialGrants).values({
    orgId,
    userId,
    phoneHash: `phone-${orgId}`,
    phoneLineType: "mobile",
    status: "granted",
    grantedAt: new Date(),
    expiresAt: new Date(Date.now() + 14 * 86_400_000),
  });
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
      window5hMicro: creditsToMicro(50),
      windowWeekMicro: creditsToMicro(200),
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
        capabilities: ["image.generate", "image.edit"],
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

describe("GatewayService admission", () => {
  it("runs abuse before the rate slot and window after it, releasing the slot on refusal", async () => {
    const p = await principalFor("gw-adm-order");
    await fund(p);
    const order: string[] = [];
    const limiter = createMemoryRateLimiter();
    const gw = makeGateway({
      limiter,
      admission: {
        abuse: { name: "abuse", admit: async () => void order.push("abuse") },
        window: {
          name: "window",
          admit: async ({ facts }) => {
            order.push(`window:${await limiter.inFlight(`org:${facts.principal.orgId}`)}`);
            throw new ApiError(429, "usage_window_exhausted", "Window used up.");
          },
        },
      },
    });
    await expect(
      gw.chatStream(facts(p), { model: "fake-chat", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ status: 429, code: "usage_window_exhausted" });
    expect(order).toEqual(["abuse", "window:1"]);
    expect(await limiter.inFlight(`org:${p.orgId}`)).toBe(0);
    expect(gw.status().inFlight).toBe(0);
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(100));
  });

  it("refuses in the abuse slot before taking any rate slot", async () => {
    const p = await principalFor("gw-adm-abuse");
    const limiter = createMemoryRateLimiter();
    const gw = makeGateway({
      limiter,
      admission: {
        abuse: {
          name: "abuse",
          admit: async () => {
            throw new ApiError(403, "suspended", "This account is suspended.");
          },
        },
      },
    });
    await expect(
      gw.chatStream(facts(p), { model: "fake-chat", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ status: 403, code: "suspended" });
    expect(await limiter.hit(`user:${p.userId}`, 1, 60)).toMatchObject({ allowed: true });
  });

  it("reads the per-IP limit from Settings", async () => {
    await withSettings({ "gateway.ip_requests_per_minute": 2 }, async () => {
      const gw = makeGateway();
      const ipHash = `ip-${crypto.randomUUID()}`;
      for (const label of ["gw-ip-a", "gw-ip-b"]) {
        const p = await principalFor(label);
        await fund(p);
        const { stream } = await gw.chatStream(
          { ...facts(p), ipHash },
          { model: "fake-chat", messages: [{ role: "user", content: "hi" }], max_tokens: 10 },
        );
        await readSse(stream);
      }
      const p = await principalFor("gw-ip-c");
      await fund(p);
      await expect(
        gw.chatStream(
          { ...facts(p), ipHash },
          { model: "fake-chat", messages: [{ role: "user", content: "hi" }] },
        ),
      ).rejects.toMatchObject({ status: 429, message: "Too many requests from this network." });
    });
  });

  it("sheds low-priority plans at the instance caps from Settings", async () => {
    await withSettings(
      { "gateway.soft_cap_streams": 1, "gateway.hard_cap_streams": 1 },
      async () => {
        const gw = makeGateway();
        const a = await principalFor("gw-cap-a");
        const b = await principalFor("gw-cap-b");
        await fund(a);
        await fund(b);
        const open = await gw.chatStream(facts(a), {
          model: "fake-chat",
          messages: [{ role: "user", content: "long:5" }],
          max_tokens: 100,
        });
        const reader = open.stream.getReader();
        await reader.read();
        await expect(
          gw.chatStream(facts(b), {
            model: "fake-chat",
            messages: [{ role: "user", content: "hi" }],
          }),
        ).rejects.toMatchObject({ status: 503, code: "overloaded" });
        await reader.cancel();
      },
    );
  });
});

async function collect(
  chunks: AsyncIterable<{ readonly choices: readonly { readonly delta: { content?: string } }[] }>,
) {
  let text = "";
  for await (const c of chunks) text += c.choices[0]?.delta.content ?? "";
  return text;
}

describe("GatewayService completeStep", () => {
  it("streams chunks in process and settles with the usage trailer", async () => {
    const p = await principalFor("gw-step");
    await fund(p);
    const step = await gateway.completeStep(facts(p), {
      model: "fake-chat",
      messages: [{ role: "user", content: "hello world" }],
      max_tokens: 100,
    });
    expect(await collect(step.chunks)).toBe("echo: hello world");
    const result = await step.result;
    expect(result.error).toBeNull();
    expect(result.usage).toMatchObject({
      requestId: step.requestId,
      settled: "57000",
      cutOff: false,
    });
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(100) - 57_000n);
  });

  it("cuts the stream at the step's budget cap", async () => {
    const p = await principalFor("gw-step-cap");
    await fund(p);
    const step = await gateway.completeStep(
      facts(p),
      { model: "fake-chat", messages: [{ role: "user", content: "long:50" }], max_tokens: 1000 },
      { budgetCap: 100_000n },
    );
    await collect(step.chunks);
    const result = await step.result;
    expect(result.usage?.cutOff).toBe(true);
    expect(result.error?.code).toBe("budget_exhausted");
    expect(await ledger.available(p.orgId)).toBe(
      creditsToMicro(100) - BigInt(result.usage!.settled),
    );
  });

  it("stops the provider and settles what was used when the caller aborts", async () => {
    const p = await principalFor("gw-step-abort");
    await fund(p);
    const controller = new AbortController();
    const step = await gateway.completeStep(
      facts(p),
      { model: "fake-chat", messages: [{ role: "user", content: "long:50" }], max_tokens: 1000 },
      { signal: controller.signal },
    );
    let chunks = 0;
    for await (const _chunk of step.chunks) {
      chunks += 1;
      if (chunks === 3) controller.abort();
    }
    expect(chunks).toBeLessThan(10);
    const result = await step.result;
    expect(result.error).toBeNull();
    expect(result.usage?.cutOff).toBe(false);
    expect(gateway.status().inFlight).toBe(0);
    const { before, after } = await ledger.refold(p.orgId);
    expect(before).toEqual(after);
  });

  it("settles when the caller stops reading early", async () => {
    const p = await principalFor("gw-step-break");
    await fund(p);
    const step = await gateway.completeStep(facts(p), {
      model: "fake-chat",
      messages: [{ role: "user", content: "long:50" }],
      max_tokens: 1000,
    });
    for await (const _chunk of step.chunks) break;
    const result = await step.result;
    expect(BigInt(result.usage!.settled)).toBeGreaterThan(0n);
    expect(await ledger.available(p.orgId)).toBe(
      creditsToMicro(100) - BigInt(result.usage!.settled),
    );
    expect(gateway.status().inFlight).toBe(0);
  });
});

describe("GatewayService image edits", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it("reserves, charges per image on success, and refunds a provider failure", async () => {
    const p = await principalFor("gw-edit");
    await fund(p, creditsToMicro(20));
    const edited = await gateway.editImage(facts(p), {
      model: "fake-image",
      prompt: "make it blue",
      image: { bytes: png, mimeType: "image/png" },
    });
    expect(edited.data).toHaveLength(1);
    expect(edited.usage.settled).toBe(creditsToMicro(5).toString());
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(15));
    const [row] = await conn.db
      .select()
      .from(schema.usageRequests)
      .where(eq(schema.usageRequests.id, edited.usage.requestId));
    expect(row).toMatchObject({ endpoint: "images.edits", status: "settled", images: 1 });

    await expect(
      gateway.editImage(facts(p), {
        model: "fake-image",
        prompt: "fail",
        image: { bytes: png, mimeType: "image/png" },
      }),
    ).rejects.toMatchObject({ code: "provider_error" });
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(15));
  });

  it("refuses bytes that are not the declared image type, and models that cannot edit", async () => {
    const p = await principalFor("gw-edit-bad");
    await fund(p, creditsToMicro(20));
    await expect(
      gateway.editImage(facts(p), {
        model: "fake-image",
        prompt: "x",
        image: { bytes: new TextEncoder().encode("<svg/>"), mimeType: "image/png" },
      }),
    ).rejects.toMatchObject({ status: 400, code: "bad_request" });
    await expect(
      gateway.editImage(facts(p), {
        model: "fake-chat",
        prompt: "x",
        image: { bytes: png, mimeType: "image/png" },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(20));
  });

  it("aborts the provider call and releases the reservation when the signal fires", async () => {
    const p = await principalFor("gw-edit-abort");
    await fund(p, creditsToMicro(20));
    const controller = new AbortController();
    const pending = gateway.editImage(
      facts(p),
      { model: "fake-image", prompt: "hang", image: { bytes: png, mimeType: "image/png" } },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ code: "provider_error" });
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(20));
    expect(gateway.status().inFlight).toBe(0);
  });

  it("releases the reservation when the signal was aborted before the provider was called", async () => {
    const p = await principalFor("gw-edit-preabort");
    await fund(p, creditsToMicro(20));
    const controller = new AbortController();
    controller.abort();
    await expect(
      gateway.editImage(
        facts(p),
        { model: "fake-image", prompt: "hang", image: { bytes: png, mimeType: "image/png" } },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "provider_error" });
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(20));
    expect(gateway.status().inFlight).toBe(0);
  });
});

describe("GatewayService image aborts", () => {
  it("aborts the provider call and releases the reservation when the signal fires", async () => {
    const p = await principalFor("gw-img-abort");
    await fund(p, creditsToMicro(20));
    let aborted = false;
    const gw = makeGateway({
      providers: {
        openai: {
          ...fake,
          // Like fetch: rejects on abort, including a signal aborted before the call.
          generateImage: (_req, signal) =>
            new Promise((_resolve, reject) => {
              const abort = () => {
                aborted = true;
                reject(new Error("aborted"));
              };
              if (signal.aborted) abort();
              else signal.addEventListener("abort", abort);
            }),
        },
      },
    });
    const controller = new AbortController();
    const pending = gw.generateImage(
      facts(p),
      { model: "fake-image", prompt: "a cat" },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ code: "provider_error" });
    expect(aborted).toBe(true);
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(20));
    expect(gw.status().inFlight).toBe(0);
  });
});

/** Spend all but `room` of the 5-hour window, as if earlier requests had settled. */
async function fillWindow(p: Principal, room: bigint) {
  const { windowCaps } = await planForOrg(conn.db, p.orgId, new Date());
  await conn.db
    .insert(schema.usageWindows)
    .values({ userId: p.userId, weekAnchorAt: new Date(Date.now() - 3_600_000) });
  await conn.db.insert(schema.usageBuckets).values({
    userId: p.userId,
    bucketStart: new Date(Date.now() - 20 * 60_000),
    spentMicro: windowCaps.fiveHour - room,
  });
}

describe("GatewayService usage windows", () => {
  const chat = { model: "fake-chat", messages: [{ role: "user" as const, content: "hi" }] };

  it("refuses a full window with 429, which window, and when it frees up", async () => {
    const withPolicy = makeGateway({
      admission: { window: windowPolicy(new UsageService(conn.db)) },
    });
    for (const gw of [gateway, withPolicy]) {
      const p = await principalFor("gw-window-full");
      await fund(p);
      await fillWindow(p, 0n);
      const refusal = await gw.completeStep(facts(p), chat).catch((e: unknown) => e);
      expect(refusal).toBeInstanceOf(ApiError);
      expect(refusal).toMatchObject({
        status: 429,
        code: "usage_window_exhausted",
        details: { window: "five_hour", resetsAt: expect.any(String) },
      });
      expect(await ledger.available(p.orgId)).toBe(creditsToMicro(100));
    }
  });

  it("cuts a stream when the window fills mid-response, with its own code", async () => {
    const p = await principalFor("gw-window-cut");
    await fund(p);
    await fillWindow(p, 100_000n);
    const step = await gateway.completeStep(facts(p), {
      model: "fake-chat",
      messages: [{ role: "user", content: "long:50" }],
      max_tokens: 1000,
    });
    await collect(step.chunks);
    const result = await step.result;
    expect(result.usage?.cutOff).toBe(true);
    expect(result.error?.code).toBe("usage_window_cut");
    // The window is now exactly full; credits paid the full actual cost.
    await expect(gateway.completeStep(facts(p), chat)).rejects.toMatchObject({
      code: "usage_window_exhausted",
    });
    expect(await ledger.available(p.orgId)).toBe(
      creditsToMicro(100) - BigInt(result.usage!.settled),
    );
  });
});
