/** Explicit local evaluation staging only; never imports a provider or enables a public route. */
import { setTimeout } from "node:timers/promises";
import { schema, type DjlDatabase } from "@djl/db";
import { inArray, sql } from "drizzle-orm";

import type { RateLimiter } from "../gateway/RateLimiter.ts";
import { ApiError } from "../http/errors.ts";
import type { BlobStore } from "../sync/BlobStore.ts";
import { CommerceImageUploads, commerceImageUploadKey } from "./CommerceImageUploads.ts";
import { readCommerceImageCorpusFiles, readCommerceImageCorpusLock } from "./imageSearchCorpus.ts";
import {
  loadCommerceImageEvaluationOwner,
  parseCommerceImageEvaluationManifest,
} from "./imageSearchEvaluationRunner.ts";

const OWNER_PAUSE_MS = 10_100;

export interface CommerceImageCorpusStageInput {
  readonly db: DjlDatabase;
  readonly limiter: Pick<RateLimiter, "hit" | "acquire">;
  /** The CLI admits a fresh, write-once per-run store before calling this core. */
  readonly blobs: BlobStore;
  readonly manifest: unknown;
  readonly corpusLock: unknown;
  readonly maxCostUsdCents: number;
  readonly imagesDir: string;
  readonly databaseName: string;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

export interface CommerceImageCorpusStageReport {
  readonly status: "corpus_staged";
  readonly runId: string;
  readonly manifestSha256: string;
  readonly staged: number;
  readonly earliestExpiresAt: string;
}

function refuse(code: string, status = 400): never {
  throw new ApiError(
    status,
    code,
    "Evaluation staging refused. Review the isolated corpus; do not automatically retry a partial or unknown result.",
  );
}

type Plan = ReturnType<typeof parseCommerceImageEvaluationManifest>;
type Photo = {
  fileId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  bytes: Uint8Array;
};
function roundRobin(plan: Plan): Plan["cases"] {
  const buckets = new Map(plan.owners.map((owner) => [owner, [] as Plan["cases"][number][]]));
  for (const entry of plan.cases) buckets.get(entry.ownerUserId)!.push(entry);
  const ordered: Plan["cases"][number][] = [];
  for (let round = 0; ordered.length < plan.cases.length; round++)
    for (const bucket of buckets.values()) {
      const entry = bucket[round];
      if (entry) ordered.push(entry);
    }
  return ordered;
}

export async function stageCommerceImageCorpus(
  input: CommerceImageCorpusStageInput,
): Promise<CommerceImageCorpusStageReport> {
  const plan = parseCommerceImageEvaluationManifest(input.manifest, input.maxCostUsdCents);
  const locked = readCommerceImageCorpusLock(plan, input.corpusLock);
  const expectedDatabase = `djl_commerce_eval_${plan.runId.replaceAll("-", "")}`;
  if (input.databaseName !== expectedDatabase) return refuse("evaluation_database_forbidden");
  const now = input.now ?? Date.now;
  const wait = input.wait ?? setTimeout;
  const { db, blobs, limiter, imagesDir } = input;
  const t = schema.commerceImageUploads;
  const matchPhoto = (photo: Photo, fileId: string | undefined) => {
    const pinned = fileId && locked.get(fileId);
    if (
      !pinned ||
      photo.fileId !== fileId ||
      photo.mimeType !== pinned.mimeType ||
      photo.sizeBytes !== pinned.sizeBytes ||
      photo.bytes.byteLength !== pinned.sizeBytes ||
      photo.sha256 !== pinned.sha256
    )
      return refuse("evaluation_file_hash_mismatch");
  };

  try {
    const [database] = await db.execute<{ name: string }>(sql`select current_database() as name`);
    if (database?.name !== expectedDatabase) return refuse("evaluation_database_forbidden");
    const existing = await db
      .select({ id: t.id })
      .from(t)
      .where(
        inArray(
          t.id,
          plan.cases.map(({ fileId }) => fileId),
        ),
      )
      .limit(1);
    if (existing.length) return refuse("evaluation_stage_conflict", 409);
    const owners = new Map<string, string>();
    for (const id of plan.owners)
      owners.set(id, (await loadCommerceImageEvaluationOwner(db, id, plan.runId)).personalOrgId);

    let prevalidated = 0;
    for await (const photo of readCommerceImageCorpusFiles(plan, imagesDir))
      matchPhoto(photo, plan.cases[prevalidated++]?.fileId);
    if (prevalidated !== plan.cases.length) return refuse("evaluation_corpus_invalid");

    const loadOwner = async (id: string) => {
      const p = await loadCommerceImageEvaluationOwner(db, id, plan.runId);
      if (p.personalOrgId !== owners.get(id)) return refuse("evaluation_personal_org_invalid");
      return p;
    };
    const ordered = roundRobin(plan);
    const source = readCommerceImageCorpusFiles({ ...plan, cases: ordered }, imagesDir);
    const ownerReadyAt = new Map<string, number>();
    let earliestExpiry = Infinity;
    const requireLive = () => {
      if (now() >= earliestExpiry) return refuse("evaluation_stage_expired", 409);
    };
    try {
      for (const { fileId, ownerUserId } of ordered) {
        const due = ownerReadyAt.get(ownerUserId);
        if (due !== undefined)
          for (let remaining = due - now(); remaining > 0; remaining = due - now())
            await wait(remaining);
        requireLive();
        const p = await loadOwner(ownerUserId);
        const next = await source.next();
        if (next.done) return refuse("evaluation_corpus_invalid");
        const photo = next.value;
        matchPhoto(photo, fileId);
        requireLive();
        const uploads = new CommerceImageUploads(db, blobs, {
          enabled: () => true,
          limiter,
          now: () => new Date(now()),
          allocateUploadId: () => fileId,
        });
        const expectedUserId = p.userId;
        const upload = await uploads.create(p, {
          expectedUserId,
          mimeType: photo.mimeType,
          size: photo.sizeBytes,
          sha256: photo.sha256,
        });
        if (upload.id !== fileId || upload.userId !== ownerUserId)
          return refuse("evaluation_stage_failed", 503);
        await blobs.write(commerceImageUploadKey(fileId, "staging"), photo.bytes, photo.mimeType);
        const current = await loadOwner(ownerUserId);
        await uploads.complete(current, fileId, { expectedUserId });
        const ready = await uploads.readyPhoto(current, fileId);
        if (
          ready.id !== fileId ||
          ready.mimeType !== photo.mimeType ||
          ready.sizeBytes !== photo.sizeBytes ||
          ready.sha256 !== photo.sha256
        )
          return refuse("evaluation_file_hash_mismatch");
        earliestExpiry = Math.min(earliestExpiry, ready.expiresAt.getTime());
        ownerReadyAt.set(ownerUserId, now() + OWNER_PAUSE_MS);
      }
      if (!(await source.next()).done) return refuse("evaluation_corpus_invalid");
    } finally {
      await source.return(undefined);
    }
    requireLive();
    return {
      status: "corpus_staged",
      runId: plan.runId,
      manifestSha256: plan.digest,
      staged: plan.cases.length,
      earliestExpiresAt: new Date(earliestExpiry).toISOString(),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return refuse("evaluation_stage_failed", 503);
  }
}
