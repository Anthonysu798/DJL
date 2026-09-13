/**
 * The model gateway: OpenAI-compatible chat, images, and embeddings on top of
 * the credit ledger.
 *
 * Per request: kill switch → plan limits and rate limits → route → reserve →
 * stream from the provider while tracking running cost → cut at zero →
 * settle actual usage → usage row, trial hook, abuse counting. Prompt and
 * response content are never persisted or logged.
 */
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import {
  costOfUsage,
  estimateReservation,
  type Microcredits,
  type ModelPrice,
  type PlanId,
} from "@djl/domain";
import {
  CircuitBreaker,
  ProviderError,
  type ChatChunk,
  type ChatRequest,
  type ProviderAdapter,
  type ProviderId,
  type Usage,
} from "@djl/providers";

import type { Principal } from "../auth/guard.ts";
import { InsufficientCreditsError, type LedgerService } from "../credits/LedgerService.ts";
import { ApiError } from "../http/errors.ts";
import type { TrialService } from "../trial/TrialService.ts";
import type { RateLimiter } from "./RateLimiter.ts";
import { estimateInputTokens, resolveModel, type CatalogModel } from "./routing.ts";

export interface GatewayConfig {
  readonly region: string;
  readonly catalogTtlMs: number;
  readonly refusalFlagThreshold: number;
  readonly instanceSoftCap: number;
  readonly instanceHardCap: number;
}

export interface GatewayDeps {
  readonly db: DjlDatabase;
  readonly ledger: LedgerService;
  readonly limiter: RateLimiter;
  readonly providers: Partial<Record<ProviderId, ProviderAdapter>>;
  readonly trial: Pick<TrialService, "onFirstCloudRequest">;
  readonly config: GatewayConfig;
  readonly onAlert?: (input: {
    readonly severity: "warn" | "p0";
    readonly title: string;
    readonly body: string;
  }) => void;
}

export interface RequestFacts {
  readonly principal: Principal;
  readonly traceId: string;
  readonly ipHash: string | null;
  readonly deviceId: string | null;
}

interface PlanLimits {
  readonly planId: PlanId;
  readonly concurrentStreams: number;
  readonly requestsPerMinute: number;
  readonly priorityWeight: number;
}

const TRAILER_EVENT = "djl.usage";

/** Microcredits per token → credits per 1,000 tokens with two decimals. */
function fmtPer1k(microPerToken: bigint): string {
  const hundredths = (microPerToken * 1000n) / 10_000n;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")}`;
}
/** Microcredits per unit → credits with two decimals. */
function fmtEach(micro: bigint): string {
  const hundredths = micro / 10_000n;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")}`;
}

function priceOf(m: CatalogModel): ModelPrice {
  return {
    modelId: m.modelId,
    provider: m.provider,
    inputPerToken: m.inputMicroPerToken,
    outputPerToken: m.outputMicroPerToken,
    cachedInputPerToken: m.cachedInputMicroPerToken,
    perImage: m.microPerImage,
    perRequest: m.microPerRequest,
  };
}

export class GatewayService {
  private catalogCache: { readonly at: number; readonly models: readonly CatalogModel[] } | null =
    null;
  private readonly breakers = new Map<ProviderId, CircuitBreaker>();
  private inFlight = 0;

  constructor(private readonly deps: GatewayDeps) {}

  // ---- catalog -------------------------------------------------------------

  async catalog(): Promise<readonly CatalogModel[]> {
    const now = Date.now();
    if (this.catalogCache && now - this.catalogCache.at < this.deps.config.catalogTtlMs)
      return this.catalogCache.models;
    const models = await this.deps.db.query.modelCatalog.findMany({
      orderBy: (t, { asc }) => [asc(t.sortOrder)],
    });
    this.catalogCache = { at: now, models };
    return models;
  }

  invalidateCatalog(): void {
    this.catalogCache = null;
  }

  async listModels() {
    const models = await this.catalog();
    return models
      .filter((m) => m.status !== "disabled")
      .map((m) => ({
        id: m.modelId,
        provider: m.provider,
        displayName: m.displayName,
        capabilities: m.capabilities,
        price: {
          inputPer1k: fmtPer1k(m.inputMicroPerToken),
          outputPer1k: fmtPer1k(m.outputMicroPerToken),
          perImage: fmtEach(m.microPerImage),
        },
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens,
        status: m.status,
      }));
  }

  // ---- guards --------------------------------------------------------------

  private breaker(provider: ProviderId): CircuitBreaker {
    let b = this.breakers.get(provider);
    if (!b) {
      b = new CircuitBreaker();
      this.breakers.set(provider, b);
    }
    return b;
  }

  private healthy(provider: ProviderId): boolean {
    return Boolean(this.deps.providers[provider]) && this.breaker(provider).state() !== "open";
  }

  private async assertNotPaused(): Promise<void> {
    const row = await this.deps.db.query.killSwitches.findFirst({
      where: eq(schema.killSwitches.name, "gateway"),
    });
    if (row?.engaged)
      throw new ApiError(503, "gateway_paused", "The model gateway is temporarily paused.");
  }

  private async planLimits(orgId: string): Promise<PlanLimits> {
    const sub = await this.deps.db.query.subscriptions.findFirst({
      where: and(eq(schema.subscriptions.orgId, orgId), eq(schema.subscriptions.status, "active")),
      orderBy: [desc(schema.subscriptions.createdAt)],
    });
    const planId: PlanId = sub?.planId ?? "trial";
    const plan = await this.deps.db.query.plans.findFirst({ where: eq(schema.plans.id, planId) });
    return {
      planId,
      concurrentStreams: plan?.concurrentStreams ?? 2,
      requestsPerMinute: plan?.requestsPerMinute ?? 20,
      priorityWeight: plan?.priorityWeight ?? 1,
    };
  }

  private async admit(facts: RequestFacts, limits: PlanLimits): Promise<() => Promise<void>> {
    const { limiter } = this.deps;
    const perUser = await limiter.hit(
      `user:${facts.principal.userId}`,
      limits.requestsPerMinute,
      60,
    );
    if (!perUser.allowed)
      throw new ApiError(
        429,
        "rate_limited",
        `Too many requests. Retry in ${perUser.retryAfterSeconds}s.`,
      );
    if (facts.ipHash) {
      const perIp = await limiter.hit(`ip:${facts.ipHash}`, 300, 60);
      if (!perIp.allowed)
        throw new ApiError(429, "rate_limited", "Too many requests from this network.");
    }
    const hold = await limiter.acquire(
      `org:${facts.principal.orgId}`,
      limits.concurrentStreams,
      600,
    );
    if (!hold.acquired)
      throw new ApiError(
        429,
        "rate_limited",
        `Your plan allows ${limits.concurrentStreams} concurrent streams.`,
      );
    if (this.inFlight >= this.deps.config.instanceHardCap && limits.priorityWeight < 16) {
      await hold.release();
      throw new ApiError(503, "overloaded", "Servers are busy. Try again in a moment.");
    }
    this.inFlight += 1;
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      this.inFlight -= 1;
      await hold.release();
    };
  }

  private route(requested: string, catalog: readonly CatalogModel[]) {
    const decision = resolveModel(requested, catalog, (p) => this.healthy(p));
    if ("error" in decision) {
      const map = {
        unknown_model: [404, "unknown_model", "Unknown model."],
        model_disabled: [400, "model_disabled", "That model is disabled."],
        no_healthy_model: [
          503,
          "no_healthy_model",
          "No provider is available for that model right now.",
        ],
      } as const;
      const [status, code, message] = map[decision.error];
      throw new ApiError(status, code, message);
    }
    return decision;
  }

  private async recordRequest(input: {
    readonly id: string;
    readonly facts: RequestFacts;
    readonly model: CatalogModel;
    readonly endpoint: string;
    readonly routeReason: string;
    readonly reserved: Microcredits;
  }) {
    await this.deps.db.insert(schema.usageRequests).values({
      id: input.id,
      orgId: input.facts.principal.orgId,
      userId: input.facts.principal.userId,
      deviceId: input.facts.deviceId,
      modelId: input.model.modelId,
      provider: input.model.provider,
      endpoint: input.endpoint,
      routeReason: input.routeReason,
      status: "reserved",
      reservedMicro: input.reserved,
      traceId: input.facts.traceId,
      region: this.deps.config.region,
    });
  }

  private async finishRequest(input: {
    readonly id: string;
    readonly status: "settled" | "released" | "cut_off" | "failed";
    readonly usage?: Usage & { readonly images?: number };
    readonly settled?: Microcredits;
    readonly upstreamRequestId?: string | null;
    readonly refusal?: boolean;
    readonly errorCode?: string | null;
    readonly startedAt: number;
    readonly firstTokenAt: number | null;
  }) {
    await this.deps.db
      .update(schema.usageRequests)
      .set({
        status: input.status,
        settledMicro: input.settled ?? null,
        inputTokens: input.usage?.input_tokens ?? null,
        outputTokens: input.usage?.output_tokens ?? null,
        cachedInputTokens: input.usage?.cached_input_tokens ?? null,
        images: input.usage?.images ?? null,
        upstreamRequestId: input.upstreamRequestId ?? null,
        refusal: input.refusal ?? false,
        errorCode: input.errorCode ?? null,
        latencyMs: Date.now() - input.startedAt,
        firstTokenMs: input.firstTokenAt ? input.firstTokenAt - input.startedAt : null,
        completedAt: new Date(),
      })
      .where(eq(schema.usageRequests.id, input.id));
  }

  private async afterSettle(facts: RequestFacts, refusal: boolean): Promise<void> {
    await this.deps.trial.onFirstCloudRequest(facts.principal.orgId).catch(() => false);
    if (!refusal) return;
    const since = new Date(Date.now() - 24 * 3_600_000);
    const count = await this.deps.db.$count(
      schema.usageRequests,
      and(
        eq(schema.usageRequests.userId, facts.principal.userId),
        eq(schema.usageRequests.refusal, true),
        gt(schema.usageRequests.createdAt, since),
      ),
    );
    if (count >= this.deps.config.refusalFlagThreshold) {
      await this.deps.db.insert(schema.abuseFlags).values({
        orgId: facts.principal.orgId,
        userId: facts.principal.userId,
        kind: "refusals",
        severity: count >= this.deps.config.refusalFlagThreshold * 3 ? "suspend" : "warn",
        details: { refusalsLast24h: count },
      });
      this.deps.onAlert?.({
        severity: "warn",
        title: "Repeated provider refusals",
        body: `user ${facts.principal.userId} had ${count} refusals in 24h`,
      });
    }
  }

  // ---- chat ----------------------------------------------------------------

  /**
   * Streams an OpenAI-compatible SSE body. The final events are
   * `event: djl.usage` with the settled cost, then `data: [DONE]`.
   */
  async chatStream(
    facts: RequestFacts,
    body: ChatRequest & { readonly stream?: boolean },
  ): Promise<{ readonly stream: ReadableStream<Uint8Array>; readonly requestId: string }> {
    await this.assertNotPaused();
    const limits = await this.planLimits(facts.principal.orgId);
    const release = await this.admit(facts, limits);
    let reserved: Microcredits | null = null;
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    try {
      const catalog = await this.catalog();
      const { model, reason } = this.route(body.model, catalog);
      if (!model.capabilities.includes("text.chat"))
        throw new ApiError(400, "bad_request", "That model does not support chat.");
      if (body.tools?.length && !model.capabilities.includes("tools"))
        throw new ApiError(400, "bad_request", "That model does not support tools.");
      const price = priceOf(model);
      const inputTokens = estimateInputTokens(body.messages);
      const maxOutput = Math.min(body.max_tokens ?? 4096, model.maxOutputTokens ?? 8192);
      const estimate = estimateReservation(price, {
        inputTokens,
        maxOutputTokens: maxOutput,
        images: 0,
      });
      let balancesAfter;
      try {
        balancesAfter = await this.deps.ledger.reserve({
          orgId: facts.principal.orgId,
          reservationId: requestId,
          estimate,
          idempotencyKey: `req:${requestId}`,
          actor: `user:${facts.principal.userId}`,
        });
      } catch (e) {
        if (e instanceof InsufficientCreditsError)
          throw new ApiError(
            402,
            "insufficient_credits",
            "Not enough credits for this request. Add credits to continue.",
          );
        throw e;
      }
      reserved = estimate;
      const budget = balancesAfter.trial + balancesAfter.plan + balancesAfter.topup + estimate; // what the org could spend
      await this.recordRequest({
        id: requestId,
        facts,
        model,
        endpoint: "chat.completions",
        routeReason: reason,
        reserved: estimate,
      });

      const provider = this.deps.providers[model.provider]!;
      const breaker = this.breaker(model.provider);
      const abort = new AbortController();
      const upstream: ChatRequest = {
        ...body,
        model: model.upstreamModelId,
        max_tokens: maxOutput,
        user: facts.principal.orgId.slice(0, 16),
      };
      const encoder = new TextEncoder();

      const produce = async function* (this: GatewayService): AsyncGenerator<string> {
        let outputChars = 0;
        let usage: Usage | null = null;
        let finish: ChatChunk["finish_reason"] = null;
        let upstreamId: string | null = null;
        let firstTokenAt: number | null = null;
        let cutOff = false;
        let failed: ApiError | null = null;
        let settled = false;
        const settle = async (): Promise<string[]> => {
          if (settled) return [];
          settled = true;
          const lines: string[] = [];
          const finalUsage: Usage = usage ?? {
            input_tokens: inputTokens,
            output_tokens: Math.ceil(outputChars / 4),
            cached_input_tokens: 0,
          };
          try {
            if (failed && outputChars === 0 && !usage) {
              await this.deps.ledger.release({
                orgId: facts.principal.orgId,
                reservationId: requestId,
                idempotencyKey: `req:${requestId}`,
                actor: "system:gateway",
              });
              await this.finishRequest({
                id: requestId,
                status: "failed",
                errorCode: failed.code,
                startedAt,
                firstTokenAt,
              });
              lines.push(
                `event: error\ndata: ${JSON.stringify({ error: { code: failed.code, message: failed.message, traceId: facts.traceId } })}\n\n`,
              );
            } else {
              const actual = costOfUsage(price, {
                inputTokens: finalUsage.input_tokens,
                cachedInputTokens: finalUsage.cached_input_tokens,
                outputTokens: finalUsage.output_tokens,
                images: 0,
                requests: 1,
              });
              const { balances } = await this.deps.ledger.settle({
                orgId: facts.principal.orgId,
                reservationId: requestId,
                actual,
                idempotencyKey: `req:${requestId}`,
                actor: "system:gateway",
              });
              const refusal = finish === "content_filter";
              await this.finishRequest({
                id: requestId,
                status: cutOff ? "cut_off" : failed ? "failed" : "settled",
                usage: finalUsage,
                settled: actual,
                upstreamRequestId: upstreamId,
                refusal,
                errorCode: failed?.code ?? null,
                startedAt,
                firstTokenAt,
              });
              const trailer = {
                requestId,
                model: model.modelId,
                routeReason: reason,
                inputTokens: finalUsage.input_tokens,
                outputTokens: finalUsage.output_tokens,
                settled: actual.toString(),
                remaining: (balances.trial + balances.plan + balances.topup).toString(),
                cutOff,
              };
              if (cutOff)
                lines.push(
                  `event: error\ndata: ${JSON.stringify({ error: { code: "insufficient_credits", message: "Credits ran out during this response.", traceId: facts.traceId } })}\n\n`,
                );
              if (failed && !cutOff)
                lines.push(
                  `event: error\ndata: ${JSON.stringify({ error: { code: failed.code, message: failed.message, traceId: facts.traceId } })}\n\n`,
                );
              lines.push(`event: ${TRAILER_EVENT}\ndata: ${JSON.stringify(trailer)}\n\n`);
              void this.afterSettle(facts, refusal);
            }
          } catch (error) {
            console.error(
              JSON.stringify({
                level: "error",
                msg: "gateway settle failed",
                traceId: facts.traceId,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
            lines.push(
              `event: error\ndata: ${JSON.stringify({ error: { code: "internal", message: "Could not record usage.", traceId: facts.traceId } })}\n\n`,
            );
          } finally {
            await release();
          }
          lines.push("data: [DONE]\n\n");
          return lines;
        };
        try {
          for await (const chunk of provider.chatStream(upstream, abort.signal)) {
            if (firstTokenAt === null) firstTokenAt = Date.now();
            upstreamId ??= chunk.id || null;
            if (chunk.delta.content) outputChars += chunk.delta.content.length;
            for (const t of chunk.delta.tool_calls ?? [])
              outputChars += t.function?.arguments?.length ?? 0;
            if (chunk.finish_reason) finish = chunk.finish_reason;
            if (chunk.usage) usage = chunk.usage;
            // Running cost check: cut immediately at zero (decision: Out of credits).
            const running = costOfUsage(price, {
              inputTokens,
              cachedInputTokens: 0,
              outputTokens: Math.ceil(outputChars / 4),
              images: 0,
              requests: 1,
            });
            if (running > budget) {
              cutOff = true;
              abort.abort();
              break;
            }
            if (
              chunk.delta.content !== undefined ||
              chunk.delta.tool_calls ||
              chunk.delta.role ||
              chunk.finish_reason
            ) {
              const out = {
                id: requestId,
                object: "chat.completion.chunk",
                created: Math.floor(startedAt / 1000),
                model: model.modelId,
                choices: [{ index: 0, delta: chunk.delta, finish_reason: chunk.finish_reason }],
              };
              yield `data: ${JSON.stringify(out)}\n\n`;
            }
          }
          breaker.success();
        } catch (error) {
          if (error instanceof ProviderError) {
            if (error.retryable) breaker.failure();
            if (error.code === "auth")
              this.deps.onAlert?.({
                severity: "p0",
                title: `${model.provider} rejected our key`,
                body: error.message,
              });
            failed = new ApiError(
              error.code === "rate_limited" ? 429 : error.code === "bad_request" ? 400 : 502,
              `provider_${error.code}`,
              "The model provider returned an error.",
            );
          } else if (!cutOff) {
            failed = new ApiError(502, "provider_unknown", "The model provider failed.");
          }
        } finally {
          // Runs on normal completion, provider failure, and client disconnect (iterator.return()).
          abort.abort();
          for (const line of await settle()) yield line;
        }
      };
      const iterator = produce.call(this);
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { value, done } = await iterator.next();
          if (done) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(value));
        },
        async cancel() {
          abort.abort();
          await iterator.return(undefined);
        },
      });
      return { stream, requestId };
    } catch (error) {
      if (reserved !== null) {
        await this.deps.ledger
          .release({
            orgId: facts.principal.orgId,
            reservationId: requestId,
            idempotencyKey: `req:${requestId}`,
            actor: "system:gateway",
          })
          .catch(() => undefined);
        await this.finishRequest({
          id: requestId,
          status: "failed",
          errorCode: error instanceof ApiError ? error.code : "internal",
          startedAt,
          firstTokenAt: null,
        }).catch(() => undefined);
      }
      await release();
      throw error;
    }
  }

  // ---- images --------------------------------------------------------------

  async generateImage(
    facts: RequestFacts,
    body: {
      readonly model: string;
      readonly prompt: string;
      readonly n?: number;
      readonly size?: string;
      readonly quality?: string;
    },
  ) {
    await this.assertNotPaused();
    const limits = await this.planLimits(facts.principal.orgId);
    const release = await this.admit(facts, limits);
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    let reserved = false;
    try {
      const n = Math.min(Math.max(body.n ?? 1, 1), 4);
      if (!body.prompt || body.prompt.length > 8000)
        throw new ApiError(400, "bad_request", "A prompt of up to 8,000 characters is required.");
      const { model, reason } = this.route(body.model, await this.catalog());
      if (!model.capabilities.includes("image.generate"))
        throw new ApiError(400, "bad_request", "That model does not generate images.");
      const price = priceOf(model);
      const estimate = estimateReservation(price, {
        inputTokens: 0,
        maxOutputTokens: 0,
        images: n,
      });
      try {
        await this.deps.ledger.reserve({
          orgId: facts.principal.orgId,
          reservationId: requestId,
          estimate,
          idempotencyKey: `req:${requestId}`,
          actor: `user:${facts.principal.userId}`,
        });
      } catch (e) {
        if (e instanceof InsufficientCreditsError)
          throw new ApiError(
            402,
            "insufficient_credits",
            "Not enough credits for this request. Add credits to continue.",
          );
        throw e;
      }
      reserved = true;
      await this.recordRequest({
        id: requestId,
        facts,
        model,
        endpoint: "images.generations",
        routeReason: reason,
        reserved: estimate,
      });
      const provider = this.deps.providers[model.provider]!;
      const breaker = this.breaker(model.provider);
      let result;
      try {
        result = await provider.generateImage(
          {
            model: model.upstreamModelId,
            prompt: body.prompt,
            n,
            ...(body.size ? { size: body.size } : {}),
            ...(body.quality ? { quality: body.quality } : {}),
            user: facts.principal.orgId.slice(0, 16),
          },
          new AbortController().signal,
        );
        breaker.success();
      } catch (error) {
        if (error instanceof ProviderError && error.retryable) breaker.failure();
        await this.deps.ledger.release({
          orgId: facts.principal.orgId,
          reservationId: requestId,
          idempotencyKey: `req:${requestId}`,
          actor: "system:gateway",
        });
        await this.finishRequest({
          id: requestId,
          status: "failed",
          errorCode: error instanceof ProviderError ? `provider_${error.code}` : "provider_unknown",
          startedAt,
          firstTokenAt: null,
        });
        throw new ApiError(
          error instanceof ProviderError && error.code === "refused" ? 400 : 502,
          "provider_error",
          "The image provider returned an error.",
        );
      }
      const actual = costOfUsage(price, {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        images: result.count,
        requests: 1,
      });
      const { balances } = await this.deps.ledger.settle({
        orgId: facts.principal.orgId,
        reservationId: requestId,
        actual,
        idempotencyKey: `req:${requestId}`,
        actor: "system:gateway",
      });
      await this.finishRequest({
        id: requestId,
        status: "settled",
        usage: { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, images: result.count },
        settled: actual,
        startedAt,
        firstTokenAt: null,
      });
      void this.afterSettle(facts, false);
      return {
        created: Math.floor(startedAt / 1000),
        data: result.images,
        usage: {
          requestId,
          model: model.modelId,
          routeReason: reason,
          images: result.count,
          settled: actual.toString(),
          remaining: (balances.trial + balances.plan + balances.topup).toString(),
        },
      };
    } catch (error) {
      if (reserved && !(error instanceof ApiError && error.code === "provider_error")) {
        await this.deps.ledger
          .release({
            orgId: facts.principal.orgId,
            reservationId: requestId,
            idempotencyKey: `req:${requestId}`,
            actor: "system:gateway",
          })
          .catch(() => undefined);
      }
      throw error;
    } finally {
      await release();
    }
  }

  // ---- embeddings ----------------------------------------------------------

  async embed(
    facts: RequestFacts,
    body: { readonly model: string; readonly input: string | readonly string[] },
  ) {
    await this.assertNotPaused();
    const limits = await this.planLimits(facts.principal.orgId);
    const release = await this.admit(facts, limits);
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    try {
      const inputs = typeof body.input === "string" ? [body.input] : [...body.input];
      if (inputs.length === 0 || inputs.length > 256)
        throw new ApiError(400, "bad_request", "Provide 1 to 256 inputs.");
      const { model, reason } = this.route(body.model, await this.catalog());
      if (!model.capabilities.includes("embeddings"))
        throw new ApiError(400, "bad_request", "That model does not produce embeddings.");
      const price = priceOf(model);
      const inputTokens = estimateInputTokens(inputs.map((content) => ({ content })));
      const estimate = estimateReservation(price, { inputTokens, maxOutputTokens: 0, images: 0 });
      try {
        await this.deps.ledger.reserve({
          orgId: facts.principal.orgId,
          reservationId: requestId,
          estimate,
          idempotencyKey: `req:${requestId}`,
          actor: `user:${facts.principal.userId}`,
        });
      } catch (e) {
        if (e instanceof InsufficientCreditsError)
          throw new ApiError(402, "insufficient_credits", "Not enough credits for this request.");
        throw e;
      }
      await this.recordRequest({
        id: requestId,
        facts,
        model,
        endpoint: "embeddings",
        routeReason: reason,
        reserved: estimate,
      });
      const provider = this.deps.providers[model.provider]!;
      let result;
      try {
        result = await provider.embed(
          { model: model.upstreamModelId, input: inputs, user: facts.principal.orgId.slice(0, 16) },
          new AbortController().signal,
        );
        this.breaker(model.provider).success();
      } catch (error) {
        if (error instanceof ProviderError && error.retryable)
          this.breaker(model.provider).failure();
        await this.deps.ledger.release({
          orgId: facts.principal.orgId,
          reservationId: requestId,
          idempotencyKey: `req:${requestId}`,
          actor: "system:gateway",
        });
        await this.finishRequest({
          id: requestId,
          status: "failed",
          errorCode: "provider_error",
          startedAt,
          firstTokenAt: null,
        });
        throw new ApiError(502, "provider_error", "The embedding provider returned an error.");
      }
      const usage: Usage = {
        input_tokens: result.usage.input_tokens || inputTokens,
        output_tokens: 0,
        cached_input_tokens: 0,
      };
      const actual = costOfUsage(price, {
        inputTokens: usage.input_tokens,
        cachedInputTokens: 0,
        outputTokens: 0,
        images: 0,
        requests: 1,
      });
      await this.deps.ledger.settle({
        orgId: facts.principal.orgId,
        reservationId: requestId,
        actual,
        idempotencyKey: `req:${requestId}`,
        actor: "system:gateway",
      });
      await this.finishRequest({
        id: requestId,
        status: "settled",
        usage,
        settled: actual,
        startedAt,
        firstTokenAt: null,
      });
      void this.afterSettle(facts, false);
      return {
        object: "list",
        model: model.modelId,
        data: result.embeddings.map((embedding, index) => ({
          object: "embedding",
          index,
          embedding,
        })),
        usage: { prompt_tokens: usage.input_tokens, total_tokens: usage.input_tokens },
      };
    } finally {
      await release();
    }
  }

  /** Recent usage for dashboards. */
  async usage(orgId: string, limit = 50) {
    return this.deps.db.query.usageRequests.findMany({
      where: eq(schema.usageRequests.orgId, orgId),
      orderBy: [desc(schema.usageRequests.createdAt)],
      limit: Math.min(limit, 200),
    });
  }

  /** Aggregate per model for the dashboard's breakdown. */
  async usageByModel(orgId: string, sinceDays = 30) {
    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
    return this.deps.db.execute<{
      model_id: string;
      requests: number;
      settled: string;
      input_tokens: number;
      output_tokens: number;
    }>(sql`
      SELECT model_id, count(*)::int AS requests, coalesce(sum(settled_micro),0)::text AS settled,
             coalesce(sum(input_tokens),0)::int AS input_tokens, coalesce(sum(output_tokens),0)::int AS output_tokens
      FROM usage_requests WHERE org_id = ${orgId} AND created_at > ${since}::timestamptz AND status IN ('settled','cut_off')
      GROUP BY model_id ORDER BY sum(settled_micro) DESC NULLS LAST`);
  }
}
