import { randomUUID } from "node:crypto";
import { mkdtemp, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import { prepareCommerceImageCorpus, readCommerceImageCorpusLock } from "./imageSearchCorpus.ts";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const cleanups: (() => Promise<unknown>)[] = [];
async function fixture(count = 1) {
  const dir = await mkdtemp(join(tmpdir(), "djl-corpus-guard-"));
  cleanups.push(() => rmdir(dir));
  const plan = {
    runId: randomUUID(),
    digest: "1".repeat(64),
    cases: Array.from({ length: count }, () => ({ fileId: randomUUID() })),
  };
  const path = (index: number, ext = "png") => join(dir, plan.cases[index]!.fileId + "." + ext);
  const write = async (index: number, bytes: Buffer, ext = "png") => {
    const name = path(index, ext);
    cleanups.push(() => rm(name, { force: true }));
    await writeFile(name, bytes, { flag: "wx" });
  };
  return { dir, plan, path, write };
}
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});

it("refuses duplicate file extensions, path-like IDs, wrong media bytes, and oversize files", async () => {
  const f = await fixture();
  await f.write(0, png);
  await expect(
    prepareCommerceImageCorpus({ ...f.plan, cases: [{ fileId: "../image" }] }, f.dir),
  ).rejects.toMatchObject({ code: "evaluation_corpus_invalid" });
  await f.write(0, png, "jpg");
  await expect(prepareCommerceImageCorpus(f.plan, f.dir)).rejects.toMatchObject({
    code: "evaluation_corpus_invalid",
  });
  const g = await fixture();
  await g.write(0, png, "jpeg");
  await expect(prepareCommerceImageCorpus(g.plan, g.dir)).rejects.toMatchObject({
    code: "evaluation_corpus_invalid",
  });
  const h = await fixture();
  await h.write(0, Buffer.alloc(10 * 1024 * 1024 + 1));
  await expect(prepareCommerceImageCorpus(h.plan, h.dir)).rejects.toMatchObject({
    code: "evaluation_corpus_invalid",
  });
});

it("does not follow links out of the selected directory", async () => {
  const f = await fixture(),
    other = await fixture();
  const p = f.path(0);
  await symlink(other.dir, p, process.platform === "win32" ? "junction" : "dir");
  cleanups.push(() => rm(p, { force: true }));
  await expect(prepareCommerceImageCorpus(f.plan, f.dir)).rejects.toMatchObject({
    code: "evaluation_corpus_invalid",
  });
});

it("rejects duplicate photo bytes and binds the lock to the exact run and files", async () => {
  const f = await fixture(2);
  await f.write(0, png);
  await f.write(1, png);
  await expect(prepareCommerceImageCorpus(f.plan, f.dir)).rejects.toMatchObject({
    code: "evaluation_duplicate_image",
  });
  await writeFile(f.path(1), Buffer.concat([png, Buffer.from([2])]));
  const seal = await prepareCommerceImageCorpus(f.plan, f.dir);
  expect(readCommerceImageCorpusLock(f.plan, seal).size).toBe(2);
  for (const lock of [
    { ...seal, runId: randomUUID() },
    { ...seal, manifestSha256: "2".repeat(64) },
    { ...seal, files: [seal.files[0], seal.files[0]] },
    { ...seal, files: [{ ...seal.files[0], path: "private.png" }, seal.files[1]] },
    { ...seal, files: [{ ...seal.files[0], sha256: seal.files[1]!.sha256 }, seal.files[1]] },
  ])
    expect(() => readCommerceImageCorpusLock(f.plan, lock)).toThrow();
});
