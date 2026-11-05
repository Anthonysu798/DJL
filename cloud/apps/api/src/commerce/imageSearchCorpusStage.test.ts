import { randomUUID } from "node:crypto";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DjlDatabase } from "@djl/db";
import { drizzle } from "drizzle-orm/pg-proxy";
import { afterEach, expect, it, vi } from "vitest";

import { createMemoryRateLimiter } from "../gateway/RateLimiter.ts";
import { ApiError } from "../http/errors.ts";
import { FakeBlobStore } from "../sync/BlobStore.ts";
import { commerceImageUploadKey } from "./CommerceImageUploads.ts";
import { prepareCommerceImageCorpus } from "./imageSearchCorpus.ts";
import { stageCommerceImageCorpus } from "./imageSearchCorpusStage.ts";
import {
  loadCommerceImageEvaluationOwner,
  parseCommerceImageEvaluationManifest,
} from "./imageSearchEvaluationRunner.ts";

vi.mock("./imageSearchEvaluationRunner.ts", async (original) => ({
  ...(await original<typeof import("./imageSearchEvaluationRunner.ts")>()),
  loadCommerceImageEvaluationOwner: vi.fn(),
}));
const loadOwner = vi.mocked(loadCommerceImageEvaluationOwner);
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const remove of cleanup.splice(0).toReversed()) await remove();
  loadOwner.mockReset();
});

const png = (index: number) => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, index]);
const start = Date.parse("2026-11-05T12:00:00Z");
const principal = (userId: string) => ({
  userId,
  email: "synthetic@test.invalid",
  emailVerified: true,
  banned: false,
  sessionId: "synthetic-evaluation",
  orgId: userId,
  personalOrgId: userId,
  role: "member" as const,
});
type Row = {
  id: string;
  owner: string;
  mime: string;
  bytes: number;
  sha: string;
  status: string;
  created: string;
  expires: string;
};

async function fixture() {
  const runId = randomUUID();
  const databaseName = `djl_commerce_eval_${runId.replaceAll("-", "")}`;
  const owners = Array.from({ length: 8 }, () => randomUUID());
  const product = randomUUID();
  // Owner-grouped input, so actual round-robin scheduling is observable.
  const cases = Array.from({ length: 150 }, (_, i) => ({
    caseId: `case-${i}`,
    fileId: randomUUID(),
    ownerUserId: owners[Math.floor(i / 19)]!,
    kind: i < 100 ? "in_catalog" : "out_of_catalog",
    expectedProductIds: i < 100 ? [product] : [],
  }));
  const manifest = {
    schemaVersion: 1,
    runId,
    cases,
    consent: {
      purpose: "commerce-image-benchmark",
      fixturePermissionConfirmed: true,
      platformSpendApproved: true,
      budgetUsdCents: 500,
      ownerUserIds: owners,
    },
  };
  const plan = parseCommerceImageEvaluationManifest(manifest, 500);
  const imagesDir = await mkdtemp(join(tmpdir(), "djl-stage-unit-"));
  cleanup.push(() => rmdir(imagesDir));
  const path = (index: number) => join(imagesDir, cases[index]!.fileId + ".png");
  await Promise.all(
    cases.map(async (_, index) => {
      const name = path(index);
      cleanup.push(() => rm(name, { force: true }));
      await writeFile(name, png(index), { flag: "wx" });
    }),
  );
  const corpusLock = await prepareCommerceImageCorpus(plan, imagesDir);

  const rows = new Map<string, Row>();
  let clock = start;
  const controls = { actualDatabase: databaseName, existingId: "", failKey: "" };
  const query = vi.fn(async (statement: string, values: unknown[]) => {
    if (statement === "select current_database() as name")
      return { rows: [{ name: controls.actualDatabase }] };
    if (statement.startsWith('select "id" from "commerce_image_uploads"')) {
      expect(statement).toContain(" in (");
      const existing = values.find(
        (value) => typeof value === "string" && (value === controls.existingId || rows.has(value)),
      );
      return { rows: existing ? [[existing]] : [] };
    }
    if (statement.startsWith('insert into "commerce_image_uploads"')) {
      const [id, owner, mime, bytes, sha, created, expires] = values as [
        string,
        string,
        string,
        number,
        string,
        string,
        string,
      ];
      if (rows.has(id)) throw new Error("Synthetic fixed-ID conflict");
      rows.set(id, { id, owner, mime, bytes, sha, created, expires, status: "pending" });
      return { rows: [] };
    }
    if (statement.startsWith('select "id", "user_id"')) {
      const [id, owner, cutoff] = values as [string, string, string];
      const row = rows.get(id);
      return {
        rows:
          row && row.owner === owner && row.expires > cutoff
            ? [
                [
                  row.id,
                  row.owner,
                  row.mime,
                  row.bytes,
                  row.sha,
                  row.status,
                  row.created,
                  row.expires,
                  null,
                ],
              ]
            : [],
      };
    }
    if (statement.startsWith('update "commerce_image_uploads"')) {
      const [status, id, owner, expected, cutoff] = values as [
        string,
        string,
        string,
        string,
        string?,
      ];
      const row = rows.get(id);
      if (
        !row ||
        row.owner !== owner ||
        row.status !== expected ||
        (cutoff && row.expires <= cutoff)
      )
        return { rows: [] };
      row.status = status;
      return { rows: statement.endsWith('returning "id"') ? [[id]] : [] };
    }
    throw new Error("Unexpected synthetic staging statement");
  });
  const db = drizzle(query) as unknown as DjlDatabase;
  const blobs = new FakeBlobStore();
  const presign = vi.spyOn(blobs, "presignUpload").mockImplementation(async (key, mime, size) => ({
    ...(await FakeBlobStore.prototype.presignUpload.call(blobs, key, mime, size)),
    expiresAt: new Date(clock + 600_000).toISOString(),
  }));
  const write = vi.spyOn(blobs, "write").mockImplementation(async (key, bytes, mime) => {
    if (key === controls.failKey || blobs.objects.get(key)?.bytes)
      throw new Error("Synthetic unknown write outcome");
    await FakeBlobStore.prototype.write.call(blobs, key, bytes, mime);
  });
  loadOwner.mockImplementation(async (_db, id) => principal(id));
  const limiter = createMemoryRateLimiter(() => clock);
  const wait = vi.fn(async (milliseconds: number) => {
    clock += milliseconds;
  });
  return {
    input: {
      db,
      limiter,
      blobs,
      manifest,
      corpusLock,
      maxCostUsdCents: 500,
      imagesDir,
      databaseName,
      now: () => clock,
      wait,
    },
    owners,
    cases,
    rows,
    query,
    controls,
    principal,
    path,
    presign,
    write,
    wait,
  };
}

it("stages all 150 fixed IDs through actual upload verification, scoped ownership and normal expiry", async () => {
  const f = await fixture();
  const result = await stageCommerceImageCorpus(f.input);
  expect(result).toEqual({
    status: "corpus_staged",
    runId: f.input.manifest.runId,
    manifestSha256: f.input.corpusLock.manifestSha256,
    staged: 150,
    earliestExpiresAt: new Date(start + 30 * 60_000).toISOString(),
  });
  const created = [...f.rows.values()];
  expect(created.slice(0, 8).map((row) => row.owner)).toEqual(f.owners);
  expect(f.wait).toHaveBeenCalledTimes(18);
  const starts = new Map<string, number>();
  for (const row of created) {
    const at = Date.parse(row.created),
      previous = starts.get(row.owner);
    if (previous !== undefined) expect(at - previous).toBeGreaterThanOrEqual(10_100);
    starts.set(row.owner, at);
    expect(Date.parse(row.expires) - at).toBe(30 * 60_000);
    expect(row.status).toBe("ready");
  }
  expect(created).toHaveLength(150);
  for (const [index, entry] of f.cases.entries()) {
    expect(f.rows.get(entry.fileId)?.owner).toBe(entry.ownerUserId);
    const bytes = await f.input.blobs.read(commerceImageUploadKey(entry.fileId, "ready"));
    expect(Buffer.from(bytes!)).toEqual(png(index));
    expect(f.input.blobs.objects.has(commerceImageUploadKey(entry.fileId, "staging"))).toBe(false);
  }
  expect(JSON.stringify(result)).not.toMatch(/https:|\.png|test\.invalid|image-uploads/);
});

it("refuses invalid lock, wrong configured or actual database, and existing IDs before writes", async () => {
  const f = await fixture();
  await expect(stageCommerceImageCorpus({ ...f.input, corpusLock: {} })).rejects.toMatchObject({
    code: "evaluation_corpus_invalid",
  });
  await expect(
    stageCommerceImageCorpus({ ...f.input, databaseName: "djl_commerce_eval_other" }),
  ).rejects.toMatchObject({
    code: "evaluation_database_forbidden",
  });
  expect(f.query).not.toHaveBeenCalled();
  f.controls.actualDatabase = "djl_commerce_eval_other";
  await expect(stageCommerceImageCorpus(f.input)).rejects.toMatchObject({
    code: "evaluation_database_forbidden",
  });
  f.controls.actualDatabase = f.input.databaseName;
  f.controls.existingId = f.cases[0]!.fileId;
  await expect(stageCommerceImageCorpus(f.input)).rejects.toMatchObject({
    code: "evaluation_stage_conflict",
  });
  expect(f.presign).not.toHaveBeenCalled();
  expect(f.write).not.toHaveBeenCalled();
  expect(f.rows.size).toBe(0);
});

it("validates the whole cohort and rechecks the sealed disk bytes just before staging", async () => {
  const f = await fixture();
  await writeFile(f.path(149), png(250));
  await expect(stageCommerceImageCorpus(f.input)).rejects.toMatchObject({
    code: "evaluation_file_hash_mismatch",
  });
  expect(f.presign).not.toHaveBeenCalled();
  await writeFile(f.path(149), png(149));
  let loads = 0;
  loadOwner.mockImplementation(async (_db, id) => {
    if (++loads === f.owners.length + 1) await writeFile(f.path(0), png(250));
    return f.principal(id);
  });
  await expect(stageCommerceImageCorpus(f.input)).rejects.toMatchObject({
    code: "evaluation_file_hash_mismatch",
  });
  expect(f.write).not.toHaveBeenCalled();
  expect(f.rows.size).toBe(0);
});

it("checks dedicated owners before any mutation and after uploading before verification", async () => {
  const f = await fixture();
  loadOwner.mockRejectedValueOnce(
    new ApiError(400, "evaluation_test_user_required", "Synthetic disabled owner"),
  );
  await expect(stageCommerceImageCorpus(f.input)).rejects.toMatchObject({
    code: "evaluation_test_user_required",
  });
  expect(f.write).not.toHaveBeenCalled();
  let loads = 0;
  loadOwner.mockImplementation(async (_db, id) => {
    if (++loads === f.owners.length + 2)
      throw new ApiError(
        400,
        "evaluation_test_user_required",
        "Synthetic owner disabled during staging",
      );
    return f.principal(id);
  });
  await expect(stageCommerceImageCorpus(f.input)).rejects.toMatchObject({
    code: "evaluation_test_user_required",
  });
  expect(f.write).toHaveBeenCalledTimes(1);
  expect(f.rows.get(f.cases[0]!.fileId)?.status).toBe("pending");
});

it("does not report success, retry, or write new rows after an unknown storage outcome", async () => {
  const f = await fixture();
  f.controls.failKey = commerceImageUploadKey(f.cases[19]!.fileId, "staging");
  await expect(stageCommerceImageCorpus(f.input)).rejects.toMatchObject({
    code: "evaluation_stage_failed",
  });
  expect(f.write).toHaveBeenCalledTimes(3); // first staging+ready, second staging only
  expect([...f.rows.values()].map((row) => row.status)).toEqual(["ready", "pending"]);
  expect(f.presign).toHaveBeenCalledTimes(2);
  await expect(stageCommerceImageCorpus(f.input)).rejects.toMatchObject({
    code: "evaluation_stage_conflict",
  });
  expect(f.write).toHaveBeenCalledTimes(3);
});

it("stops before staging more rows when an earlier photo has expired", async () => {
  const f = await fixture();
  const advance = f.wait.getMockImplementation()!;
  f.wait.mockImplementationOnce(() => advance(30 * 60_000));
  await expect(stageCommerceImageCorpus(f.input)).rejects.toMatchObject({
    code: "evaluation_stage_expired",
  });
  expect(f.rows.size).toBe(8);
  expect(f.write).toHaveBeenCalledTimes(16);
});
