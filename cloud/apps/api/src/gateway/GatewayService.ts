/**
 * The model gateway: OpenAI-compatible chat, images, and embeddings on top of
 * the credit ledger.
 *
 * Per request: admission chain (kill switch → abuse → rate → window, see
 * admission.ts) → route → reserve → stream from the provider while tracking
 * running cost → cut at zero → settle actual usage → usage row, trial hook,
 * abuse counting. Prompt and response content are never persisted or logged.
 */
import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { CloudUsageTrailer } from "@synara/contracts/cloud";
import { schema, type DjlDatabase } from "@djl/db";
import {
  costOfUsage,
  estimateReservation,
  spendable,
  type Microcredits,
  type ModelPrice,
} from "@djl/domain";
import {
  CircuitBreaker,
  ProviderError,
  type ChatChunk,
  type ChatRequest,
  type ImageResult,
  type ProviderAdapter,
  type ProviderId,
  type Usage,
} from "@djl/providers";

import type { Principal } from "../auth/guard.ts";
import type { Settings } from "../config/settings.ts";
import { gatewayRequests, settledMicrocredits, withSpan } from "../observability.ts";
import { InsufficientCreditsError, type LedgerService } from "../credits/LedgerService.ts";
import { bytesMatchType } from "../files/fileTypes.ts";
import { ApiError } from "../http/errors.ts";
import type { TrialService } from "../trial/TrialService.ts";
import { planForOrg } from "../usage/plans.ts";
import { windowExhausted } from "../usage/windowPolicy.ts";
import { UsageWindowExhaustedError } from "../usage/windowStore.ts";
import {
  allowAll,
  killSwitchPolicy,
  rateLimitPolicy,
  runAdmission,
  type AdmissionPolicy,
  type AdmissionRelease,
  type PlanLimits,
} from "./admission.ts";
import type { RateLimiter } from "./RateLimiter.ts";
import { estimateInputTokens, resolveModel, type CatalogModel } from "./routing.ts";

export interface GatewayConfig {
  readonly region: string;
  readonly catalogTtlMs: number;
  readonly refusalFlagThreshold: number;
}

export interface GatewayDeps {
  readonly db: DjlDatabase;
  readonly ledger: LedgerService;
  readonly limiter: RateLimiter;
  readonly settings: Settings;
  /**
   * Admission slots other features fill; each allows everything when absent.
   * The chain runs kill switch → abuse → rate → window.
   */
  readonly admission?: {
    readonly abuse?: AdmissionPolicy;
    readonly window?: AdmissionPolicy;
  };
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

/** One OpenAI-compatible `chat.completion.chunk`. */
export interface ChatCompletionChunk {
  readonly id: string;
  readonly object: "chat.completion.chunk";
  readonly created: number;
  readonly model: string;
  readonly choices: readonly [
    {
      readonly index: 0;
      readonly delta: ChatChunk["delta"];
      readonly finish_reason: ChatChunk["finish_reason"];
    },
  ];
}

export interface StepOptions {
  /** Aborting stops the provider call; what was used so far is settled. */
  readonly signal?: AbortSignal;
  /** Most this step may spend, in microcredits; the stream is cut when it is reached. */
  readonly budgetCap?: Microcredits;
}

export interface StepResult {
  /** The settled cost, as sent in the `djl.usage` trailer; null when nothing was settled. */
  readonly usage: CloudUsageTrailer | null;
  /** Why the step ended early (provider failure, cut off), if it did. */
  readonly error: { readonly code: string; readonly message: string } | null;
}

export interface Step {
  readonly requestId: string;
  /**
   * The provider's output. Iterate it to the end or stop early (break, or
   * the signal); either way the request is settled and `result` resolves.
   * A step that is never iterated holds its reservation until the stale
   * reservation job releases it.
   */
  readonly chunks: AsyncIterable<ChatCompletionChunk>;
  readonly result: Promise<StepResult>;
}

const TRAILER_EVENT = "djl.usage";
const EDITABLE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export const MAX_EDIT_IMAGE_BYTES = 16 * 1024 * 1024;

/** The tightest spending limit on a stream and the error it ends with when reached. */
function streamBudget(
  credits: Microcredits,
  windowHold: Microcredits | null,
  stepCap: Microcredits | undefined,
): { readonly amount: Microcredits; readonly error: { code: string; message: string } } {
  let budget = {
    amount: credits,
    error: { code: "insufficient_credits", message: "Credits ran out during this response." },
  };
  if (windowHold !== null && windowHold < budget.amount)
    budget = {
      amount: windowHold,
      error: {
        code: "usage_window_cut",
        message: "Your usage limit was reached during this response.",
      },
    };
  if (stepCap !== undefined && stepCap < budget.amount)
    budget = {
      amount: stepCap,
      error: { code: "budget_exhausted", message: "This step reached its spending cap." },
    };
  return budget;
}

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
  private readonly load = { inFlight: 0 };
  private readonly policies: readonly AdmissionPolicy[];

  constructor(private readonly deps: GatewayDeps) {
    this.policies = [
      killSwitchPolicy(deps.db),
      deps.admission?.abuse ?? allowAll("abuse"),
      rateLimitPolicy({ limiter: deps.limiter, settings: deps.settings, load: this.load }),
      deps.admission?.window ?? allowAll("window"),
    ];
  }

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

  /** In-flight streams and breaker states for the admin status page. */
  status(): { readonly inFlight: number; readonly breakers: Record<string, string> } {
    const breakers: Record<string, string> = {};
    for (const [provider, breaker] of this.breakers) breakers[provider] = breaker.state();
    return { inFlight: this.load.inFlight, breakers };
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
        freeEligible: m.freeEligible,
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

  private async admit(
    facts: RequestFacts,
  ): Promise<{ readonly release: AdmissionRelease; readonly limits: PlanLimits }> {
    const limits = await planForOrg(this.deps.db, facts.principal.orgId, new Date());
    return { release: await runAdmission(this.policies, { facts, limits }), limits };
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
    gatewayRequests.add(1, { status: input.status });
    if (input.settled && input.settled > 0n)
      settledMicrocredits.add(Number(input.settled), { status: input.status });
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
    const step = await this.completeStep(facts, body);
    const sse = async function* (): AsyncGenerator<string> {
      for await (const chunk of step.chunks) yield `data: ${JSON.stringify(chunk)}\n\n`;
      const { usage, error } = await step.result;
      if (error)
        yield `event: error\ndata: ${JSON.stringify({ error: { ...error, traceId: facts.traceId } })}\n\n`;
      if (usage) yield `event: ${TRAILER_EVENT}\ndata: ${JSON.stringify(usage)}\n\n`;
      yield "data: [DONE]\n\n";
    };
    const iterator = sse();
    const encoder = new TextEncoder();
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
        // Client disconnected: stop the provider and settle what was used.
        await iterator.return(undefined);
      },
    });
    return { stream, requestId: step.requestId };
  }

  /**
   * One model call, in process: admit, route, reserve, stream from the
   * provider while tracking running cost, cut at zero (or at `budgetCap`),
   * then settle actual usage. Throws an ApiError before streaming when the
   * request is refused; after that, failures end the step with `result.error`.
   */
  async completeStep(
    facts: RequestFacts,
    body: ChatRequest,
    options: StepOptions = {},
  ): Promise<Step> {
    const { release, limits } = await this.admit(facts);
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
      let reservation;
      try {
        reservation = await this.deps.ledger.reserve({
          orgId: facts.principal.orgId,
          reservationId: requestId,
          estimate,
          idempotencyKey: `req:${requestId}`,
          actor: `user:${facts.principal.userId}`,
          freeEligible: model.freeEligible,
          window: { userId: facts.principal.userId, caps: limits.windowCaps, partial: true },
        });
      } catch (e) {
        if (e instanceof UsageWindowExhaustedError) throw windowExhausted(e.window);
        if (e instanceof InsufficientCreditsError)
          throw new ApiError(
            402,
            "insufficient_credits",
            "Not enough credits for this request. Add credits to continue.",
          );
        throw e;
      }
      reserved = estimate;
      const budget = streamBudget(
        spendable(reservation.balances, model.freeEligible) + estimate, // what the org could spend
        reservation.windowHold !== null && reservation.windowHold < estimate
          ? reservation.windowHold
          : null,
        options.budgetCap,
      );
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
      const onAbort = () => abort.abort();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const upstream: ChatRequest = {
        ...body,
        model: model.upstreamModelId,
        max_tokens: maxOutput,
        user: facts.principal.orgId.slice(0, 16),
      };
      let resolveResult!: (result: StepResult) => void;
      const result = new Promise<StepResult>((resolve) => {
        resolveResult = resolve;
      });

      const produce = async function* (this: GatewayService): AsyncGenerator<ChatCompletionChunk> {
        let outputChars = 0;
        let usage: Usage | null = null;
        let finish: ChatChunk["finish_reason"] = null;
        let upstreamId: string | null = null;
        let firstTokenAt: number | null = null;
        let cutOff = false;
        let failed: ApiError | null = null;
        const settle = async (): Promise<StepResult> => {
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
              return { usage: null, error: { code: failed.code, message: failed.message } };
            }
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
              freeEligible: model.freeEligible,
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
            void this.afterSettle(facts, refusal);
            const trailer: CloudUsageTrailer = {
              requestId,
              model: model.modelId,
              routeReason: reason,
              inputTokens: finalUsage.input_tokens,
              outputTokens: finalUsage.output_tokens,
              settled: actual.toString(),
              remaining: spendable(balances, model.freeEligible).toString(),
              cutOff,
            };
            const error = cutOff
              ? budget.error
              : failed
                ? { code: failed.code, message: failed.message }
                : null;
            return { usage: trailer, error };
          } catch (error) {
            console.error(
              JSON.stringify({
                level: "error",
                msg: "gateway settle failed",
                traceId: facts.traceId,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
            return { usage: null, error: { code: "internal", message: "Could not record usage." } };
          } finally {
            await release();
          }
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
            if (running > budget.amount) {
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
              yield {
                id: requestId,
                object: "chat.completion.chunk",
                created: Math.floor(startedAt / 1000),
                model: model.modelId,
                choices: [{ index: 0, delta: chunk.delta, finish_reason: chunk.finish_reason }],
              };
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
          } else if (!cutOff && !options.signal?.aborted) {
            failed = new ApiError(502, "provider_unknown", "The model provider failed.");
          }
        } finally {
          // Runs on normal completion, provider failure, the caller's abort, and
          // the caller stopping early (iterator.return()).
          abort.abort();
          options.signal?.removeEventListener("abort", onAbort);
          resolveResult(await settle());
        }
      };
      return { requestId, chunks: produce.call(this), result };
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
    /** Aborted when the client disconnects; the provider call stops and nothing is charged. */
    options: { readonly signal?: AbortSignal } = {},
  ) {
    return this.imageRequest(
      facts,
      {
        endpoint: "images.generations",
        capability: "image.generate",
        model: body.model,
        prompt: body.prompt,
        n: body.n,
      },
      (provider, model, n, signal) =>
        provider.generateImage(
          {
            model,
            prompt: body.prompt,
            n,
            ...(body.size ? { size: body.size } : {}),
            ...(body.quality ? { quality: body.quality } : {}),
            user: facts.principal.orgId.slice(0, 16),
          },
          signal,
        ),
      options,
    );
  }

  /** Edits an image (PNG, JPEG, or WebP) the caller supplies; charged and refunded like a generation. */
  async editImage(
    facts: RequestFacts,
    body: {
      readonly model: string;
      readonly prompt: string;
      readonly image: { readonly bytes: Uint8Array; readonly mimeType: string };
      readonly n?: number;
      readonly size?: string;
    },
    options: { readonly signal?: AbortSignal } = {},
  ) {
    const { bytes, mimeType } = body.image;
    if (
      !EDITABLE_IMAGE_TYPES.has(mimeType) ||
      !bytesMatchType(mimeType, bytes) ||
      bytes.byteLength > MAX_EDIT_IMAGE_BYTES
    )
      throw new ApiError(
        400,
        "bad_request",
        "The image must be a PNG, JPEG, or WebP file of up to 16 MB.",
      );
    return this.imageRequest(
      facts,
      {
        endpoint: "images.edits",
        capability: "image.edit",
        model: body.model,
        prompt: body.prompt,
        n: body.n,
      },
      (provider, model, n, signal) =>
        provider.editImage(
          {
            model,
            prompt: body.prompt,
            image: body.image,
            n,
            ...(body.size ? { size: body.size } : {}),
            user: facts.principal.orgId.slice(0, 16),
          },
          signal,
        ),
      options,
    );
  }

  /**
   * One image call: admit, route to a model with `capability`, reserve per
   * image, call the provider, then settle what it returned. A provider failure
   * or an abort releases the reservation, so nothing is charged.
   */
  private async imageRequest(
    facts: RequestFacts,
    input: {
      readonly endpoint: "images.generations" | "images.edits";
      readonly capability: "image.generate" | "image.edit";
      readonly model: string;
      readonly prompt: string;
      readonly n: number | undefined;
    },
    call: (
      provider: ProviderAdapter,
      upstreamModelId: string,
      n: number,
      signal: AbortSignal,
    ) => Promise<ImageResult>,
    options: { readonly signal?: AbortSignal },
  ) {
    const { release, limits } = await this.admit(facts);
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    let reserved = false;
    try {
      const n = Math.min(Math.max(input.n ?? 1, 1), 4);
      if (!input.prompt || input.prompt.length > 8000)
        throw new ApiError(400, "bad_request", "A prompt of up to 8,000 characters is required.");
      const { model, reason } = this.route(input.model, await this.catalog());
      if (!model.capabilities.includes(input.capability))
        throw new ApiError(
          400,
          "bad_request",
          input.capability === "image.edit"
            ? "That model does not edit images."
            : "That model does not generate images.",
        );
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
          freeEligible: model.freeEligible,
          window: { userId: facts.principal.userId, caps: limits.windowCaps, partial: false },
        });
      } catch (e) {
        if (e instanceof UsageWindowExhaustedError) throw windowExhausted(e.window);
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
        endpoint: input.endpoint,
        routeReason: reason,
        reserved: estimate,
      });
      const provider = this.deps.providers[model.provider]!;
      const breaker = this.breaker(model.provider);
      let result;
      try {
        result = await withSpan(
          "gateway.image",
          { provider: model.provider, model: model.modelId },
          () =>
            call(
              provider,
              model.upstreamModelId,
              n,
              options.signal ?? new AbortController().signal,
            ),
        );
        breaker.success();
      } catch (error) {
        if (error instanceof ProviderError && error.retryable && !options.signal?.aborted)
          breaker.failure();
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
        freeEligible: model.freeEligible,
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
          remaining: spendable(balances, model.freeEligible).toString(),
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
    const { release, limits } = await this.admit(facts);
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
          freeEligible: model.freeEligible,
          window: { userId: facts.principal.userId, caps: limits.windowCaps, partial: false },
        });
      } catch (e) {
        if (e instanceof UsageWindowExhaustedError) throw windowExhausted(e.window);
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
        result = await withSpan(
          "gateway.embed",
          { provider: model.provider, model: model.modelId },
          () =>
            provider.embed(
              {
                model: model.upstreamModelId,
                input: inputs,
                user: facts.principal.orgId.slice(0, 16),
              },
              new AbortController().signal,
            ),
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
        freeEligible: model.freeEligible,
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
