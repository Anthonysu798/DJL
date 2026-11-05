import { describe, expect, it, vi } from "vitest";
import type { DjlDatabase } from "@djl/db";
import type { ChatRequest, ProviderAdapter } from "@djl/providers";
import type { CommerceProduct } from "@synara/contracts/cloud";

import type { Principal } from "../auth/guard.ts";
import { createMemoryRateLimiter } from "../gateway/RateLimiter.ts";
import { ApiError } from "../http/errors.ts";
import {
  CommerceImageSearchService,
  commerceImageCatalogVersion,
  createCommerceImageSearch,
  createRedisCommerceImageBudget,
  type CommerceImageBudget,
  type ImageSearchConfiguration,
} from "./ImageSearchService.ts";

const userId = "00000000-0000-4000-8000-000000000001";
const fileId = "00000000-0000-4000-8000-000000000002";
const productId = "00000000-0000-4000-8000-000000000003";
const p: Principal = {
  userId,
  email: "buyer@test.invalid",
  emailVerified: true,
  banned: false,
  sessionId: "test",
  orgId: "team",
  personalOrgId: "personal",
  role: "member",
};
const product: CommerceProduct = {
  id: productId,
  sku: "CANVAS-TOTE-CREAM",
  name: "Cream canvas tote bag",
  category: "Bags",
  description: "A simple cream canvas tote bag",
  imageUrl: "https://media.test/tote.png",
  priceCents: 3900,
  stock: 10,
  commissionBps: 1000,
  returnDays: 30,
};
const description = {
  isProduct: true,
  keywords: ["canvas", "tote", "bag"],
  description: "Cream canvas tote bag",
};

function fixture(outputs: unknown[] = [description, { ids: [productId] }]) {
  const requests: ChatRequest[] = [];
  let sequence = 0;
  const provider: ProviderAdapter = {
    id: "openai",
    async generateImage() {
      throw new Error("not used by image search");
    },
    async editImage() {
      throw new Error("not used by image search");
    },
    async embed() {
      throw new Error("not used by image search");
    },
    async *chatStream(request: ChatRequest) {
      requests.push(request);
      const output = outputs[sequence++];
      if (output instanceof Error) throw output;
      yield {
        id: "injected-test-provider",
        delta: { content: typeof output === "string" ? output : JSON.stringify(output) },
        finish_reason: "stop",
        usage: { input_tokens: 100, output_tokens: 30, cached_input_tokens: 0 },
      };
    },
  };
  const config: ImageSearchConfiguration = {
    modelId: "verified-test-vision",
    upstreamModelId: "test-upstream",
    provider,
    contextWindow: 10000,
    inputUsdPerMillion: "1.00",
    outputUsdPerMillion: "2.00",
    dailyBudgetUsdCents: 100,
    mediaOrigin: "https://media.test",
  };
  const settle = vi.fn(async (_amount: number) => {});
  const budget: CommerceImageBudget = { reserve: vi.fn(async () => ({ accepted: true, settle })) };
  const fileUrl = vi.fn(
    async (_principal: Pick<Principal, "userId">, _id: string) =>
      "https://media.test/private-image.png?signed=test",
  );
  const catalog = vi.fn(async () => ({ products: [product] }));
  const limiter = createMemoryRateLimiter();
  const audit = vi.fn();
  const configuration = vi.fn(async () => config);
  const deps = { enabled: true, configuration, fileUrl, catalog, limiter, budget, audit };
  return { deps, requests, settle, config, service: new CommerceImageSearchService(deps) };
}

function factoryFixture(
  overrides: {
    readonly unavailableUpload?: boolean;
    readonly model?: Readonly<Record<string, unknown>>;
    readonly env?: NodeJS.ProcessEnv;
    readonly signedUrl?: string;
  } = {},
) {
  const f = fixture();
  const model = {
    modelId: "vision",
    upstreamModelId: "test-vision",
    provider: "openai",
    status: "active",
    capabilities: ["text.chat", "vision", "json"],
    providerInputUsdPerMillion: "1",
    providerOutputUsdPerMillion: "2",
    contextWindow: 10000,
    maxOutputTokens: 512,
    ...overrides.model,
  };
  const findGenericFile = vi.fn(async () => ({ id: fileId, userId, orgId: p.personalOrgId }));
  const findModel = vi.fn(async () => model);
  const uploads = {
    fileUrl: vi.fn(async () => {
      if (overrides.unavailableUpload)
        throw new ApiError(404, "file_unavailable", "Image is unavailable.");
      return overrides.signedUrl ?? "https://storage.test/private.png?signed=test";
    }),
  };
  const service = createCommerceImageSearch({
    db: {
      query: { files: { findFirst: findGenericFile }, modelCatalog: { findFirst: findModel } },
    } as unknown as DjlDatabase,
    commerce: { catalog: async () => ({ products: [], currency: "CAD", mode: "disabled" }) },
    uploads,
    providers: { openai: f.config.provider },
    limiter: f.deps.limiter,
    redis: { eval: vi.fn(async () => 1) } as never,
    mockExternals: false,
    environment: "test",
    processEnv: {
      DJL_COMMERCE_IMAGE_ENABLED: "true",
      DJL_COMMERCE_IMAGE_EVALUATION_APPROVED: "true",
      DJL_COMMERCE_IMAGE_PRICING_VERIFIED: "true",
      DJL_COMMERCE_IMAGE_STORAGE_LIFECYCLE_VERIFIED: "true",
      DJL_COMMERCE_IMAGE_MODEL: "vision",
      DJL_COMMERCE_IMAGE_DAILY_BUDGET_USD_CENTS: "100",
      DJL_COMMERCE_MEDIA_ORIGIN: "https://media.test",
      OPENAI_API_KEY: "unit-test-placeholder-not-a-real-key",
      ...overrides.env,
    },
  });
  return { ...f, service, uploads, findGenericFile, findModel };
}

describe("real commerce image search", () => {
  it.each(["https://media.test", "https://different-web.test"])(
    "resolves a safe relative shop image only against its explicit HTTPS web base %s",
    async (webPublicUrl) => {
      const f = fixture();
      Object.assign(f.config, { webPublicUrl });
      const relative = { ...product, imageUrl: "/shop/media/tote.png" };
      f.deps.catalog.mockResolvedValue({ products: [relative] });
      const result = await f.service.search(p, { fileId });
      expect(result.products).toEqual([relative]);
      expect(result.indexVersion).toBe(
        commerceImageCatalogVersion(
          [{ ...relative, imageUrl: `${webPublicUrl}/shop/media/tote.png` }],
          f.config.mediaOrigin,
          webPublicUrl,
        ),
      );
      expect(f.requests).toHaveLength(2);
      expect(JSON.stringify(f.requests[1])).toContain(`${webPublicUrl}/shop/media/tote.png`);
      expect(JSON.stringify(f.requests[1])).not.toContain('"url":"/shop/');
    },
  );

  it("does not guess a storage origin or send ambiguous relative product paths to inference", async () => {
    for (const [webPublicUrl, imageUrl] of [
      [undefined, "/shop/media/tote.png"],
      ["https://media.test", "//different.test/shop/tote.png"],
      ["https://media.test", "/shop/../private.png"],
      ["https://media.test", "/shop/%2e%2e/private.png"],
      ["https://media.test", "/shop/media%2ftote.png"],
      ["https://media.test", "/shop\\..\\private.png"],
      ["https://media.test", "/shop/media/tote.png\n"],
    ]) {
      const f = fixture();
      Object.assign(f.config, { webPublicUrl });
      f.deps.catalog.mockResolvedValue({ products: [{ ...product, imageUrl: imageUrl! }] });
      expect((await f.service.search(p, { fileId })).products).toEqual([]);
      expect(f.requests).toHaveLength(0);
      expect(f.deps.budget.reserve).not.toHaveBeenCalled();
    }
  });

  it("fails closed at request time for bad explicit media/web/API configuration, never during factory construction", async () => {
    for (const patch of [
      { webPublicUrl: "http://media.test" },
      { webPublicUrl: "https://user:private@media.test" },
      { apiPublicUrl: "https://media.test" },
    ]) {
      const f = fixture();
      Object.assign(f.config, patch);
      await expect(f.service.search(p, { fileId })).rejects.toMatchObject({ status: 503 });
      expect(f.requests).toHaveLength(0);
      expect(f.deps.budget.reserve).not.toHaveBeenCalled();
      expect(f.deps.fileUrl).not.toHaveBeenCalled();
    }
    const f = factoryFixture({ env: { API_PUBLIC_URL: "https://media.test" } });
    await expect(f.service.search(p, { fileId })).rejects.toMatchObject({ status: 503 });
    expect(f.requests).toHaveLength(0);
    expect(f.uploads.fileUrl).not.toHaveBeenCalled();
  });

  it("fails closed without configuration and never calls a provider in mock mode", async () => {
    const f = fixture();
    await expect(
      new CommerceImageSearchService({ ...f.deps, enabled: false }).search(p, { fileId }),
    ).rejects.toMatchObject({ status: 503 });
    expect(f.requests).toHaveLength(0);
    expect(f.deps.configuration).not.toHaveBeenCalled();

    const service = createCommerceImageSearch({
      db: {} as DjlDatabase,
      commerce: { catalog: f.deps.catalog } as never,
      uploads: { fileUrl: vi.fn() },
      providers: { openai: f.config.provider },
      limiter: f.deps.limiter,
      redis: { eval: vi.fn() } as never,
      mockExternals: true,
      environment: "test",
      processEnv: {
        DJL_COMMERCE_IMAGE_ENABLED: "true",
        DJL_COMMERCE_IMAGE_EVALUATION_APPROVED: "true",
        DJL_COMMERCE_IMAGE_PRICING_VERIFIED: "true",
        DJL_COMMERCE_IMAGE_STORAGE_LIFECYCLE_VERIFIED: "true",
      },
    });
    await expect(service.search(p, { fileId })).rejects.toMatchObject({ status: 503 });
    expect(f.requests).toHaveLength(0);
  });

  it("validates ids, extra fields and description length before accessing files or AI", async () => {
    const f = fixture();
    for (const input of [
      { fileId: "https://foreign.test/image.png" },
      { fileId, query: "x".repeat(301) },
      { fileId, url: "https://foreign.test" },
      null,
    ])
      await expect(f.service.search(p, input)).rejects.toMatchObject({ status: 400 });
    expect(f.deps.fileUrl).not.toHaveBeenCalled();
    expect(f.requests).toHaveLength(0);
  });

  it("passes the authenticated buyer and never calls a provider for an unavailable image", async () => {
    const f = fixture();
    f.deps.fileUrl.mockRejectedValue(new Error("not owned"));
    await expect(f.service.search(p, { fileId })).rejects.toThrow();
    expect(f.deps.fileUrl).toHaveBeenCalledWith(p, fileId);
    expect(f.requests).toHaveLength(0);
    expect(f.deps.budget.reserve).not.toHaveBeenCalled();
  });

  it("returns only real fresh catalog data and records no images, query or credentials in usage", async () => {
    const f = fixture();
    const result = await f.service.search(
      p,
      { fileId, query: "a bag" },
      { traceId: "request-trace" },
    );
    expect(result.products).toEqual([product]);
    expect(result).toMatchObject({ matchType: "similar", modelId: f.config.modelId });
    expect(result.indexVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(f.requests).toHaveLength(2);
    for (const request of f.requests) {
      expect(request.model).toBe("test-upstream");
      expect(request.tool_choice).toBe("none");
      expect(request.tools).toBeUndefined();
      expect(request.response_format?.type).toBe("json_object");
    }
    expect(f.deps.budget.reserve).toHaveBeenCalledWith(3, 100);
    expect(f.settle).toHaveBeenCalledWith(1);
    const logged = JSON.stringify(f.deps.audit.mock.calls);
    expect(logged).toContain("request-trace");
    expect(logged).not.toContain("https:");
    expect(logged).not.toContain("a bag");
    expect(logged).not.toContain(p.email);
    expect(await f.deps.limiter.inFlight(expect.any(String))).toBe(0);
  });

  it("returns empty when there is no relevant product rather than forcing a result", async () => {
    const f = fixture([{ isProduct: false, keywords: [], description: "" }]);
    expect((await f.service.search(p, { fileId })).products).toEqual([]);
    expect(f.requests).toHaveLength(1);
    const g = fixture([{ isProduct: true, keywords: ["airplane"], description: "airplane" }]);
    expect((await g.service.search(p, { fileId })).products).toEqual([]);
    expect(g.requests).toHaveLength(1);
  });

  it("rejects invented or duplicate candidate ids and JSON containing invented URLs", async () => {
    for (const ranking of [
      { ids: ["invented"] },
      { ids: [productId, productId] },
      { ids: [productId], url: "https://fake.test/buy" },
    ]) {
      const f = fixture([description, ranking]);
      await expect(f.service.search(p, { fileId })).rejects.toMatchObject({ status: 502 });
      expect(f.settle).not.toHaveBeenCalled();
    }
  });

  it("re-reads current catalog and does not return newly unavailable or changed-image products", async () => {
    for (const products of [
      [],
      [{ ...product, stock: 0 }],
      [{ ...product, imageUrl: "https://media.test/new.png" }],
    ]) {
      const f = fixture();
      f.deps.catalog
        .mockResolvedValueOnce({ products: [product] })
        .mockResolvedValueOnce({ products });
      expect((await f.service.search(p, { fileId })).products).toEqual([]);
    }
    const f = fixture();
    f.deps.catalog
      .mockResolvedValueOnce({ products: [product] })
      .mockResolvedValueOnce({ products: [{ ...product, priceCents: 4500 }] });
    expect((await f.service.search(p, { fileId })).products[0]?.priceCents).toBe(4500);
  });

  it("does not send candidate images outside the approved media origin", async () => {
    const f = fixture();
    f.deps.catalog.mockResolvedValue({
      products: [{ ...product, imageUrl: "https://unapproved.test/tote.png" }],
    });
    expect((await f.service.search(p, { fileId })).products).toEqual([]);
    expect(f.requests).toHaveLength(0);
  });

  it("rebuilds the catalog index version after metadata or main-image changes", async () => {
    const first = fixture();
    const initial = await first.service.search(p, { fileId });
    for (const patch of [
      { name: "New canvas tote bag" },
      { imageUrl: "https://media.test/new.png" },
    ]) {
      const f = fixture();
      f.deps.catalog.mockResolvedValue({ products: [{ ...product, ...patch }] });
      const changed = await f.service.search(p, { fileId });
      expect(changed.indexVersion).not.toBe(initial.indexVersion);
      expect(changed.products[0]).toMatchObject(patch);
    }
  });

  it("rejects malformed JSON or overlong model responses without returning a partial result", async () => {
    for (const response of [
      "not JSON",
      "x".repeat(8193),
      { isProduct: true, keywords: [123], description: "bag" },
      { isProduct: true, keywords: [], description: "bag", tools: ["execute"] },
    ]) {
      const f = fixture([response]);
      await expect(f.service.search(p, { fileId })).rejects.toMatchObject({ status: 502 });
      expect(f.settle).not.toHaveBeenCalled();
    }
  });

  it("blocks unverified price, invalid budget and unsafe media configurations", async () => {
    for (const patch of [
      { inputUsdPerMillion: "0" },
      { inputUsdPerMillion: "-1" },
      { contextWindow: 0 },
      { dailyBudgetUsdCents: 0 },
      { mediaOrigin: "https://127.0.0.1" },
      { mediaOrigin: "http://media.test" },
    ]) {
      const f = fixture();
      f.deps.configuration.mockResolvedValue({ ...f.config, ...patch });
      await expect(f.service.search(p, { fileId })).rejects.toMatchObject({ status: 503 });
      expect(f.requests).toHaveLength(0);
    }
  });

  it("does not call AI after atomic platform budget rejection", async () => {
    const f = fixture();
    const reserve = vi.fn(async () => ({ accepted: false, settle: f.settle }));
    const service = new CommerceImageSearchService({ ...f.deps, budget: { reserve } });
    await expect(service.search(p, { fileId })).rejects.toMatchObject({ status: 429 });
    expect(f.requests).toHaveLength(0);
    expect(f.settle).not.toHaveBeenCalled();
  });

  it("applies user rate limits independently of AI credits or wallet balances", async () => {
    const f = fixture(Array.from({ length: 8 }, (_, i) => (i % 2 ? { ids: [] } : description)));
    for (let i = 0; i < 3; i++) await f.service.search(p, { fileId });
    await expect(f.service.search(p, { fileId })).rejects.toMatchObject({ status: 429 });
    expect(f.requests).toHaveLength(6);
    // The service has no ledger, credit account, or commission balance dependency.
    expect(Object.keys(f.deps)).not.toContain("ledger");
  });

  it("releases a user concurrency slot after provider failure", async () => {
    const f = fixture([new Error("provider offline"), description, { ids: [] }]);
    await expect(f.service.search(p, { fileId })).rejects.toMatchObject({ status: 502 });
    await expect(f.service.search(p, { fileId })).resolves.toMatchObject({ products: [] });
  });

  it("keeps the conservative platform reservation when the provider omits usage", async () => {
    const f = fixture();
    const provider: ProviderAdapter = {
      ...f.config.provider,
      async *chatStream() {
        yield {
          id: "usage-missing",
          delta: { content: JSON.stringify({ isProduct: false, keywords: [], description: "" }) },
          finish_reason: "stop",
        };
      },
    };
    f.deps.configuration.mockResolvedValue({ ...f.config, provider });
    await expect(f.service.search(p, { fileId })).resolves.toMatchObject({ products: [] });
    expect(f.settle).not.toHaveBeenCalled();
    expect(f.deps.audit).toHaveBeenCalledWith(
      expect.objectContaining({ reservedUsdCents: 3, estimatedUsdCents: 3, usageComplete: false }),
    );
  });

  it("rejects provider tool requests and truncated responses rather than executing or returning them", async () => {
    for (const finish_reason of ["tool_calls", "length"] as const) {
      const f = fixture();
      const provider: ProviderAdapter = {
        ...f.config.provider,
        async *chatStream() {
          yield { id: "refused", delta: { content: JSON.stringify(description) }, finish_reason };
        },
      };
      f.deps.configuration.mockResolvedValue({ ...f.config, provider });
      await expect(f.service.search(p, { fileId })).rejects.toMatchObject({ status: 502 });
      expect(f.settle).not.toHaveBeenCalled();
    }
  });

  it("blocks concurrent requests and releases the slot when the provider is aborted", async () => {
    const f = fixture();
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const controller = new AbortController();
    const provider: ProviderAdapter = {
      ...f.config.provider,
      async *chatStream(_request: ChatRequest, signal: AbortSignal) {
        entered();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        yield { id: "cancelled", delta: {}, finish_reason: null };
      },
    };
    const configuration = vi.fn(async () => ({ ...f.config, provider }));
    const service = new CommerceImageSearchService({ ...f.deps, configuration });
    const first = service.search(p, { fileId }, { signal: controller.signal });
    await waiting;
    await expect(service.search(p, { fileId })).rejects.toMatchObject({ status: 429 });
    controller.abort();
    await expect(first).rejects.toMatchObject({ status: 502 });
    configuration.mockResolvedValue(f.config);
    await expect(service.search(p, { fileId })).resolves.toMatchObject({ products: [product] });
  });
});

describe("image search production dependency guards", () => {
  it("never falls back to a generic AI file owned by the same buyer", async () => {
    const f = factoryFixture({ unavailableUpload: true });
    await expect(f.service.search(p, { fileId })).rejects.toMatchObject({ status: 404 });
    expect(f.findGenericFile).not.toHaveBeenCalled();
    expect(f.requests).toHaveLength(0);
  });

  it("uses the purpose-scoped upload resolver and returns an explicit similar result", async () => {
    const f = factoryFixture();
    await expect(f.service.search(p, { fileId })).resolves.toMatchObject({
      products: [],
      matchType: "similar",
      modelId: "vision",
    });
    expect(f.uploads.fileUrl).toHaveBeenCalledWith(p, fileId);
    expect(f.findGenericFile).not.toHaveBeenCalled();
    expect(f.requests).toHaveLength(0);
  });

  it("rejects unready vision/JSON models, unverified prices or missing keys before file access", async () => {
    for (const model of [
      { status: "disabled" },
      { capabilities: ["text.chat", "json"] },
      { capabilities: ["text.chat", "vision"] },
      { maxOutputTokens: 511 },
      { providerInputUsdPerMillion: "0" },
    ]) {
      const f = factoryFixture({ model });
      await expect(f.service.search(p, { fileId })).rejects.toMatchObject({ status: 503 });
      expect(f.uploads.fileUrl).not.toHaveBeenCalled();
      expect(f.requests).toHaveLength(0);
    }
    const f = factoryFixture({ env: { OPENAI_API_KEY: undefined } });
    await expect(f.service.search(p, { fileId })).rejects.toMatchObject({ status: 503 });
    expect(f.uploads.fileUrl).not.toHaveBeenCalled();
  });

  it("requires every explicit feature/pricing/evaluation gate and a credential-free HTTPS download", async () => {
    for (const key of [
      "DJL_COMMERCE_IMAGE_ENABLED",
      "DJL_COMMERCE_IMAGE_EVALUATION_APPROVED",
      "DJL_COMMERCE_IMAGE_PRICING_VERIFIED",
      "DJL_COMMERCE_IMAGE_STORAGE_LIFECYCLE_VERIFIED",
    ]) {
      const f = factoryFixture({ env: { [key]: "false" } });
      await expect(f.service.search(p, { fileId })).rejects.toMatchObject({ status: 503 });
      expect(f.findModel).not.toHaveBeenCalled();
    }
    for (const signedUrl of [
      "http://storage.test/private.png",
      "https://user:password@storage.test/private.png",
    ]) {
      const f = factoryFixture({ signedUrl });
      await expect(f.service.search(p, { fileId })).rejects.toMatchObject({ status: 503 });
      expect(f.requests).toHaveLength(0);
    }
  });
});

describe("Redis platform budget adapter", () => {
  it("uses a single atomic daily-cap reservation and an idempotent reservation-specific settlement", async () => {
    const evalMock = vi.fn(async () => 1);
    const budget = createRedisCommerceImageBudget({ eval: evalMock } as never);
    const hold = await budget.reserve(3, 100);
    expect(hold.accepted).toBe(true);
    await hold.settle(1);
    const reserve = evalMock.mock.calls[0] as unknown as [
      string,
      number,
      string,
      string,
      number,
      number,
    ];
    const settle = evalMock.mock.calls[1] as unknown as [string, number, string, string, number];
    expect(reserve[0]).toContain("INCRBY");
    expect(reserve[0]).toContain("used > limit - amount");
    expect(reserve[1]).toBe(2);
    expect(settle[2]).toBe(reserve[2]);
    expect(settle[3]).toBe(reserve[3]);
    expect(settle[0]).toContain("DEL");
    expect(settle[0]).toContain("not held or not used");
    expect(settle[0]).toContain("amount > tonumber(used)");
    await expect(hold.settle(4)).rejects.toMatchObject({ status: 502 });
  });
});
