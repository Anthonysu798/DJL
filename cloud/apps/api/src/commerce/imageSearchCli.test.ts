import { describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseImageEvaluationArguments, runImageSearchCli } from "./imageSearchCli.ts";
import { parseCommerceImageEvaluationManifest } from "./imageSearchEvaluationRunner.ts";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  stage: vi.fn(),
  providers: vi.fn(() => ({})),
  database: vi.fn(() => ({ db: {}, sql: {}, close: async () => {} })),
  connect: vi.fn(async () => {}),
  quit: vi.fn(async () => "OK"),
}));
vi.mock("./imageSearchEvaluationRunner.ts", async (load) => ({
  ...(await load<typeof import("./imageSearchEvaluationRunner.ts")>()),
  runCommerceImageEvaluation: mocks.run,
}));
vi.mock("./imageSearchCorpusStage.ts", () => ({ stageCommerceImageCorpus: mocks.stage }));
vi.mock("../gateway/providers.ts", async (load) => ({
  ...(await load<typeof import("../gateway/providers.ts")>()),
  buildProviders: mocks.providers,
}));
vi.mock("@djl/db", async (load) => ({
  ...(await load<typeof import("@djl/db")>()),
  createDatabase: mocks.database,
}));
vi.mock("ioredis", async (load) => ({
  ...(await load<typeof import("ioredis")>()),
  Redis: class {
    connect = mocks.connect;
    quit = mocks.quit;
    on() {
      return this;
    }
    disconnect() {}
  },
}));

const isolatedEnv: NodeJS.ProcessEnv = {
  DJL_ENV: "test",
  DATABASE_URL: "postgres://test:test@127.0.0.1:5433/djl_commerce_eval_cli",
  REDIS_URL: "redis://127.0.0.1/0",
  STORAGE_S3_ENDPOINT: "https://storage.test",
  STORAGE_ACCESS_KEY_ID: "unit-test-placeholder",
  STORAGE_SECRET_ACCESS_KEY: "unit-test-placeholder",
};

function consentedManifest(runId: string) {
  const owners = Array.from({ length: 8 }, () => randomUUID());
  const product = randomUUID();
  return {
    schemaVersion: 1,
    runId,
    consent: {
      purpose: "commerce-image-benchmark",
      fixturePermissionConfirmed: true,
      platformSpendApproved: true,
      budgetUsdCents: 500,
      ownerUserIds: owners,
    },
    cases: Array.from({ length: 150 }, (_, index) => ({
      caseId: `synthetic-${index}`,
      fileId: randomUUID(),
      ownerUserId: owners[index % owners.length],
      kind: index < 100 ? "in_catalog" : "out_of_catalog",
      expectedProductIds: index < 100 ? [product] : [],
    })),
  };
}

describe("offline image evaluation CLI arguments", () => {
  it("defaults to a dry-run and requires an explicit integer spending cap", () => {
    expect(
      parseImageEvaluationArguments(["--manifest", "fixtures.json", "--max-cost-usd-cents", "500"]),
    ).toEqual({ manifest: "fixtures.json", maxCostUsdCents: 500, execute: false });
    expect(
      parseImageEvaluationArguments([
        "--manifest",
        "fixtures.json",
        "--max-cost-usd-cents",
        "500",
        "--corpus-lock",
        "fixtures.corpus.json",
        "--execute",
      ]),
    ).toMatchObject({ execute: true });
    expect(parseImageEvaluationArguments(["--help"])).toBe("help");
  });

  it("rejects absent, duplicated, ambiguous or unsafe flags rather than inventing defaults", () => {
    for (const args of [
      [],
      ["--execute"],
      ["--manifest", "fixtures.json"],
      ["--max-cost-usd-cents", "500"],
      ["--manifest", "--execute", "--max-cost-usd-cents", "500"],
      ["--manifest", "fixtures.json", "--max-cost-usd-cents", "500", "--execute", "--execute"],
      ["--manifest", "fixtures.json", "--max-cost-usd-cents", "500", "--execute"],
      [
        "--manifest",
        "fixtures.json",
        "--max-cost-usd-cents",
        "500",
        "--prepare-images",
        "pictures",
        "--corpus-lock",
        "other.json",
      ],
      ["--manifest", "fixtures.json", "--max-cost-usd-cents", "500", "--bypass-approval"],
      ["--manifest", "fixtures.json", "--manifest", "other.json", "--max-cost-usd-cents", "500"],
      ["--help", "--execute"],
    ])
      expect(() => parseImageEvaluationArguments(args)).toThrow();
    for (const amount of ["0", "-1", "1.5", "NaN", "Infinity", "1e3", "9007199254740992", " 500"])
      expect(() =>
        parseImageEvaluationArguments([
          "--manifest",
          "fixtures.json",
          "--max-cost-usd-cents",
          amount,
        ]),
      ).toThrow();
  });

  it("prints help without needing configuration or opening local services", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await runImageSearchCli(["--help"], {})).toBe(0);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("Default: preflight only, no model calls"),
      );
    } finally {
      log.mockRestore();
    }
  });

  it("requires a sealed local corpus for the explicit stage-only mode", () => {
    const args = ["--manifest", "fixtures.json", "--max-cost-usd-cents", "500"];
    const stage = [...args, "--stage-images", "pictures"];
    const locked = [...stage, "--corpus-lock", "corpus.json"];
    expect(parseImageEvaluationArguments(locked)).toMatchObject({
      stageImagesDir: "pictures",
      corpusLock: "corpus.json",
      execute: false,
    });
    expect(() => parseImageEvaluationArguments(stage)).toThrow();
    expect(() => parseImageEvaluationArguments([...locked, "--execute"])).toThrow();
    expect(() => parseImageEvaluationArguments([...locked, "--prepare-images", "other"])).toThrow();
  });

  it("refuses unsafe environments before reading even a nonexistent manifest and never prints secrets", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const env of [
        {},
        {
          DJL_ENV: "production",
          DATABASE_URL: "postgres://user:secret@127.0.0.1:5433/djl_commerce_eval_test",
          REDIS_URL: "redis://127.0.0.1",
        },
        {
          DJL_ENV: "test",
          DATABASE_URL: "postgres://user:secret@remote.test/djl_commerce_eval_test",
          REDIS_URL: "redis://127.0.0.1",
        },
        {
          DJL_ENV: "test",
          DATABASE_URL: "postgres://user:secret@127.0.0.1:5433/production",
          REDIS_URL: "redis://127.0.0.1",
        },
        {
          DJL_ENV: "local",
          DATABASE_URL: "postgres://user:secret@127.0.0.1:5433/djl_commerce_eval_test",
          REDIS_URL: "redis://remote.test",
        },
      ])
        expect(
          await runImageSearchCli(
            ["--manifest", "nonexistent-sensitive-path.json", "--max-cost-usd-cents", "500"],
            env,
          ),
        ).toBe(1);
      const output = JSON.stringify(error.mock.calls);
      expect(output).toContain("preflight refused");
      expect(output).not.toContain("secret");
      expect(output).not.toContain("nonexistent-sensitive-path");
      expect(output).not.toContain("postgres:");
    } finally {
      error.mockRestore();
    }
  });

  it("rejects automatic key fallback before constructing clients", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.database.mockClear();
    try {
      for (const key of [
        "OPENAI_API_KEY_FALLBACK",
        "ANTHROPIC_API_KEY_FALLBACK",
        "OPENROUTER_API_KEY_FALLBACK",
      ])
        expect(
          await runImageSearchCli(["--manifest", "missing.json", "--max-cost-usd-cents", "500"], {
            ...isolatedEnv,
            [key]: "unit-test-secret",
          }),
        ).toBe(1);
      expect(mocks.database).not.toHaveBeenCalled();
      expect(JSON.stringify(error.mock.calls)).toContain("preflight refused");
      expect(JSON.stringify(error.mock.calls)).not.toContain("unit-test-secret");
    } finally {
      error.mockRestore();
    }
  });

  it("keeps dry-run and execution records separate, valid JSON and non-overwriting", async () => {
    const runId = randomUUID();
    const manifestPath = join(tmpdir(), `djl-image-cli-${runId}.json`);
    const lockPath = join(tmpdir(), `djl-image-cli-${runId}.lock.json`);
    const folder = resolve(import.meta.dirname, "../../../../../.djl/commerce-evaluation");
    const dryPath = join(folder, `${runId}.dry-run.json`),
      executedPath = join(folder, `${runId}.json`);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network forbidden in CLI unit test."));
    try {
      const manifest = consentedManifest(runId);
      const plan = parseCommerceImageEvaluationManifest(manifest, 500);
      await writeFile(manifestPath, JSON.stringify(manifest), { flag: "wx" });
      await writeFile(
        lockPath,
        JSON.stringify({
          schemaVersion: 1,
          runId,
          manifestSha256: plan.digest,
          files: plan.cases.map(({ fileId }) => ({
            fileId,
            mimeType: "image/png",
            sizeBytes: 10,
            sha256: createHash("sha256").update(fileId).digest("hex"),
          })),
        }),
        { flag: "wx" },
      );
      mocks.run.mockClear().mockImplementation(async (input: { execute: boolean }) => ({
        runId,
        status: input.execute ? "completed" : "dry_run",
        evaluation: null,
      }));
      const args = ["--manifest", manifestPath, "--max-cost-usd-cents", "500"];
      expect(await runImageSearchCli(args, isolatedEnv)).toBe(0);
      expect(JSON.parse(await readFile(dryPath, "utf8"))).toMatchObject({
        runId,
        status: "dry_run",
      });
      expect(
        await runImageSearchCli([...args, "--corpus-lock", lockPath, "--execute"], isolatedEnv),
      ).toBe(0);
      expect(JSON.parse(await readFile(executedPath, "utf8"))).toMatchObject({
        runId,
        status: "completed",
      });
      expect(
        await runImageSearchCli([...args, "--corpus-lock", lockPath, "--execute"], isolatedEnv),
      ).toBe(1);
      expect(mocks.run).toHaveBeenCalledTimes(2);
      expect(mocks.run.mock.calls[0]![0]).toMatchObject({ execute: false, maxCostUsdCents: 500 });
      expect(mocks.run.mock.calls[1]![0]).toMatchObject({ execute: true, maxCostUsdCents: 500 });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await Promise.all(
        [manifestPath, lockPath, dryPath, executedPath].map((file) => rm(file, { force: true })),
      );
      log.mockRestore();
      error.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it("stages only the sealed run's local database and bucket without Redis or provider setup", async () => {
    const runId = randomUUID();
    const manifest = consentedManifest(runId);
    const plan = parseCommerceImageEvaluationManifest(manifest, 500);
    const dir = await mkdtemp(join(tmpdir(), "djl-private-image-stage-"));
    const manifestPath = join(dir, "consent.json");
    const lockPath = join(dir, "corpus.json");
    const reportPath = resolve(
      import.meta.dirname,
      `../../../../../.djl/commerce-evaluation/${runId}.stage.json`,
    );
    const runKey = runId.replaceAll("-", "");
    const databaseName = `djl_commerce_eval_${runKey}`;
    const env = {
      DJL_ENV: "test",
      DATABASE_URL: `postgres://local:synthetic@127.0.0.1:5433/${databaseName}`,
      STORAGE_S3_ENDPOINT: "http://127.0.0.1:8333",
      STORAGE_S3_PUBLIC_ENDPOINT: "https://isolated.test.invalid",
      STORAGE_BUCKET: `djl-commerce-eval-${runKey}`,
      STORAGE_ACCESS_KEY_ID: "stage-access",
      STORAGE_SECRET_ACCESS_KEY: "stage-secret",
    };
    const lock = {
      schemaVersion: 1,
      runId,
      manifestSha256: plan.digest,
      files: plan.cases.map(({ fileId }) => ({
        fileId,
        mimeType: "image/png",
        sizeBytes: 10,
        sha256: createHash("sha256").update(fileId).digest("hex"),
      })),
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network."));
    const args = [
      "--manifest",
      manifestPath,
      "--max-cost-usd-cents",
      "500",
      "--corpus-lock",
      lockPath,
      "--stage-images",
      dir,
    ];
    try {
      for (const mock of [mocks.database, mocks.stage, mocks.connect, mocks.providers, mocks.run])
        mock.mockClear();
      await writeFile(manifestPath, JSON.stringify(manifest), { flag: "wx" });
      await writeFile(lockPath, JSON.stringify({ ...lock, manifestSha256: "0".repeat(64) }));
      expect(await runImageSearchCli(args, env)).toBe(1);
      await writeFile(lockPath, JSON.stringify(lock));
      expect(await runImageSearchCli(args, { ...env, STORAGE_BUCKET: "djl-sync" })).toBe(1);
      expect(
        await runImageSearchCli(args, { ...env, DATABASE_URL: isolatedEnv.DATABASE_URL }),
      ).toBe(1);
      expect(
        await runImageSearchCli(args, {
          ...env,
          DATABASE_URL: `postgres://qa:synthetic@192.0.2.123:5432,decoy@127.0.0.1:5433/${databaseName}`,
        }),
      ).toBe(1);
      expect(mocks.database).not.toHaveBeenCalled();
      expect(mocks.stage).not.toHaveBeenCalled();
      mocks.stage.mockResolvedValue({ runId, status: "corpus_staged", staged: 150 });
      expect(await runImageSearchCli(args, env)).toBe(0);
      expect(mocks.database).toHaveBeenCalledWith(env.DATABASE_URL, {
        max: 1,
        queryTimeouts: { statementMs: 15_000, lockMs: 5_000 },
      });
      expect(mocks.stage).toHaveBeenCalledOnce();
      expect(mocks.stage.mock.calls[0]?.[0]).toMatchObject({ databaseName, corpusLock: lock });
      const report = await readFile(reportPath, "utf8");
      expect(JSON.parse(report)).toMatchObject({ runId, status: "corpus_staged", staged: 150 });
      expect(await runImageSearchCli(args, env)).toBe(1);
      expect(await readFile(reportPath, "utf8")).toBe(report);
      for (const mock of [mocks.connect, mocks.providers, mocks.run, fetchSpy])
        expect(mock).not.toHaveBeenCalled();
      expect(JSON.stringify([log.mock.calls, error.mock.calls, report])).not.toContain(
        "stage-secret",
      );
    } finally {
      await Promise.all(
        [manifestPath, lockPath, reportPath].map((file) => rm(file, { force: true })),
      );
      await rmdir(dir);
      log.mockRestore();
      error.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it("seals all 150 exact local files without opening services or recording paths", async () => {
    const runId = randomUUID();
    const manifest = consentedManifest(runId);
    const dir = await mkdtemp(join(tmpdir(), "djl-private-image-corpus-"));
    const manifestPath = join(dir, "consent.json");
    const reportPath = resolve(
      import.meta.dirname,
      `../../../../../.djl/commerce-evaluation/${runId}.corpus.json`,
    );
    const paths = manifest.cases.map(({ fileId }) => join(dir, fileId + ".png"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network."));
    try {
      mocks.database.mockClear();
      mocks.connect.mockClear();
      mocks.run.mockClear();
      await writeFile(manifestPath, JSON.stringify(manifest), { flag: "wx" });
      const args = [
        "--manifest",
        manifestPath,
        "--max-cost-usd-cents",
        "500",
        "--prepare-images",
        dir,
      ];
      expect(await runImageSearchCli(args, { DJL_ENV: "test" })).toBe(1);
      for (const [i, path] of paths.entries())
        await writeFile(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, i]), { flag: "wx" });
      expect(await runImageSearchCli(args, { DJL_ENV: "test" })).toBe(0);
      const seal = await readFile(reportPath, "utf8");
      expect(JSON.parse(seal)).toMatchObject({ schemaVersion: 1, runId, files: expect.any(Array) });
      expect(JSON.parse(seal).files).toHaveLength(150);
      expect(seal).not.toContain(dir);
      expect(seal).not.toContain(".png");
      expect(await runImageSearchCli(args, { DJL_ENV: "test" })).toBe(1);
      expect(await readFile(reportPath, "utf8")).toBe(seal);
      for (const spy of [mocks.database, mocks.connect, mocks.run, fetchSpy])
        expect(spy).not.toHaveBeenCalled();
    } finally {
      await Promise.all(
        [...paths, manifestPath, reportPath].map((file) => rm(file, { force: true })),
      );
      await rmdir(dir);
      fetchSpy.mockRestore();
      log.mockRestore();
      error.mockRestore();
    }
  });
});
