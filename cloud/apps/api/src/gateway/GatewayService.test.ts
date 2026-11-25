import { eq, inArray } from "drizzle-orm";
import { schema } from "@djl/db";
import { creditsToMicro } from "@djl/domain";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
  it("lists only models whose provider is configured", async () => {
    const configured = makeGateway({ providers: { openrouter: { ...fake, id: "openrouter" } } });
    const models = await configured.listModels();
    expect(models.map((model) => model.id)).toContain("fake-cheap");
    expect(models.every((model) => model.provider === "openrouter")).toBe(true);
  });

  it("streams and settles a zero-cost model without charging credits", async () => {
    const modelId = `free-${crypto.randomUUID()}`;
    await conn.db.insert(schema.modelCatalog).values({
      modelId,
      provider: "openrouter",
      upstreamModelId: "free-upstream",
      displayName: "Free model",
      capabilities: ["text.chat"],
      maxOutputTokens: 1000,
      freeEligible: true,
    });
    try {
      const p = await principalFor("gw-zero-cost");
      const { stream, requestId } = await gateway.chatStream(facts(p), {
        model: modelId,
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 100,
      });
      const out = await readSse(stream);
      expect(out.content).toBe("echo: hello");
      expect(out.done).toBe(true);
      expect(out.error).toBeNull();
      expect(out.trailer.settled).toBe("0");
      expect(await ledger.available(p.orgId)).toBe(0n);
      const row = await conn.db.query.usageRequests.findFirst({
        where: eq(schema.usageRequests.id, requestId),
      });
      expect(row?.status).toBe("settled");
    } finally {
      await conn.db.delete(schema.modelCatalog).where(eq(schema.modelCatalog.modelId, modelId));
    }
  });

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
    const candidates = (await gateway.catalog()).filter((model) =>
      ["fake-chat", "fake-cheap"].includes(model.modelId),
    );
    // Keep seeded production models out of this two-model routing fixture.
    const catalog = vi.spyOn(gateway, "catalog").mockResolvedValue(candidates);
    try {
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
    } finally {
      catalog.mockRestore();
    }
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

  it("aborts a provider waiting for its next chunk before completing stream cancellation", async () => {
    const p = await principalFor("gw-pending-cancel");
    await fund(p);
    const limiter = createMemoryRateLimiter();
    let releaseStall!: () => void;
    const stalled = new Promise<void>((resolve) => {
      releaseStall = resolve;
    });
    let providerWaiting = false;
    let providerSignal: AbortSignal | undefined;
    let cleanupStarted = false;
    let abortsBeforeCleanup = 0;
    const provider: typeof fake = {
      ...fake,
      async *chatStream(_request, signal) {
        providerSignal = signal;
        yield {
          id: "pending-cancel-fixture",
          delta: { content: "first" },
          finish_reason: null,
        };
        const onAbort = () => {
          if (!cleanupStarted) abortsBeforeCleanup++;
          releaseStall();
        };
        signal.addEventListener("abort", onAbort, { once: true });
        providerWaiting = true;
        if (signal.aborted) onAbort();
        try {
          await stalled;
        } finally {
          signal.removeEventListener("abort", onAbort);
        }
      },
    };
    const gw = makeGateway({ limiter, providers: { openai: provider } });
    const settle = vi.spyOn(ledger, "settle");
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let pendingRead: ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]> | undefined;
    let cancelling: Promise<void> | undefined;
    let passed = false;
    try {
      const { stream, requestId } = await gw.chatStream(facts(p), {
        model: "fake-chat",
        messages: [{ role: "user", content: "pending cancel" }],
        max_tokens: 100,
      });
      reader = stream.getReader();
      const first = await reader.read();
      expect(first.done).toBe(false);
      expect(new TextDecoder().decode(first.value)).toContain('"content":"first"');
      pendingRead = reader.read();
      await expect.poll(() => providerWaiting, { timeout: 1000 }).toBe(true);
      expect(providerSignal?.aborted).toBe(false);
      expect(await limiter.inFlight(`org:${p.orgId}`)).toBe(1);
      expect(gw.status().inFlight).toBe(1);
      expect(await ledger.available(p.orgId)).toBeLessThan(creditsToMicro(100));
      expect(
        await conn.db.query.usageHolds.findFirst({ where: eq(schema.usageHolds.id, requestId) }),
      ).toBeDefined();

      let cancelSettled = false;
      cancelling = reader.cancel();
      void cancelling.then(
        () => {
          cancelSettled = true;
        },
        () => {
          cancelSettled = true;
        },
      );
      // The provider is already stalled; these must pass before failure cleanup can release it.
      await expect.poll(() => abortsBeforeCleanup, { timeout: 1000 }).toBe(1);
      expect(providerSignal?.aborted).toBe(true);
      await expect.poll(() => cancelSettled, { timeout: 1000 }).toBe(true);
      await cancelling;
      await expect(pendingRead).resolves.toMatchObject({ done: true });
      expect(cleanupStarted).toBe(false);
      expect(settle).toHaveBeenCalledTimes(1);
      expect(await limiter.inFlight(`org:${p.orgId}`)).toBe(0);
      expect(gw.status().inFlight).toBe(0);
      expect(
        await conn.db.query.usageHolds.findFirst({ where: eq(schema.usageHolds.id, requestId) }),
      ).toBeUndefined();
      const row = await conn.db.query.usageRequests.findFirst({
        where: eq(schema.usageRequests.id, requestId),
      });
      expect(row?.status).toBe("settled");
      expect(row?.settledMicro).toBeGreaterThan(0n);
      expect(await ledger.available(p.orgId)).toBe(creditsToMicro(100) - row!.settledMicro!);
      const entries = await conn.db.query.creditLedger.findMany({
        where: eq(schema.creditLedger.reservationId, requestId),
      });
      expect(entries.filter((entry) => entry.type === "settlement")).toHaveLength(1);
      expect(
        entries
          .filter((entry) => entry.type === "reservation" || entry.type === "release")
          .reduce((total, entry) => total + entry.amount, 0n),
      ).toBe(0n);
      const { before, after } = await ledger.refold(p.orgId);
      expect(before).toEqual(after);
      passed = true;
    } finally {
      if (!passed) {
        // Only failure cleanup may manually free this test's synthetic provider wait.
        cleanupStarted = true;
        releaseStall();
        cancelling ??= reader?.cancel();
      }
      await Promise.allSettled([pendingRead, cancelling]);
      settle.mockRestore();
    }
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

  it("forwards only priced fields to the provider, dropping client routing overrides", async () => {
    const p = await principalFor("gw-step-allowlist");
    await fund(p);
    const sent: unknown[] = [];
    const recording = {
      ...fake,
      chatStream: (req: Parameters<typeof fake.chatStream>[0], signal: AbortSignal) => {
        sent.push(req);
        return fake.chatStream(req, signal);
      },
    };
    const gw = makeGateway({
      providers: {
        openai: recording,
        anthropic: { ...recording, id: "anthropic" },
        openrouter: { ...recording, id: "openrouter" },
      },
    });
    const step = await gw.completeStep(facts(p), {
      model: "fake-cheap",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
      models: ["anthropic/claude-opus-4.5"],
      plugins: [{ id: "web", max_results: 10 }],
      provider: { order: ["anthropic"] },
      n: 128,
      service_tier: "priority",
    } as never);
    await collect(step.chunks);
    await step.result;
    expect(sent).toEqual([
      {
        model: "fake-cheap",
        messages: [{ role: "user", content: "hi" }],
        temperature: 0.2,
        max_tokens: 1000,
        user: p.orgId.slice(0, 16),
      },
    ]);
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

type FakeChunk = ReturnType<typeof fake.chatStream> extends AsyncIterable<infer C> ? C : never;
const text = (content: string): FakeChunk => ({ id: "s", delta: { content }, finish_reason: null });
const role: FakeChunk = { id: "s", delta: { role: "assistant" }, finish_reason: null };
const stop: FakeChunk = { id: "s", delta: {}, finish_reason: "stop" };
const usageChunk = (input_tokens: number, output_tokens: number): FakeChunk => ({
  id: "s",
  delta: {},
  finish_reason: null,
  usage: { input_tokens, output_tokens, cached_input_tokens: 0 },
});

/** A provider that plays chunks back; "stall" hangs there until the gateway aborts the call. */
function scriptedProvider(
  script: readonly (FakeChunk | "stall")[],
  seen: { aborted?: boolean } = {},
): typeof fake {
  return {
    ...fake,
    async *chatStream(_request, signal) {
      for (const step of script) {
        if (step !== "stall") {
          yield step;
          continue;
        }
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        seen.aborted = true;
        return;
      }
    },
  };
}
const makeGatewayWith = (provider: typeof fake, overrides: Partial<GatewayDeps> = {}) =>
  makeGateway({ providers: { openai: provider }, ...overrides });
const scripted = (script: readonly (FakeChunk | "stall")[], seen?: { aborted?: boolean }) =>
  makeGatewayWith(scriptedProvider(script, seen));

const requestRow = (id: string) =>
  conn.db.query.usageRequests.findFirst({ where: eq(schema.usageRequests.id, id) });
const windowSpend = async (userId: string) =>
  (
    await conn.db.query.usageBuckets.findMany({ where: eq(schema.usageBuckets.userId, userId) })
  ).reduce((sum, bucket) => sum + bucket.spentMicro, 0n);

const bigTool = (chars: number) => [
  { type: "function" as const, function: { name: "lookup", description: "x".repeat(chars) } },
];

describe("GatewayService billing integrity", () => {
  const hi = [{ role: "user" as const, content: "hi" }];

  it("reserves for tools as well as messages", async () => {
    const p = await principalFor("gw-int-estimate");
    await fund(p, creditsToMicro(1000));
    const reservedFor = async (extra: object) => {
      const step = await gateway.completeStep(facts(p), {
        model: "fake-chat",
        messages: hi,
        max_tokens: 10,
        ...extra,
      });
      await collect(step.chunks);
      await step.result;
      return (await requestRow(step.requestId))!.reservedMicro;
    };
    const plain = await reservedFor({});
    // 60,000 characters of tool definition are at least 20,000 tokens at 1,000 microcredits each.
    expect((await reservedFor({ tools: bigTool(60_000) })) - plain).toBeGreaterThanOrEqual(
      20_000_000n,
    );
  });

  it("refuses a request no context window of that model could hold, before reserving", async () => {
    const modelId = `ctx-${crypto.randomUUID()}`;
    await conn.db.insert(schema.modelCatalog).values({
      modelId,
      provider: "openrouter",
      upstreamModelId: "ctx-upstream",
      displayName: "Small context",
      capabilities: ["text.chat"],
      inputMicroPerToken: 10n,
      outputMicroPerToken: 100n,
      contextWindow: 1000,
      maxOutputTokens: 100,
    });
    try {
      const p = await principalFor("gw-int-context");
      await fund(p);
      await expect(
        gateway.completeStep(facts(p), {
          model: modelId,
          messages: [{ role: "user", content: "x".repeat(9000) }],
        }),
      ).rejects.toMatchObject({ status: 413, code: "payload_too_large" });
      expect(await ledger.available(p.orgId)).toBe(creditsToMicro(100));
      expect(gateway.status().inFlight).toBe(0);
      // A request that fits is served as usual.
      const step = await gateway.completeStep(facts(p), { model: modelId, messages: hi });
      await collect(step.chunks);
      expect((await step.result).error).toBeNull();
    } finally {
      await conn.db.delete(schema.modelCatalog).where(eq(schema.modelCatalog.modelId, modelId));
    }
  });

  it("charges an abort before the provider's usage for everything sent and streamed", async () => {
    const p = await principalFor("gw-int-abort");
    await fund(p, creditsToMicro(1000));
    const seen: { aborted?: boolean } = {};
    const gw = scripted(
      [role, ...Array.from({ length: 10 }, () => text("x".repeat(30))), "stall"],
      seen,
    );
    const controller = new AbortController();
    const step = await gw.completeStep(
      facts(p),
      { model: "fake-chat", messages: hi, max_tokens: 200, tools: bigTool(30_000) },
      { signal: controller.signal },
    );
    let chunks = 0;
    for await (const _chunk of step.chunks) if (++chunks === 11) controller.abort();
    const { usage, error } = await step.result;
    expect(error).toBeNull();
    expect(seen.aborted).toBe(true);
    // Input covers the 30,000 characters of tools; output is the 300 streamed characters at 3 per token.
    expect(usage!.inputTokens).toBeGreaterThanOrEqual(10_000);
    expect(usage!.outputTokens).toBe(100);
    expect(BigInt(usage!.settled)).toBe(BigInt(usage!.inputTokens) * 1_000n + 100n * 10_000n);
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(1000) - BigInt(usage!.settled));
  });

  it.each(["break", "abort"] as const)(
    "takes the provider's usage when the caller leaves right after the finish chunk (%s)",
    async (how) => {
      const p = await principalFor(`gw-int-usage-${how}`);
      await fund(p);
      const provider: typeof fake = {
        ...fake,
        async *chatStream() {
          yield role;
          yield text("hello");
          yield stop;
          await new Promise((resolve) => setTimeout(resolve, 30));
          yield usageChunk(500, 300);
        },
      };
      const controller = new AbortController();
      const step = await makeGatewayWith(provider).completeStep(
        facts(p),
        { model: "fake-chat", messages: hi, max_tokens: 400 },
        { signal: controller.signal },
      );
      for await (const chunk of step.chunks) {
        if (!chunk.choices[0].finish_reason) continue;
        if (how === "break") break;
        controller.abort();
      }
      const { usage } = await step.result;
      // 500 input and 300 output tokens as metered, not the estimate of "hi" and "hello".
      expect(usage).toMatchObject({ inputTokens: 500, outputTokens: 300, settled: "3500000" });
      expect(await ledger.available(p.orgId)).toBe(creditsToMicro(100) - 3_500_000n);
    },
  );

  it("stops waiting for the usage after a short grace and charges the estimate", async () => {
    const p = await principalFor("gw-int-grace");
    await fund(p);
    const seen: { aborted?: boolean } = {};
    const step = await scripted([role, text("x".repeat(30)), stop, "stall"], seen).completeStep(
      facts(p),
      { model: "fake-chat", messages: hi, max_tokens: 100 },
    );
    const startedAt = Date.now();
    for await (const chunk of step.chunks) if (chunk.choices[0].finish_reason) break;
    const { usage } = await step.result;
    expect(Date.now() - startedAt).toBeLessThan(4_000);
    expect(seen.aborted).toBe(true);
    expect(usage!.outputTokens).toBe(10);
    expect(BigInt(usage!.settled)).toBeGreaterThan(100_000n);
  }, 10_000);

  it("records what the balance cannot cover as debt, alerts, and admits no paid request until it is cleared", async () => {
    const p = await principalFor("gw-int-debt");
    await fund(p, creditsToMicro(1));
    // The provider meters 5,000 input tokens (5 credits) against a 1-credit balance, mid-stream.
    const metered: FakeChunk = { ...text("b"), usage: usageChunk(5000, 10).usage! };
    const gw = scripted([role, text("a"), metered, text("c"), text("d"), stop]);
    alerts.length = 0;
    const step = await gw.completeStep(facts(p), {
      model: "fake-chat",
      messages: hi,
      max_tokens: 10,
    });
    // The running check uses the metered input, so the stream stops there.
    expect(await collect(step.chunks)).toBe("a");
    const { usage, error } = await step.result;
    expect(error?.code).toBe("insufficient_credits");
    expect(usage).toMatchObject({ cutOff: true, settled: "5100000", remaining: "0" });
    // The whole metered cost is on the ledger: the folded balance is negative by the shortfall.
    const balances = await ledger.balances(p.orgId);
    expect(balances.topup).toBe(creditsToMicro(1) - 5_100_000n);
    const entries = await conn.db.query.creditLedger.findMany({
      where: eq(schema.creditLedger.reservationId, step.requestId),
    });
    expect(
      entries.filter((e) => e.type === "settlement").reduce((sum, e) => sum - e.amount, 0n),
    ).toBe(5_100_000n);
    expect(alerts).toContain("Usage exceeded the balance");
    // The usage windows record the actual cost, not the smaller amount held at the start.
    expect(await windowSpend(p.userId)).toBe(5_100_000n);
    const { before, after } = await ledger.refold(p.orgId);
    expect(before).toEqual(after);

    await expect(
      gateway.completeStep(facts(p), { model: "fake-chat", messages: hi, max_tokens: 10 }),
    ).rejects.toMatchObject({ status: 402, code: "insufficient_credits" });
    // A top-up pays the debt first: 10 credits against 4.1 owed leaves 5.9.
    await ledger.grant({
      orgId: p.orgId,
      bucket: "topup",
      type: "topup",
      amount: creditsToMicro(10),
      idempotencyKey: `g2:${p.orgId}`,
      actor: "test",
    });
    expect(await ledger.available(p.orgId)).toBe(5_900_000n);
    const paid = await gateway.completeStep(facts(p), {
      model: "fake-chat",
      messages: hi,
      max_tokens: 10,
    });
    await collect(paid.chunks);
    expect((await paid.result).error).toBeNull();
  });

  it("a stream cut at zero is charged to zero, never into debt", async () => {
    const p = await principalFor("gw-int-cut-zero");
    await fund(p, 300_000n);
    alerts.length = 0;
    const step = await gateway.completeStep(facts(p), {
      model: "fake-chat",
      messages: [{ role: "user", content: "long:50" }],
      max_tokens: 20,
    });
    await collect(step.chunks);
    const { usage } = await step.result;
    expect(usage).toMatchObject({ cutOff: true, settled: "300000", remaining: "0" });
    expect(await ledger.balances(p.orgId)).toMatchObject({ topup: 0n });
    expect(alerts).not.toContain("Usage exceeded the balance");
  });

  it("still debits a stream whose reservation the stale job released while it was running, once", async () => {
    const p = await principalFor("gw-int-late");
    await fund(p);
    const step = await gateway.completeStep(facts(p), {
      model: "fake-chat",
      messages: [{ role: "user", content: "long:5" }],
      max_tokens: 100,
    });
    const chunks = step.chunks[Symbol.asyncIterator]();
    await chunks.next();
    // What the stale reservation job does to a reservation it takes for abandoned.
    await ledger.release({
      orgId: p.orgId,
      reservationId: step.requestId,
      idempotencyKey: `stale:${step.requestId}`,
      actor: "system:worker",
    });
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(100));
    while (!(await chunks.next()).done);
    const { usage } = await step.result;
    // fake usage: 5 input tokens and 50 output tokens
    expect(usage?.settled).toBe("505000");
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(100) - 505_000n);
    expect(await windowSpend(p.userId)).toBe(505_000n);
    const replay = await ledger.settle({
      orgId: p.orgId,
      reservationId: step.requestId,
      actual: 505_000n,
      idempotencyKey: `req:${step.requestId}`,
      actor: "system:gateway",
      userId: p.userId,
    });
    expect(replay.balances.topup).toBe(creditsToMicro(100) - 505_000n);
    expect(await windowSpend(p.userId)).toBe(505_000n);
    const { before, after } = await ledger.refold(p.orgId);
    expect(before).toEqual(after);
  });

  it("keeps a running stream's reservation alive and stops when the stream settles", async () => {
    const p = await principalFor("gw-int-beat");
    await fund(p);
    const heartbeat = vi.spyOn(ledger, "heartbeat");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const step = await gateway.completeStep(facts(p), {
        model: "fake-chat",
        messages: [{ role: "user", content: "long:5" }],
        max_tokens: 100,
      });
      const chunks = step.chunks[Symbol.asyncIterator]();
      await chunks.next();
      vi.advanceTimersByTime(3 * 60_000);
      expect(heartbeat.mock.calls).toEqual([[step.requestId], [step.requestId], [step.requestId]]);
      while (!(await chunks.next()).done);
      await step.result;
      vi.advanceTimersByTime(3 * 60_000);
      expect(heartbeat).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
      heartbeat.mockRestore();
    }
  });

  it.each(["reading", "stalled"] as const)(
    "cuts and settles a stream at the maximum stream length (caller %s)",
    async (caller) => {
      const p = await principalFor(`gw-int-max-${caller}`);
      await fund(p);
      const seen: { aborted?: boolean } = {};
      const gw = makeGatewayWith(scriptedProvider([role, text("x".repeat(30)), "stall"], seen), {
        config: { region: "test", catalogTtlMs: 0, refusalFlagThreshold: 2, maxStreamMs: 100 },
      });
      const step = await gw.completeStep(facts(p), {
        model: "fake-chat",
        messages: hi,
        max_tokens: 100,
      });
      const chunks = step.chunks[Symbol.asyncIterator]();
      await chunks.next();
      await chunks.next();
      // A caller that keeps reading is ended; one that has stopped reading is settled all the same.
      if (caller === "reading") {
        expect((await chunks.next()).done).toBe(true);
        expect(seen.aborted).toBe(true);
      }
      const { usage, error } = await step.result;
      expect(error?.code).toBe("stream_timeout");
      expect(usage?.cutOff).toBe(true);
      expect(usage?.outputTokens).toBe(10);
      expect(gw.status().inFlight).toBe(0);
      expect((await requestRow(step.requestId))?.status).toBe("cut_off");
      expect(await ledger.available(p.orgId)).toBe(creditsToMicro(100) - BigInt(usage!.settled));
      await chunks.return?.(undefined);
    },
  );

  it("holds the concurrency slot for as long as a stream may run", async () => {
    const p = await principalFor("gw-int-slot");
    await fund(p);
    const memory = createMemoryRateLimiter();
    const ttls: number[] = [];
    const limiter = {
      ...memory,
      acquire: (key: string, limit: number, ttlSeconds: number) => {
        ttls.push(ttlSeconds);
        return memory.acquire(key, limit, ttlSeconds);
      },
    };
    for (const maxStreamMs of [undefined, 45 * 60_000]) {
      const gw = makeGateway({
        limiter,
        config: {
          region: "test",
          catalogTtlMs: 0,
          refusalFlagThreshold: 2,
          ...(maxStreamMs ? { maxStreamMs } : {}),
        },
      });
      const step = await gw.completeStep(facts(p), { model: "fake-chat", messages: hi });
      await collect(step.chunks);
      await step.result;
    }
    // The default 30 minutes and the configured 45, each plus a minute's grace.
    expect(ttls).toEqual([31 * 60, 46 * 60]);
  });

  it("generates only the image variants the flat price covers", async () => {
    const p = await principalFor("gw-int-image");
    await fund(p, creditsToMicro(100));
    const sent: unknown[] = [];
    const gw = makeGateway({
      providers: {
        openai: {
          ...fake,
          generateImage: (req, signal) => (sent.push(req), fake.generateImage(req, signal)),
          editImage: (req, signal) => (sent.push(req), fake.editImage(req, signal)),
        },
      },
    });
    const image = { model: "fake-image", prompt: "a cat" };
    for (const variant of [
      { size: "4096x4096" },
      { size: "auto" },
      { quality: "high" },
      { quality: "hd" },
      { quality: "auto" },
      { size: 1024 },
    ])
      await expect(
        gw.generateImage(facts(p), { ...image, ...variant } as never),
      ).rejects.toMatchObject({
        status: 400,
        code: "bad_request",
      });
    expect(sent).toEqual([]);
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(100));

    // The variant is always sent explicitly, so the provider never picks a dearer default.
    await gw.generateImage(facts(p), image);
    await gw.generateImage(facts(p), { ...image, size: "1536x1024", quality: "low" });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await gw.editImage(facts(p), { ...image, image: { bytes: png, mimeType: "image/png" } });
    expect(sent).toMatchObject([
      { size: "1024x1024", quality: "medium", n: 1 },
      { size: "1536x1024", quality: "low", n: 1 },
      { size: "1024x1024", quality: "medium", n: 1 },
    ]);
    // The count is a whole number from 1 to 4, whatever the client sends.
    const many = await gw.generateImage(facts(p), { ...image, n: 100 });
    expect(many.data).toHaveLength(4);
    for (const n of [2.5, Number.NaN]) {
      const one = await gw.generateImage(facts(p), { ...image, n });
      expect(one.data).toHaveLength(1);
    }
    expect(await ledger.available(p.orgId)).toBe(creditsToMicro(100 - 5 * 9));
  });
});
