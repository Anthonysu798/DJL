import { eq } from "drizzle-orm";
import { schema } from "@djl/db";
import { creditsToMicro } from "@djl/domain";
import { responseChunk, ProviderError, type ProviderAdapter } from "@djl/providers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabase, seedOrg } from "../testing/db.ts";
import { LedgerService } from "../credits/LedgerService.ts";
import { Settings } from "../config/settings.ts";
import { planForOrg } from "../usage/plans.ts";
import { createMemoryRateLimiter } from "./RateLimiter.ts";
import { createFakeProvider } from "./fakeProvider.ts";
import { GatewayService, type RequestFacts, type StepOptions } from "./GatewayService.ts";

const conn = testDatabase();
const ledger = new LedgerService(conn.db);
const modelId = "responses-fixture";
let script: NonNullable<ProviderAdapter["responsesStream"]> = async function* () {
  yield responseChunk({
    type: "response.output_text.delta",
    delta: "hello",
    item_id: "i",
    output_index: 0,
    content_index: 0,
  });
  yield responseChunk({
    type: "response.completed",
    response: {
      id: "upstream",
      usage: { input_tokens: 50, output_tokens: 20, input_tokens_details: { cached_tokens: 10 } },
    },
  });
};
const gateway = new GatewayService({
  db: conn.db,
  ledger,
  settings: new Settings(conn.db, { ttlMs: 0 }),
  limiter: createMemoryRateLimiter(),
  providers: {
    openrouter: {
      ...createFakeProvider(),
      id: "openrouter",
      responsesStream: (body, signal) => script(body, signal),
    },
  },
  trial: { onFirstCloudRequest: async () => false },
  config: { region: "test", catalogTtlMs: 0, refusalFlagThreshold: 10 },
});
beforeAll(async () => {
  await conn.db
    .insert(schema.modelCatalog)
    .values({
      modelId,
      provider: "openrouter",
      upstreamModelId: "openai/fixture",
      displayName: "Responses fixture",
      capabilities: ["text.chat", "tools", "responses"],
      inputMicroPerToken: 100n,
      cachedInputMicroPerToken: 10n,
      outputMicroPerToken: 1000n,
      maxOutputTokens: 100,
    })
    .onConflictDoNothing();
});
afterAll(async () => {
  await conn.db.delete(schema.modelCatalog).where(eq(schema.modelCatalog.modelId, modelId));
  await conn.close();
});
async function funded(label: string): Promise<RequestFacts> {
  const ids = await seedOrg(conn.db, label);
  await ledger.grant({
    orgId: ids.orgId,
    amount: creditsToMicro(20),
    bucket: "topup",
    type: "topup",
    idempotencyKey: `fund:${ids.orgId}`,
    actor: "test",
  });
  return {
    principal: {
      ...ids,
      email: "qa@test.invalid",
      emailVerified: true,
      banned: false,
      role: "owner",
      sessionId: "s",
      personalOrgId: ids.orgId,
    },
    traceId: "test",
    deviceId: null,
    ipHash: null,
  };
}
const body = { model: modelId, input: "hello", max_output_tokens: 100 };
describe("metered Responses", () => {
  it("uses the running token estimate rather than the reservation upper bound near a usage limit", async () => {
    const f = await funded("responses-window-estimate");
    const { windowCaps } = await planForOrg(conn.db, f.principal.orgId, new Date());
    await conn.db
      .insert(schema.usageWindows)
      .values({ userId: f.principal.userId, weekAnchorAt: new Date(Date.now() - 3_600_000) });
    await conn.db.insert(schema.usageBuckets).values({
      userId: f.principal.userId,
      bucketStart: new Date(Date.now() - 20 * 60_000),
      spentMicro: windowCaps.fiveHour - 3500n,
    });
    const saved = script;
    try {
      script = async function* () {
        yield responseChunk({ type: "response.output_text.delta", delta: "partial" });
        yield responseChunk({
          type: "response.completed",
          response: { id: "within-limit", usage: { input_tokens: 5, output_tokens: 2 } },
        });
      };
      const result = await gateway.responsesStream(f, body);
      expect(await new Response(result.stream).text()).toContain("event: response.completed");
      const usage = await conn.db.query.usageRequests.findFirst({
        where: eq(schema.usageRequests.id, result.requestId),
      });
      expect(usage).toMatchObject({ status: "settled", settledMicro: 2500n });
    } finally {
      script = saved;
    }
  });
  it("settles upstream cached and reasoning token usage before completing the stream", async () => {
    const f = await funded("responses-settle");
    const before = await ledger.available(f.principal.orgId);
    let settled = false;
    const result = await gateway.responsesStream(f, body, {
      onResponseSettled: async () => {
        settled = true;
      },
    });
    const text = await new Response(result.stream).text();
    expect(text).toContain("response.completed");
    expect(text).toContain("hello");
    expect(settled).toBe(true);
    expect(await ledger.available(f.principal.orgId)).toBe(before - 24_100n);
    const usage = await conn.db.query.usageRequests.findFirst({
      where: eq(schema.usageRequests.id, result.requestId),
    });
    expect(usage).toMatchObject({
      endpoint: "responses",
      status: "settled",
      inputTokens: 40,
      outputTokens: 20,
      cachedInputTokens: 10,
    });
  });
  it("rejects invalid payloads and spending caps without creating a charge", async () => {
    const f = await funded("responses-cap");
    const before = await ledger.available(f.principal.orgId);
    await expect(gateway.responsesStream(f, body, { budgetCap: 1n })).rejects.toMatchObject({
      code: "budget_exhausted",
    });
    await expect(gateway.responsesStream(f, { ...body, provider: {} })).rejects.toMatchObject({
      code: "bad_request",
    });
    expect(await ledger.available(f.principal.orgId)).toBe(before);
  });
  it("releases failed inference and never bills another organization", async () => {
    const f = await funded("responses-failure");
    const other = await funded("responses-other");
    const before = await ledger.available(f.principal.orgId);
    const otherBefore = await ledger.available(other.principal.orgId);
    const saved = script;
    try {
      script = async function* () {
        yield await Promise.reject(
          new ProviderError("openrouter", 503, "unavailable", "outage", true),
        );
      };
      const result = await gateway.responsesStream(f, body);
      expect(await new Response(result.stream).text()).toContain("response.failed");
      expect(await ledger.available(f.principal.orgId)).toBe(before);
      expect(await ledger.available(other.principal.orgId)).toBe(otherBefore);
    } finally {
      script = saved;
    }
  });
  it("cancels a hanging provider and settles partial usage once", async () => {
    const f = await funded("responses-cancel");
    const saved = script;
    let aborted = false;
    let settlements = 0;
    try {
      script = async function* (_body, signal) {
        const wait = new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          );
        });
        yield responseChunk({ type: "response.output_text.delta", delta: "partial" });
        await wait;
      };
      const options: StepOptions = {
        onResponseSettled: async () => {
          settlements += 1;
        },
      };
      const result = await gateway.responsesStream(f, body, options);
      const reader = result.stream.getReader();
      await reader.read();
      await reader.cancel();
      expect(aborted).toBe(true);
      expect(settlements).toBe(1);
      const usage = await conn.db.query.usageRequests.findFirst({
        where: eq(schema.usageRequests.id, result.requestId),
      });
      // 9 estimated input tokens and 2 partial output tokens, not the larger reservation hold.
      expect(usage).toMatchObject({ inputTokens: 9, outputTokens: 2, settledMicro: 2900n });
    } finally {
      script = saved;
    }
  });
});
