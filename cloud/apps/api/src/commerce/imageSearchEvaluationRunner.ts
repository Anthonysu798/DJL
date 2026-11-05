import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { and, eq, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import type { CommerceImageSearchResult } from "@synara/contracts/cloud";
import type { Principal } from "../auth/guard.ts";
import { PERSONAL_ORG_METADATA } from "../auth/auth.ts";
import { bytesMatchType } from "../files/fileTypes.ts";
import { ApiError } from "../http/errors.ts";
import { BlobReadLimitError, type BlobStore } from "../sync/BlobStore.ts";
import { commerceImageUploadKey, type CommerceImageUploads } from "./CommerceImageUploads.ts";
import type { CommerceService } from "./CommerceService.ts";
import { readCommerceImageCorpusLock } from "./imageSearchCorpus.ts";
import {
  CommerceImageSearchService,
  commerceImageCatalogVersion,
  commerceImageMediaUrl,
  commerceImageSearchDependencies,
  commerceImageWorstCaseCents,
  type CommerceImageRuntimeInput,
  type ImageSearchConfiguration,
} from "./ImageSearchService.ts";
import {
  evaluateCommerceImageSearch,
  type CommerceImageEvaluationCase,
  type CommerceImageEvaluationReport,
} from "./imageSearchEvaluation.ts";

// PostgreSQL UUID comparison ignores case but Redis keys do not.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OWNER_PAUSE_MS = 20_100;
// Shop signing leaves one full second of margin after rounding down.
const SIGNING_MARGIN_MS = 2_000;
const reject = (code: string): never => {
  throw new ApiError(
    400,
    code,
    "Image evaluation preflight failed. Review the isolated test configuration and consent manifest.",
  );
};
const yes = (value: string | undefined) => value === "true" || value === "1";
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return reject("evaluation_manifest_invalid");
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, names: readonly string[]) {
  if (Object.keys(value).length !== names.length || names.some((name) => !(name in value)))
    reject("evaluation_manifest_invalid");
}
function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) return reject("evaluation_manifest_invalid");
  return value;
}

function evaluationEndpoint(value: string | undefined, protocols: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    return reject("evaluation_environment_forbidden");
  }
  if (
    value !== url.href ||
    !protocols.includes(url.protocol) ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.search ||
    url.hash
  )
    return reject("evaluation_environment_forbidden");
  return url;
}

/** No production/staging, forwarded-host query options or remote databases. */
export function validateCommerceImageEvaluationDatabase(env: NodeJS.ProcessEnv): string {
  if (env.DJL_ENV !== "local" && env.DJL_ENV !== "test")
    return reject("evaluation_environment_forbidden");
  const database = evaluationEndpoint(env.DATABASE_URL, ["postgres:", "postgresql:"]);
  // The pinned postgres.js splits host on colons. Admit only a canonical IPv4
  // authority and explicit port rather than using its multihost/PGPORT fallback.
  if (database.hostname !== "127.0.0.1" || !database.port)
    return reject("evaluation_environment_forbidden");
  const databaseName = database.pathname.slice(1);
  if (!/^djl_commerce_eval_[a-z0-9_]{1,48}$/.test(databaseName))
    return reject("evaluation_database_forbidden");
  return databaseName;
}

/** Call before opening clients. Staging does not connect to Redis at all. */
export function validateCommerceImageEvaluationEnvironment(env: NodeJS.ProcessEnv): {
  databaseName: string;
} {
  const databaseName = validateCommerceImageEvaluationDatabase(env);
  const redis = evaluationEndpoint(env.REDIS_URL, ["redis:", "rediss:"]);
  if (!/^(?:\/\d*)?$/.test(redis.pathname)) return reject("evaluation_environment_forbidden");
  return { databaseName };
}

export async function loadCommerceImageEvaluationOwner(
  db: DjlDatabase,
  owner: string,
  runId: string,
): Promise<Principal> {
  const user = await db.query.user.findFirst({ where: eq(schema.user.id, owner) });
  if (
    !user ||
    !user.emailVerified ||
    user.banned ||
    !user.email.endsWith("@test.invalid") ||
    !user.name.startsWith("Commerce evaluation:")
  )
    return reject("evaluation_test_user_required");
  const personal = await db
    .select({ orgId: schema.organization.id })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(
      and(eq(schema.member.userId, owner), eq(schema.organization.metadata, PERSONAL_ORG_METADATA)),
    );
  if (personal.length !== 1) return reject("evaluation_personal_org_invalid");
  const orgId = personal[0]!.orgId;
  return {
    userId: owner,
    email: user.email,
    emailVerified: true,
    banned: false,
    sessionId: `evaluation:${runId}`,
    orgId,
    personalOrgId: orgId,
    role: "member",
  };
}

interface EvaluationCase extends CommerceImageEvaluationCase {
  readonly ownerUserId: string;
}
interface ConsentManifest {
  readonly runId: string;
  readonly cases: readonly EvaluationCase[];
  readonly owners: readonly string[];
  readonly digest: string;
}
export function parseCommerceImageEvaluationManifest(raw: unknown, cap: number): ConsentManifest {
  if (!Number.isSafeInteger(cap) || cap < 1) return reject("evaluation_cost_cap_required");
  const manifest = object(raw);
  exactKeys(manifest, ["schemaVersion", "runId", "consent", "cases"]);
  if (
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.cases) ||
    manifest.cases.length !== 150
  )
    return reject("evaluation_manifest_invalid");
  const runId = uuid(manifest.runId);
  const consent = object(manifest.consent);
  exactKeys(consent, [
    "purpose",
    "fixturePermissionConfirmed",
    "platformSpendApproved",
    "budgetUsdCents",
    "ownerUserIds",
  ]);
  if (
    consent.purpose !== "commerce-image-benchmark" ||
    consent.fixturePermissionConfirmed !== true ||
    consent.platformSpendApproved !== true ||
    consent.budgetUsdCents !== cap ||
    !Array.isArray(consent.ownerUserIds)
  )
    return reject("evaluation_consent_required");
  const owners = consent.ownerUserIds.map(uuid);
  if (new Set(owners).size !== owners.length || owners.length < 8)
    return reject("evaluation_owners_invalid");
  const counts = new Map<string, number>();
  const caseIds = new Set<string>(),
    fileIds = new Set<string>();
  const cases = manifest.cases.map((rawCase): EvaluationCase => {
    const entry = object(rawCase);
    exactKeys(entry, ["caseId", "fileId", "ownerUserId", "kind", "expectedProductIds"]);
    const fileId = uuid(entry.fileId),
      ownerUserId = uuid(entry.ownerUserId),
      kind = entry.kind;
    if (
      typeof entry.caseId !== "string" ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(entry.caseId) ||
      caseIds.has(entry.caseId) ||
      fileIds.has(fileId) ||
      !owners.includes(ownerUserId) ||
      (kind !== "in_catalog" && kind !== "out_of_catalog") ||
      !Array.isArray(entry.expectedProductIds)
    )
      return reject("evaluation_manifest_invalid");
    const expectedProductIds = entry.expectedProductIds.map(uuid);
    if (
      new Set(expectedProductIds).size !== expectedProductIds.length ||
      (kind === "in_catalog" ? expectedProductIds.length === 0 : expectedProductIds.length !== 0)
    )
      return reject("evaluation_manifest_invalid");
    counts.set(ownerUserId, (counts.get(ownerUserId) ?? 0) + 1);
    caseIds.add(entry.caseId);
    fileIds.add(fileId);
    return {
      caseId: entry.caseId,
      fileId,
      ownerUserId,
      kind,
      expectedProductIds,
    };
  });
  if (
    counts.size !== owners.length ||
    [...counts.values()].some((count) => count > 20) ||
    cases.filter((entry) => entry.kind === "in_catalog").length !== 100
  )
    return reject("evaluation_quota_plan_invalid");
  return {
    runId,
    owners,
    cases,
    digest: createHash("sha256")
      .update(JSON.stringify({ ...manifest, cases }))
      .digest("hex"),
  };
}

function roundRobin(manifest: ConsentManifest): EvaluationCase[] {
  const buckets = new Map(manifest.owners.map((owner) => [owner, [] as EvaluationCase[]]));
  for (const entry of manifest.cases) buckets.get(entry.ownerUserId)!.push(entry);
  const ordered: EvaluationCase[] = [];
  for (let round = 0; ordered.length < manifest.cases.length; round++) {
    for (const bucket of buckets.values()) {
      const entry = bucket[round];
      if (entry) ordered.push(entry);
    }
  }
  return ordered;
}

/** Lower bound only: real provider and storage time is additional. */
function earliestFinish(
  cases: readonly EvaluationCase[],
  start: number,
  now: number,
  readyAt: ReadonlyMap<string, number>,
): number {
  const next = new Map(readyAt);
  let time = now;
  for (let i = start; i < cases.length; i++) {
    const owner = cases[i]!.ownerUserId;
    time = Math.max(time, next.get(owner) ?? now);
    next.set(owner, time + OWNER_PAUSE_MS);
  }
  return time;
}

export interface CommerceImageEvaluationRunReport {
  readonly runId: string;
  readonly status: "dry_run" | "completed" | "failed";
  readonly manifestSha256: string;
  readonly modelId: string;
  readonly indexVersion: string;
  readonly inputUsdPerMillion: string;
  readonly outputUsdPerMillion: string;
  readonly inferenceCostCapUsdCents: number;
  readonly worstCaseInferenceUsdCents: number;
  readonly estimatedInferenceUsdCents: number;
  readonly completedCases: number;
  readonly evaluation: CommerceImageEvaluationReport | null;
  readonly errorCode?: string;
}

const CLAIM_RUN = `if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1])
return 1`;

const configurationFingerprint = (value: ImageSearchConfiguration) =>
  JSON.stringify({
    modelId: value.modelId,
    upstreamModelId: value.upstreamModelId,
    provider: value.provider.id,
    contextWindow: value.contextWindow,
    input: value.inputUsdPerMillion,
    output: value.outputUsdPerMillion,
    daily: value.dailyBudgetUsdCents,
    media: value.mediaOrigin,
    web: value.webPublicUrl ?? null,
    api: value.apiPublicUrl ?? null,
  });

/** Report-only offline entry point. There is no HTTP option to select this execution purpose. */
export async function runCommerceImageEvaluation(
  input: Omit<CommerceImageRuntimeInput, "commerce"> & {
    readonly commerce: Pick<CommerceService, "catalogSnapshot">;
    readonly uploads: Pick<CommerceImageUploads, "fileUrl" | "readyPhoto">;
    readonly blobs: Pick<BlobStore, "read">;
    readonly manifest: unknown;
    readonly corpusLock?: unknown;
    readonly execute: boolean;
    readonly maxCostUsdCents: number;
    /** Virtual-clock injection for deterministic tests; real quotas still use their own clock. */
    readonly now?: () => number;
    readonly wait?: (milliseconds: number) => Promise<void>;
  },
): Promise<CommerceImageEvaluationRunReport> {
  const { databaseName } = validateCommerceImageEvaluationEnvironment(input.processEnv);
  if (
    input.environment !== input.processEnv.DJL_ENV ||
    input.mockExternals ||
    !yes(input.processEnv.DJL_COMMERCE_IMAGE_PRICING_VERIFIED)
  )
    return reject("evaluation_configuration_unverified");
  if (
    ["OPENAI_API_KEY_FALLBACK", "ANTHROPIC_API_KEY_FALLBACK", "OPENROUTER_API_KEY_FALLBACK"].some(
      (name) => input.processEnv[name]?.trim(),
    )
  )
    return reject("evaluation_automatic_retry_forbidden");
  const manifest = parseCommerceImageEvaluationManifest(input.manifest, input.maxCostUsdCents);
  if (input.execute && input.corpusLock === undefined) return reject("evaluation_corpus_required");
  const locked =
    input.corpusLock === undefined ? null : readCommerceImageCorpusLock(manifest, input.corpusLock);
  const ordered = roundRobin(manifest);
  const now = input.now ?? Date.now;
  const wait = input.wait ?? setTimeout;
  const ownerReadyAt = new Map<string, number>();
  let usableUntil = Infinity;
  const checkLifetime = (index: number) => {
    if (earliestFinish(ordered, index, now(), ownerReadyAt) >= usableUntil)
      return reject("evaluation_file_lifetime_insufficient");
  };
  const database = await input.db.execute<{ name: string }>(sql`select current_database() as name`);
  if (database[0]?.name !== databaseName) return reject("evaluation_database_forbidden");
  const deps = commerceImageSearchDependencies({
    ...input,
    commerce: { catalog: () => input.commerce.catalogSnapshot() },
  });
  const config = await deps.configuration();
  if (!config) return reject("evaluation_configuration_unverified");
  const reservation = commerceImageWorstCaseCents(config);
  const worst = reservation * manifest.cases.length;
  if (
    !Number.isSafeInteger(worst) ||
    worst > input.maxCostUsdCents ||
    worst > config.dailyBudgetUsdCents
  )
    return reject("evaluation_cost_cap_insufficient");
  const configurationVersion = configurationFingerprint(config);
  const catalog = await deps.catalog();
  const indexVersion = commerceImageCatalogVersion(
    catalog.products,
    config.mediaOrigin,
    config.webPublicUrl,
    config.apiPublicUrl,
  );
  const approvedProducts = new Set(
    catalog.products
      .filter(
        (product) =>
          product.stock > 0 &&
          commerceImageMediaUrl(
            product.imageUrl,
            config.mediaOrigin,
            config.webPublicUrl,
            config.apiPublicUrl,
          ),
      )
      .map((product) => product.id),
  );
  if (
    manifest.cases.some((entry) => entry.expectedProductIds.some((id) => !approvedProducts.has(id)))
  )
    return reject("evaluation_ground_truth_invalid");
  const principals = new Map<string, Principal>();
  const loadPrincipal = (owner: string) =>
    loadCommerceImageEvaluationOwner(input.db, owner, manifest.runId);
  for (const owner of manifest.owners) principals.set(owner, await loadPrincipal(owner));
  const hashes = new Map<string, string>();
  const uniqueHashes = new Set<string>();
  const verifyFile = async (p: Principal, id: string, expectedHash?: string) => {
    const file = await input.uploads
      .readyPhoto(p, id)
      .catch(() => reject("evaluation_file_invalid"));
    const pinned = locked?.get(id);
    const expiresAt = file.expiresAt.getTime();
    if (
      !file.sha256 ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      (expectedHash && expectedHash !== file.sha256) ||
      (pinned &&
        (file.sha256 !== pinned.sha256 ||
          file.mimeType !== pinned.mimeType ||
          file.sizeBytes !== pinned.sizeBytes)) ||
      file.storageKey !== commerceImageUploadKey(id, "ready") ||
      !Number.isFinite(expiresAt) ||
      file.sizeBytes < 1 ||
      file.sizeBytes > 10 * 1024 * 1024 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.mimeType)
    )
      return reject("evaluation_file_invalid");
    // The dedicated storage service independently rechecks ownership and expiry before HTTPS signing.
    await deps.fileUrl(p, id);
    const bytes = await input.blobs
      .read(file.storageKey, file.sizeBytes)
      .catch((error: unknown) => {
        if (error instanceof BlobReadLimitError) return reject("evaluation_file_hash_mismatch");
        throw error;
      });
    if (
      !bytes ||
      bytes.byteLength !== file.sizeBytes ||
      !bytesMatchType(file.mimeType, bytes) ||
      createHash("sha256").update(bytes).digest("hex") !== file.sha256
    )
      return reject("evaluation_file_hash_mismatch");
    usableUntil = Math.min(usableUntil, expiresAt - SIGNING_MARGIN_MS);
    return file.sha256;
  };
  for (const entry of manifest.cases) {
    const hash = await verifyFile(principals.get(entry.ownerUserId)!, entry.fileId);
    if (uniqueHashes.has(hash)) return reject("evaluation_duplicate_image");
    uniqueHashes.add(hash);
    hashes.set(entry.fileId, hash);
  }
  // Every input must remain verifiable through the end of the run. Reject
  // impossible cohorts before a Redis claim or any inference reservation.
  checkLifetime(0);
  let estimated = 0;
  const completed = new Map<string, CommerceImageSearchResult>();
  const report = (
    status: CommerceImageEvaluationRunReport["status"],
    evaluation: CommerceImageEvaluationReport | null,
    errorCode?: string,
  ): CommerceImageEvaluationRunReport => ({
    runId: manifest.runId,
    status,
    manifestSha256: manifest.digest,
    modelId: config.modelId,
    indexVersion,
    inputUsdPerMillion: config.inputUsdPerMillion,
    outputUsdPerMillion: config.outputUsdPerMillion,
    inferenceCostCapUsdCents: input.maxCostUsdCents,
    worstCaseInferenceUsdCents: worst,
    estimatedInferenceUsdCents: estimated,
    completedCases: completed.size,
    evaluation,
    ...(errorCode ? { errorCode } : {}),
  });
  if (!input.execute) return report("dry_run", null);
  // Only a run claim is separate: inference uses the SAME global daily reservation, once per real search.
  if (
    (await input.redis.eval(
      CLAIM_RUN,
      1,
      `commerce:image:evaluation-run:${manifest.runId}`,
      manifest.digest,
    )) !== 1
  )
    return reject("evaluation_run_already_claimed");
  let caseEstimate = 0,
    usageComplete = false,
    currentIndex = 0;
  const service = new CommerceImageSearchService({
    ...deps,
    enabled: true,
    budget: {
      async reserve(amount, dailyLimit) {
        const hold = await deps.budget.reserve(amount, dailyLimit);
        if (hold.accepted) caseEstimate = amount;
        return hold;
      },
    },
    async configuration() {
      const latest = await deps.configuration();
      if (!latest || configurationFingerprint(latest) !== configurationVersion)
        return reject("evaluation_model_drift");
      return latest;
    },
    async catalog() {
      const latest = await deps.catalog();
      if (
        commerceImageCatalogVersion(
          latest.products,
          config.mediaOrigin,
          config.webPublicUrl,
          config.apiPublicUrl,
        ) !== indexVersion
      )
        return reject("evaluation_catalog_drift");
      return latest;
    },
    async fileUrl(p, id) {
      const current = await loadPrincipal(p.userId);
      if (current.personalOrgId !== principals.get(p.userId)?.personalOrgId)
        return reject("evaluation_personal_org_invalid");
      await verifyFile(current, id, hashes.get(id));
      const url = await deps.fileUrl(current, id);
      checkLifetime(currentIndex); // model, DB and storage delays must not start new spend
      return url;
    },
    audit(event) {
      caseEstimate = event.estimatedUsdCents;
      usageComplete = event.usageComplete;
    },
  });
  try {
    for (const [index, entry] of ordered.entries()) {
      currentIndex = index;
      checkLifetime(index);
      const readyAt = ownerReadyAt.get(entry.ownerUserId);
      if (readyAt !== undefined) {
        for (let delay = readyAt - now(); delay > 0; delay = readyAt - now()) await wait(delay);
      }
      checkLifetime(index);
      caseEstimate = 0;
      usageComplete = false;
      let result: CommerceImageSearchResult;
      try {
        result = await service.search(
          principals.get(entry.ownerUserId)!,
          { fileId: entry.fileId },
          { traceId: `${manifest.runId}:${entry.caseId}` },
        );
      } finally {
        estimated += caseEstimate;
      }
      // Start-to-start separation is at least 20.1s even when the actual quota
      // check within the previous search occurred after a slow file verification.
      ownerReadyAt.set(entry.ownerUserId, now() + OWNER_PAUSE_MS);
      if (!usageComplete || result.indexVersion !== indexVersion)
        return report("failed", null, "evaluation_usage_or_index_unknown");
      completed.set(entry.fileId, result);
    }
    checkLifetime(ordered.length);
    // Catch changes made during the final provider call (including an empty-result short circuit).
    const finalConfiguration = await deps.configuration();
    if (
      !finalConfiguration ||
      configurationFingerprint(finalConfiguration) !== configurationVersion
    )
      return reject("evaluation_model_drift");
    if (
      commerceImageCatalogVersion(
        (await deps.catalog()).products,
        config.mediaOrigin,
        config.webPublicUrl,
        config.apiPublicUrl,
      ) !== indexVersion
    )
      return reject("evaluation_catalog_drift");
    for (const owner of manifest.owners)
      if ((await loadPrincipal(owner)).personalOrgId !== principals.get(owner)!.personalOrgId)
        return reject("evaluation_personal_org_invalid");
    for (const entry of manifest.cases)
      await verifyFile(principals.get(entry.ownerUserId)!, entry.fileId, hashes.get(entry.fileId));
    const evaluation = await evaluateCommerceImageSearch(
      manifest.cases,
      async (id) => completed.get(id)!,
    );
    return report(
      evaluation.passed ? "completed" : "failed",
      evaluation,
      evaluation.passed ? undefined : "evaluation_quality_below_target",
    );
  } catch (error) {
    return report(
      "failed",
      null,
      error instanceof ApiError ? error.code : "evaluation_request_failed",
    );
  }
}
