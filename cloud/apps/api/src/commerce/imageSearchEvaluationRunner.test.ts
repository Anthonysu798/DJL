import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { DjlDatabase } from "@djl/db";
import type { ChatRequest, ProviderAdapter } from "@djl/providers";
import type { CommerceProduct } from "@synara/contracts/cloud";
import type { Principal } from "../auth/guard.ts";
import { createMemoryRateLimiter } from "../gateway/RateLimiter.ts";
import { ApiError } from "../http/errors.ts";
import { BlobReadLimitError } from "../sync/BlobStore.ts";
import { commerceImageUploadKey } from "./CommerceImageUploads.ts";
import {
  parseCommerceImageEvaluationManifest,
  runCommerceImageEvaluation,
  validateCommerceImageEvaluationEnvironment,
} from "./imageSearchEvaluationRunner.ts";

const env = {
  DJL_ENV: "test",
  DATABASE_URL: "postgres://test:test@127.0.0.1:54329/djl_commerce_eval_unit",
  REDIS_URL: "redis://127.0.0.1:63799/0",
  DJL_COMMERCE_IMAGE_ENABLED: "false",
  DJL_COMMERCE_IMAGE_EVALUATION_APPROVED: "false",
  DJL_COMMERCE_IMAGE_PRICING_VERIFIED: "true",
  DJL_COMMERCE_IMAGE_MODEL: "vision-eval",
  DJL_COMMERCE_IMAGE_DAILY_BUDGET_USD_CENTS: "1000",
  DJL_COMMERCE_MEDIA_ORIGIN: "https://media.test",
  OPENAI_API_KEY: "unit-test-placeholder-not-real",
};

function parameterId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const part = value as { value?: unknown; queryChunks?: unknown[] };
  if (typeof part.value === "string" && /^[0-9a-f-]{36}$/i.test(part.value)) return part.value;
  return part.queryChunks?.map(parameterId).find(Boolean);
}

function fixture() {
  const product: CommerceProduct = {
    id: randomUUID(),
    sku: "EVAL-TOTE",
    name: "Canvas tote",
    description: "Canvas tote bag",
    category: "Bags",
    imageUrl: "https://media.test/tote.png",
    priceCents: 3900,
    stock: 1000,
    commissionBps: 1000,
    returnDays: 30,
  };
  const owners = Array.from({ length: 8 }, (_, index) => ({
    id: index === 0 ? "abcdef00-0000-4000-8000-000000000000" : randomUUID(),
    org: randomUUID(),
    email: `eval-${index}@test.invalid`,
    name: `Commerce evaluation: fixture-${index}`,
    emailVerified: true,
    banned: false,
  }));
  // Synthetic byte signatures only test checksum/control flow; these are NOT a real accuracy cohort.
  const cases = Array.from({ length: 150 }, (_, index) => ({
    caseId: `case-${index}`,
    fileId: randomUUID(),
    ownerUserId: owners[index % owners.length]!.id,
    kind: index < 100 ? ("in_catalog" as const) : ("out_of_catalog" as const),
    expectedProductIds: index < 100 ? [product.id] : [],
  }));
  const manifest = {
    schemaVersion: 1,
    runId: randomUUID(),
    consent: {
      purpose: "commerce-image-benchmark",
      fixturePermissionConfirmed: true,
      platformSpendApproved: true,
      budgetUsdCents: 450,
      ownerUserIds: owners.map((owner) => owner.id),
    },
    cases,
  };
  const bytes = new Map<string, Uint8Array>();
  const files = cases.map((entry, index) => {
    const key = commerceImageUploadKey(entry.fileId, "ready");
    const content = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, index]);
    bytes.set(key, content);
    return {
      id: entry.fileId,
      userId: entry.ownerUserId,
      expiresAt: new Date(30 * 60_000),
      mimeType: "image/png",
      sha256: createHash("sha256").update(content).digest("hex"),
      storageKey: key,
      sizeBytes: content.byteLength,
    };
  });
  const controls = {
    providerFailure: false,
    missingUsage: false,
    noMatches: false,
    modelDrift: false,
    catalogDrift: false,
    corruptOnExecution: false,
    identityDrift: false,
    finalDrift: "",
    providerLatencyMs: 0,
  };
  let clock = 0,
    modelReads = 0,
    catalogReads = 0,
    userReads = 0,
    dailyUsed = 0;
  const model = {
    modelId: "vision-eval",
    provider: "openai",
    upstreamModelId: "test-vision",
    status: "active",
    capabilities: ["text.chat", "vision", "json"],
    contextWindow: 10000,
    maxOutputTokens: 512,
    providerInputUsdPerMillion: "1",
    providerOutputUsdPerMillion: "2",
  };
  const findUser = vi.fn(async ({ where }: { where: unknown }) => {
    userReads++;
    const owner = owners.find((owner) => owner.id === parameterId(where));
    return owner && controls.identityDrift && userReads > 8 ? { ...owner, banned: true } : owner;
  });
  const db = {
    execute: vi.fn(async () => [{ name: "djl_commerce_eval_unit" }]),
    query: {
      user: { findFirst: findUser },
      modelCatalog: {
        findFirst: vi.fn(async () => {
          modelReads++;
          return controls.modelDrift && modelReads > 1
            ? { ...model, providerInputUsdPerMillion: "3" }
            : model;
        }),
      },
    },
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: async (where: unknown) => {
            const owner = owners.find((entry) => entry.id === parameterId(where));
            return owner ? [{ orgId: owner.org }] : [];
          },
        }),
      }),
    }),
  } as unknown as DjlDatabase;
  const holds = new Map<string, number>(),
    claims = new Set<string>();
  const caseStarts: { ownerId: string; at: number }[] = [];
  const redisEval = vi.fn(
    async (
      script: string,
      count: number,
      key: string,
      next: string,
      amount?: number,
      maximum?: number,
    ) => {
      if (count === 1) {
        if (claims.has(key)) return 0;
        claims.add(key);
        return 1;
      }
      if (script.includes("INCRBY")) {
        if (dailyUsed > maximum! - amount!) return 0;
        dailyUsed += amount!;
        holds.set(next, amount!);
        return 1;
      }
      const reserved = holds.get(next);
      if (reserved !== undefined) {
        dailyUsed -= reserved - amount!;
        holds.delete(next);
      }
      return 1;
    },
  );
  const chatStream = vi.fn(async function* (request: ChatRequest) {
    if (controls.providerFailure) throw new Error("sensitive provider response must not be logged");
    const content = request.messages[1]!.content;
    const ref = Array.isArray(content)
      ? content.find((part) => part.type === "image_url")
      : undefined;
    const fileId = ref?.type === "image_url" ? new URL(ref.image_url.url).pathname.slice(1) : "";
    const entry = cases.find((candidate) => candidate.fileId === fileId)!;
    const describing = String(request.messages[0]!.content).startsWith("Describe only");
    if (describing) caseStarts.push({ ownerId: entry.ownerUserId, at: clock });
    clock += controls.providerLatencyMs;
    const output = describing
      ? {
          isProduct: !controls.noMatches && entry.kind === "in_catalog",
          keywords: ["canvas", "tote"],
          description: "Canvas tote bag",
        }
      : { ids: [product.id] };
    yield {
      id: "synthetic-unit-provider",
      delta: { content: JSON.stringify(output) },
      finish_reason: "stop" as const,
      ...(controls.missingUsage
        ? {}
        : { usage: { input_tokens: 100, output_tokens: 10, cached_input_tokens: 0 } }),
    };
    if (entry.caseId === cases.at(-1)!.caseId) {
      if (controls.finalDrift === "catalog") controls.catalogDrift = true;
      if (controls.finalDrift === "model") controls.modelDrift = true;
    }
  });
  const provider: ProviderAdapter = {
    id: "openai",
    chatStream,
    async embed() {
      throw new Error("not used");
    },
    async editImage() {
      throw new Error("not used");
    },
    async generateImage() {
      throw new Error("not used");
    },
  };
  const readCounts = new Map<string, number>();
  const read = vi.fn(async (key: string, maxBytes?: number) => {
    const count = (readCounts.get(key) ?? 0) + 1;
    readCounts.set(key, count);
    const payload =
      controls.corruptOnExecution && count > 1 ? new Uint8Array([0]) : (bytes.get(key) ?? null);
    if (payload && maxBytes !== undefined && payload.byteLength > maxBytes)
      throw new BlobReadLimitError();
    return payload;
  });
  const catalog = vi.fn(async () => {
    catalogReads++;
    return {
      products: [
        {
          ...product,
          ...(controls.catalogDrift && catalogReads > 1
            ? { description: "Changed description" }
            : {}),
        },
      ],
      mode: "disabled" as const,
      currency: "CAD" as const,
    };
  });
  const input = {
    db,
    commerce: { catalogSnapshot: catalog },
    uploads: {
      readyPhoto: vi.fn(async (p: Pick<Principal, "userId">, id: string) => {
        const row = files.find((file) => file.userId === p.userId && file.id === id);
        if (!row || row.expiresAt.getTime() <= clock)
          throw new ApiError(404, "file_unavailable", "Image is unavailable.");
        return row;
      }),
      fileUrl: vi.fn(
        async (_p: Pick<Principal, "userId">, id: string) => `https://storage.test/${id}`,
      ),
    },
    providers: { openai: provider },
    limiter: createMemoryRateLimiter(() => clock),
    redis: { eval: redisEval } as never,
    mockExternals: false,
    environment: "test",
    processEnv: { ...env },
    blobs: { read },
    manifest,
    execute: false,
    maxCostUsdCents: 450,
    now: () => clock,
    wait: vi.fn(async (milliseconds: number) => {
      clock += milliseconds;
    }),
  };
  const lock = (forManifest = manifest) => {
    const plan = parseCommerceImageEvaluationManifest(forManifest, input.maxCostUsdCents);
    return {
      schemaVersion: 1,
      runId: plan.runId,
      manifestSha256: plan.digest,
      files: files.map(({ id, sha256, sizeBytes, mimeType }) => ({
        fileId: id,
        sha256,
        sizeBytes,
        mimeType,
      })),
    };
  };
  return {
    input,
    controls,
    cases,
    owners,
    files,
    bytes,
    chatStream,
    read,
    redisEval,
    claims,
    caseStarts,
    lock,
    execute: (forManifest = manifest) =>
      runCommerceImageEvaluation({
        ...input,
        manifest: forManifest,
        corpusLock: lock(forManifest),
        execute: true,
      }),
    getDailyUsed: () => dailyUsed,
  };
}

describe("controlled offline commerce image evaluation", () => {
  it("requires a matching corpus lock at the direct execute boundary before any IO", async () => {
    const f = fixture();
    for (const corpusLock of [undefined, { ...f.lock(), manifestSha256: "1".repeat(64) }]) {
      await expect(
        runCommerceImageEvaluation({ ...f.input, corpusLock, execute: true }),
      ).rejects.toMatchObject({
        code: corpusLock ? "evaluation_corpus_invalid" : "evaluation_corpus_required",
      });
    }
    expect(f.input.db.execute).not.toHaveBeenCalled();
    expect(f.input.commerce.catalogSnapshot).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.redisEval).not.toHaveBeenCalled();
    expect(f.chatStream).not.toHaveBeenCalled();
  });

  it("rejects alternate UUID spellings and coercible labels before any IO", async () => {
    const f = fixture();
    const manifest = f.input.manifest;
    const upper = f.owners[0]!.id.toUpperCase();
    const otherLabels = [...manifest.cases];
    const replaced = { ...otherLabels.at(-1)!, kind: ["out_of_catalog"] };
    for (const candidate of [
      { ...manifest, runId: upper },
      {
        ...manifest,
        consent: { ...manifest.consent, ownerUserIds: [...manifest.consent.ownerUserIds, upper] },
        cases: [{ ...manifest.cases[0]!, ownerUserId: upper }, ...manifest.cases.slice(1)],
      },
      { ...manifest, cases: [...otherLabels.slice(0, -1), replaced] },
    ]) {
      await expect(
        runCommerceImageEvaluation({ ...f.input, manifest: candidate }),
      ).rejects.toMatchObject({
        code: "evaluation_manifest_invalid",
      });
    }
    expect(f.input.db.execute).not.toHaveBeenCalled();
    expect(f.chatStream).not.toHaveBeenCalled();
  });

  it("refuses a corpus that cannot survive even the minimum 150-case schedule", async () => {
    const f = fixture();
    f.files.at(-1)!.expiresAt = new Date(60_000);
    await expect(
      runCommerceImageEvaluation({ ...f.input, corpusLock: f.lock(), execute: true }),
    ).rejects.toMatchObject({
      code: "evaluation_file_lifetime_insufficient",
    });
    expect(f.redisEval).not.toHaveBeenCalled();
    expect(f.chatStream).not.toHaveBeenCalled();
  });
  it("uses the same explicit web-base media mapping for evaluation ground truth without calling inference", async () => {
    const f = fixture();
    f.input.processEnv.DJL_COMMERCE_MEDIA_ORIGIN = "https://media.test/";
    const catalog = await f.input.commerce.catalogSnapshot();
    f.input.commerce.catalogSnapshot.mockResolvedValue({
      ...catalog,
      products: catalog.products.map((product) =>
        Object.assign({}, product, { imageUrl: "/shop/media/tote.png" }),
      ),
    });
    for (const webPublicUrl of ["https://media.test", "https://different-web.test"])
      expect((await runCommerceImageEvaluation({ ...f.input, webPublicUrl })).status).toBe(
        "dry_run",
      );
    expect(f.chatStream).not.toHaveBeenCalled();
    await expect(runCommerceImageEvaluation(f.input)).rejects.toMatchObject({
      code: "evaluation_ground_truth_invalid",
    });
    expect(f.chatStream).not.toHaveBeenCalled();
  });

  it("admits only explicit loopback isolated local/test stores without host override query options", () => {
    expect(validateCommerceImageEvaluationEnvironment(env)).toEqual({
      databaseName: "djl_commerce_eval_unit",
    });
    expect(
      validateCommerceImageEvaluationEnvironment({ ...env, REDIS_URL: "redis://127.0.0.1:63799" }),
    ).toEqual({ databaseName: "djl_commerce_eval_unit" });
    for (const patch of [
      { DJL_ENV: "production" },
      { DJL_ENV: "staging" },
      { DJL_ENV: undefined },
      { DATABASE_URL: "postgres://test:test@db.example/djl_commerce_eval_unit" },
      { DATABASE_URL: "postgres://test:test@127.0.0.1:54329/production" },
      { DATABASE_URL: "postgres://test:test@127.0.0.1/djl_commerce_eval_unit" },
      { DATABASE_URL: "postgres://test:test@[::1]:54329/djl_commerce_eval_unit" },
      { DATABASE_URL: `${env.DATABASE_URL}?host=elsewhere` },
      { REDIS_URL: "redis://elsewhere:6379" },
    ])
      expect(() => validateCommerceImageEvaluationEnvironment({ ...env, ...patch })).toThrow();
  });

  it("rejects PostgreSQL authority strings whose driver could choose a different host", () => {
    const dsn =
      "postgres://qa:synthetic@192.0.2.123:5432,decoy@127.0.0.1:54329/djl_commerce_eval_unit";
    expect(new URL(dsn).hostname).toBe("127.0.0.1");
    expect(() =>
      validateCommerceImageEvaluationEnvironment({ ...env, DATABASE_URL: dsn }),
    ).toThrow();
    expect(
      validateCommerceImageEvaluationEnvironment({
        ...env,
        DATABASE_URL: "postgres://qa:%40@127.0.0.1:54329/djl_commerce_eval_unit",
      }),
    ).toEqual({ databaseName: "djl_commerce_eval_unit" });
  });

  it("dry-runs the real dependency guards with public rollout flags OFF and spends nothing", async () => {
    const f = fixture();
    const report = await runCommerceImageEvaluation(f.input);
    expect(report).toMatchObject({
      status: "dry_run",
      completedCases: 0,
      evaluation: null,
      worstCaseInferenceUsdCents: 450,
      estimatedInferenceUsdCents: 0,
    });
    expect(f.chatStream).not.toHaveBeenCalled();
    expect(f.redisEval).not.toHaveBeenCalled();
    expect(f.read).toHaveBeenCalledTimes(150);
    expect(f.input.processEnv.DJL_COMMERCE_IMAGE_EVALUATION_APPROVED).toBe("false");
    expect(JSON.stringify(report)).not.toMatch(/https:|@test.invalid|placeholder/);
  });

  it("checks the private corpus lock against the actual ready photo metadata and bytes before spending", async () => {
    const f = fixture();
    const plan = parseCommerceImageEvaluationManifest(f.input.manifest, f.input.maxCostUsdCents);
    const lock = {
      schemaVersion: 1,
      runId: plan.runId,
      manifestSha256: plan.digest,
      files: f.files.map(({ id, sha256, sizeBytes, mimeType }) => ({
        fileId: id,
        sha256,
        sizeBytes,
        mimeType,
      })),
    };
    await expect(
      runCommerceImageEvaluation({ ...f.input, corpusLock: lock }),
    ).resolves.toMatchObject({ status: "dry_run" });
    const good = f.files[0]!;
    const replacement = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
    f.bytes.set(good.storageKey, replacement);
    good.sha256 = createHash("sha256").update(replacement).digest("hex");
    good.sizeBytes = replacement.byteLength;
    await expect(
      runCommerceImageEvaluation({ ...f.input, corpusLock: lock, execute: true }),
    ).rejects.toMatchObject({ code: "evaluation_file_invalid" });
    expect(f.redisEval).not.toHaveBeenCalled();
    expect(f.chatStream).not.toHaveBeenCalled();
  });

  it("bounds each ready object by locked metadata before claiming the run or calling inference", async () => {
    const f = fixture();
    const first = f.files[0]!;
    f.bytes.set(first.storageKey, new Uint8Array(first.sizeBytes + 1));
    await expect(f.execute()).rejects.toMatchObject({ code: "evaluation_file_hash_mismatch" });
    expect(f.read).toHaveBeenCalledExactlyOnceWith(first.storageKey, first.sizeBytes);
    expect(f.redisEval).not.toHaveBeenCalled();
    expect(f.chatStream).not.toHaveBeenCalled();
  });

  it("refuses insufficient per-run bound, mock providers, unverified pricing and automatic retries before inference", async () => {
    for (const patch of [
      { mockExternals: true },
      { maxCostUsdCents: 449 },
      { processEnv: { ...env, DJL_COMMERCE_IMAGE_PRICING_VERIFIED: "false" } },
      { processEnv: { ...env, OPENAI_API_KEY_FALLBACK: "not-real" } },
    ]) {
      const f = fixture();
      const manifest = patch.maxCostUsdCents
        ? {
            ...f.input.manifest,
            consent: { ...f.input.manifest.consent, budgetUsdCents: patch.maxCostUsdCents },
          }
        : f.input.manifest;
      await expect(
        runCommerceImageEvaluation({ ...f.input, ...patch, manifest }),
      ).rejects.toMatchObject({ status: 400 });
      expect(f.chatStream).not.toHaveBeenCalled();
      expect(f.redisEval).not.toHaveBeenCalled();
    }
  });

  it("requires declared permission/cost consent and the unmodified 20-per-user quota plan", async () => {
    const f = fixture();
    await expect(
      runCommerceImageEvaluation({
        ...f.input,
        manifest: {
          ...f.input.manifest,
          consent: { ...f.input.manifest.consent, fixturePermissionConfirmed: false },
        },
      }),
    ).rejects.toMatchObject({ code: "evaluation_consent_required" });
    await expect(
      runCommerceImageEvaluation({
        ...f.input,
        manifest: {
          ...f.input.manifest,
          cases: f.cases.map((entry) => ({ ...entry, ownerUserId: f.owners[0]!.id })),
        },
      }),
    ).rejects.toMatchObject({ code: "evaluation_quota_plan_invalid" });
    expect(f.chatStream).not.toHaveBeenCalled();
  });

  it("derives verified dedicated test identities and rejects foreign/unready/mismatched/duplicate images", async () => {
    for (const change of [
      "unverified",
      "not-dedicated",
      "wrong-owner",
      "bad-hash",
      "duplicate",
    ] as const) {
      const f = fixture();
      if (change === "unverified") f.owners[0]!.emailVerified = false;
      if (change === "not-dedicated") f.owners[0]!.name = "Real shopper";
      if (change === "wrong-owner") f.files[0]!.userId = f.owners[1]!.id;
      if (change === "bad-hash") f.bytes.set(f.files[0]!.storageKey, new Uint8Array([0]));
      if (change === "duplicate") {
        f.files[1]!.sha256 = f.files[0]!.sha256;
        f.bytes.set(f.files[1]!.storageKey, f.bytes.get(f.files[0]!.storageKey)!);
      }
      await expect(runCommerceImageEvaluation(f.input)).rejects.toMatchObject({ status: 400 });
      expect(f.chatStream).not.toHaveBeenCalled();
      expect(f.redisEval).not.toHaveBeenCalled();
    }
  });

  it("runs only the genuine pipeline with unchanged quota keys and one global reservation per image", async () => {
    const f = fixture();
    // Even owner-grouped input interleaves on execution; report order stays as approved.
    const manifest = {
      ...f.input.manifest,
      cases: f.owners.flatMap((owner) => f.cases.filter((entry) => entry.ownerUserId === owner.id)),
    };
    const report = await f.execute(manifest);
    expect(report).toMatchObject({
      status: "completed",
      completedCases: 150,
      estimatedInferenceUsdCents: 150,
      evaluation: { passed: true, top5HitRate: 1, noResultAccuracy: 1 },
    });
    expect(f.chatStream).toHaveBeenCalledTimes(250);
    expect(f.getDailyUsed()).toBe(150);
    expect(f.input.wait).toHaveBeenCalledTimes(18);
    expect(f.caseStarts.slice(0, 8).map(({ ownerId }) => ownerId)).toEqual(
      f.owners.map(({ id }) => id),
    );
    expect(f.caseStarts.at(-1)?.at).toBe(18 * 20_100);
    const previous = new Map<string, number>();
    for (const { ownerId, at } of f.caseStarts) {
      if (previous.has(ownerId)) expect(at - previous.get(ownerId)!).toBeGreaterThanOrEqual(20_100);
      previous.set(ownerId, at);
    }
    expect(report.evaluation?.results.map(({ caseId }) => caseId)).toEqual(
      manifest.cases.map(({ caseId }) => caseId),
    );
    const reservations = f.redisEval.mock.calls.filter(([script]) => script.includes("INCRBY"));
    expect(reservations).toHaveLength(150);
    expect(new Set(reservations.map((call) => call[2])).size).toBe(1);
    expect(
      reservations.every((call) => /^commerce:image:usd:\d{4}-\d{2}-\d{2}$/.test(call[2])),
    ).toBe(true);
    expect(JSON.stringify(f.chatStream.mock.calls)).not.toMatch(
      /expectedProductIds|ownerUserId|in_catalog|out_of_catalog/,
    );
    expect(f.input.processEnv.DJL_COMMERCE_IMAGE_ENABLED).toBe("false");
    expect(f.input.processEnv.DJL_COMMERCE_IMAGE_EVALUATION_APPROVED).toBe("false");
    const logged = JSON.stringify(report);
    expect(logged).not.toMatch(/https:|@test.invalid|placeholder/);
    // Quality numbers above are synthetic fixture tests, NOT a measured product retrieval result.
  });

  it("stops spending when a slow first search makes the remaining schedule impossible", async () => {
    const f = fixture();
    f.files.at(-1)!.expiresAt = new Date(370_000);
    f.controls.providerLatencyMs = 5000;
    expect(await f.execute()).toMatchObject({
      status: "failed",
      completedCases: 1,
      estimatedInferenceUsdCents: 1,
      evaluation: null,
      errorCode: "evaluation_file_lifetime_insufficient",
    });
    expect(f.chatStream).toHaveBeenCalledTimes(2);
    expect(f.getDailyUsed()).toBe(1);
    expect(f.input.wait).not.toHaveBeenCalled();
  });

  it("does not replay an execute run ID after any prior claim", async () => {
    const f = fixture();
    f.claims.add(`commerce:image:evaluation-run:${f.input.manifest.runId}`);
    await expect(f.execute()).rejects.toMatchObject({
      code: "evaluation_run_already_claimed",
    });
    expect(f.chatStream).not.toHaveBeenCalled();
  });

  it("rejects model/catalog/file drift before a provider call and reports no inference spend", async () => {
    for (const control of ["modelDrift", "catalogDrift", "corruptOnExecution"] as const) {
      const f = fixture();
      f.controls[control] = true;
      const report = await f.execute();
      expect(report).toMatchObject({
        status: "failed",
        completedCases: 0,
        estimatedInferenceUsdCents: 0,
        evaluation: null,
      });
      expect(f.chatStream).not.toHaveBeenCalled();
    }
  });

  it("does not evade an already-used daily user quota or a rejected shared global budget", async () => {
    const used = fixture();
    const key = `commerce:image:${createHash("sha256").update(used.cases[0]!.ownerUserId).digest("hex")}:day`;
    for (let index = 0; index < 20; index++) await used.input.limiter.hit(key, 20, 86400);
    expect(await used.execute()).toMatchObject({
      status: "failed",
      errorCode: "image_search_limit",
      estimatedInferenceUsdCents: 0,
    });
    expect(used.chatStream).not.toHaveBeenCalled();
    const denied = fixture();
    denied.redisEval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await denied.execute()).toMatchObject({
      status: "failed",
      errorCode: "image_search_limit",
      estimatedInferenceUsdCents: 0,
    });
    expect(denied.chatStream).not.toHaveBeenCalled();
  });

  it("rechecks current account verification and membership before executing each image", async () => {
    const f = fixture();
    f.controls.identityDrift = true;
    expect(await f.execute()).toMatchObject({
      status: "failed",
      errorCode: "evaluation_test_user_required",
      estimatedInferenceUsdCents: 0,
    });
    expect(f.chatStream).not.toHaveBeenCalled();
  });

  it("stops after a failed/unknown-usage request, retaining only its same global conservative hold", async () => {
    for (const control of ["providerFailure", "missingUsage"] as const) {
      const f = fixture();
      f.controls[control] = true;
      const report = await f.execute();
      expect(report).toMatchObject({
        status: "failed",
        completedCases: 0,
        estimatedInferenceUsdCents: 3,
        evaluation: null,
      });
      expect(f.getDailyUsed()).toBe(3);
      expect(f.chatStream.mock.calls.length).toBeLessThanOrEqual(2);
      expect(JSON.stringify(report)).not.toContain("sensitive provider");
    }
  });

  it("rejects model or index changes during the final empty-result inference before approving metrics", async () => {
    for (const kind of ["catalog", "model"]) {
      const f = fixture();
      f.controls.finalDrift = kind;
      expect(await f.execute()).toMatchObject({
        status: "failed",
        completedCases: 150,
        evaluation: null,
        errorCode: `evaluation_${kind}_drift`,
      });
      expect(f.chatStream).toHaveBeenCalledTimes(250);
    }
  });

  it("returns a failed quality gate rather than approving a completed but inaccurate run", async () => {
    const f = fixture();
    f.controls.noMatches = true;
    const report = await f.execute();
    expect(report).toMatchObject({
      status: "failed",
      completedCases: 150,
      errorCode: "evaluation_quality_below_target",
      evaluation: { passed: false, top5HitRate: 0 },
    });
  });
});
