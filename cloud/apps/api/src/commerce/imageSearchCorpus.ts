import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";

import { bytesMatchType } from "../files/fileTypes.ts";
import { ApiError } from "../http/errors.ts";

const maxBytes = 10 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const evaluationReadFlags =
  constants.O_RDONLY |
  (process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
const mimeByExtension = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;
type CorpusMime = (typeof mimeByExtension)[keyof typeof mimeByExtension];
type CorpusFile = {
  readonly fileId: string;
  readonly mimeType: CorpusMime;
  readonly sizeBytes: number;
  readonly sha256: string;
};
type EvaluationPlan = {
  readonly runId: string;
  readonly digest: string;
  readonly cases: readonly { readonly fileId: string }[];
};

function refused(code = "evaluation_corpus_invalid"): never {
  throw new ApiError(400, code, "Review the private evaluation corpus and its approved manifest.");
}

export function requireLocalEvaluationPath(path: string): string {
  if (process.platform === "win32" && !/^[a-z]:[\\/]/i.test(path)) return refused();
  return path;
}

/** Read only exact, flat, ID-named local files; hold at most one bounded image at a time. */
export async function* readCommerceImageCorpusFiles(
  plan: EvaluationPlan,
  imagesDir: string,
): AsyncGenerator<CorpusFile & { readonly bytes: Buffer }> {
  const hashes = new Set<string>();
  try {
    const originalRoot = await lstat(requireLocalEvaluationPath(imagesDir), { bigint: true });
    if (!originalRoot.isDirectory()) return refused();
    const root = requireLocalEvaluationPath(await realpath(imagesDir));
    const checkRoot = async () => {
      const actual = await lstat(root, { bigint: true });
      if (
        !actual.isDirectory() ||
        actual.dev !== originalRoot.dev ||
        actual.ino !== originalRoot.ino
      )
        return refused();
    };
    for (const { fileId } of plan.cases) {
      if (!uuid.test(fileId)) return refused();
      await checkRoot();
      const candidates = [];
      for (const [extension, mimeType] of Object.entries(mimeByExtension)) {
        const path = join(root, `${fileId}.${extension}`);
        const initial = await lstat(path, { bigint: true }).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          },
        );
        if (initial) candidates.push({ path, mimeType, initial });
      }
      if (candidates.length !== 1) return refused();
      const { path, mimeType, initial } = candidates[0]!;
      if (!initial.isFile() || initial.size < 1 || initial.size > maxBytes) return refused();
      const file = await open(path, evaluationReadFlags);
      let bytes: Buffer;
      try {
        const same = (stat: typeof initial) =>
          stat.isFile() &&
          stat.dev === initial.dev &&
          stat.ino === initial.ino &&
          stat.size === initial.size &&
          stat.mtimeNs === initial.mtimeNs &&
          stat.ctimeNs === initial.ctimeNs;
        if (!same(await file.stat({ bigint: true }))) return refused();
        bytes = Buffer.alloc(Number(initial.size));
        for (let offset = 0; offset < bytes.length; ) {
          const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
          if (!bytesRead) return refused();
          offset += bytesRead;
        }
        const extra = await file.read(Buffer.alloc(1), 0, 1, bytes.length);
        if (
          extra.bytesRead ||
          !same(await file.stat({ bigint: true })) ||
          !same(await lstat(path, { bigint: true }))
        )
          return refused();
      } finally {
        await file.close();
      }
      await checkRoot();
      if (!bytesMatchType(mimeType, bytes)) return refused();
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (hashes.has(sha256)) return refused("evaluation_duplicate_image");
      hashes.add(sha256);
      yield { fileId, mimeType, sizeBytes: bytes.length, sha256, bytes };
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return refused();
  }
}

/** Seal metadata only; do not retain image bytes or source paths. */
export async function prepareCommerceImageCorpus(plan: EvaluationPlan, imagesDir: string) {
  const files: CorpusFile[] = [];
  for await (const { fileId, mimeType, sizeBytes, sha256 } of readCommerceImageCorpusFiles(
    plan,
    imagesDir,
  ))
    files.push({ fileId, mimeType, sizeBytes, sha256 });
  return { schemaVersion: 1, runId: plan.runId, manifestSha256: plan.digest, files };
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** A locked corpus must cover exactly this approved run; no filenames or raw images are retained. */
export function readCommerceImageCorpusLock(plan: EvaluationPlan, lock: unknown) {
  if (
    !isRecord(lock) ||
    Object.keys(lock).length !== 4 ||
    lock.schemaVersion !== 1 ||
    lock.runId !== plan.runId ||
    lock.manifestSha256 !== plan.digest ||
    !Array.isArray(lock.files) ||
    lock.files.length !== plan.cases.length
  )
    return refused();
  const expected = new Set(plan.cases.map(({ fileId }) => fileId));
  const output = new Map<string, CorpusFile>();
  const hashes = new Set<string>();
  for (const row of lock.files) {
    if (
      !isRecord(row) ||
      Object.keys(row).length !== 4 ||
      typeof row.fileId !== "string" ||
      !expected.delete(row.fileId) ||
      typeof row.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      hashes.has(row.sha256) ||
      typeof row.sizeBytes !== "number" ||
      !Number.isSafeInteger(row.sizeBytes) ||
      row.sizeBytes < 1 ||
      row.sizeBytes > maxBytes ||
      !Object.values(mimeByExtension).some((mime) => mime === row.mimeType)
    )
      return refused();
    hashes.add(row.sha256);
    output.set(row.fileId, {
      fileId: row.fileId,
      mimeType: row.mimeType as CorpusMime,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
    });
  }
  return output;
}
