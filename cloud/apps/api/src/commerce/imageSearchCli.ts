/** Controlled offline benchmark, not an API endpoint. Dry-run is the default. */
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ApiError } from "../http/errors.ts";
import {
  evaluationReadFlags,
  prepareCommerceImageCorpus,
  readCommerceImageCorpusLock,
  requireLocalEvaluationPath,
} from "./imageSearchCorpus.ts";
import {
  parseCommerceImageEvaluationManifest,
  runCommerceImageEvaluation,
  validateCommerceImageEvaluationDatabase,
  validateCommerceImageEvaluationEnvironment,
} from "./imageSearchEvaluationRunner.ts";
import { createCommerceImageStageStorage } from "./imageSearchStageStorage.ts";

export const IMAGE_EVALUATION_USAGE =
  "bun cloud/apps/api/src/commerce/imageSearchCli.ts --manifest <consented-manifest.json> --max-cost-usd-cents <positive integer> [--prepare-images <private-directory> | --corpus-lock <lock.json> [--stage-images <private-directory> | --execute]]\n" +
  "--prepare-images validates and hashes local ID-named photos only, without opening database, Redis or provider connections.\n" +
  "--stage-images requires the matching corpus lock and writes only to a run-specific local evaluation database and bucket, without Redis or model calls.\n" +
  "Default: preflight only, no model calls. Requires an isolated local/test evaluation database, loopback Redis and verified model pricing.\n" +
  "--execute requires the matching corpus lock and permits inference spending up to the approved cap. Public image-search approval is never changed.";

interface CliOptions {
  readonly manifest: string;
  readonly maxCostUsdCents: number;
  readonly execute: boolean;
  readonly imagesDir?: string;
  readonly stageImagesDir?: string;
  readonly corpusLock?: string;
}

export function parseImageEvaluationArguments(args: readonly string[]): CliOptions | "help" {
  if (args.length === 1 && args[0] === "--help") return "help";
  const values = new Map<string, string>();
  let execute = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--execute" && !execute) {
      execute = true;
      continue;
    }
    if (
      ![
        "--manifest",
        "--max-cost-usd-cents",
        "--prepare-images",
        "--stage-images",
        "--corpus-lock",
      ].includes(arg) ||
      values.has(arg)
    )
      throw new Error("Invalid evaluation arguments.");
    const value = args[++index];
    if (!value?.trim() || value.startsWith("--")) throw new Error("Missing evaluation argument.");
    values.set(arg, value);
  }
  const manifest = values.get("--manifest");
  const amount = values.get("--max-cost-usd-cents");
  const maxCostUsdCents = Number(amount);
  if (!manifest || !amount || !/^[1-9]\d*$/.test(amount) || !Number.isSafeInteger(maxCostUsdCents))
    throw new Error("A manifest and positive safe integer cost cap are required.");
  const imagesDir = values.get("--prepare-images"),
    corpusLock = values.get("--corpus-lock"),
    stageImagesDir = values.get("--stage-images");
  if (
    ((execute || stageImagesDir) && !corpusLock) ||
    (imagesDir && corpusLock) ||
    (stageImagesDir && execute)
  )
    throw new Error("Prepare a local corpus lock and choose staging or execution separately.");
  return {
    manifest,
    maxCostUsdCents,
    execute,
    ...(imagesDir ? { imagesDir } : {}),
    ...(stageImagesDir ? { stageImagesDir } : {}),
    ...(corpusLock ? { corpusLock } : {}),
  };
}

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

async function readInputJson(path: string): Promise<unknown> {
  const input = requireLocalEvaluationPath(resolve(path));
  const limit = 1_000_000;
  const before = await lstat(input, { bigint: true });
  if (!before.isFile() || before.size > limit) throw new Error("Invalid evaluation input size.");
  const same = (stat: typeof before) =>
    stat.isFile() &&
    stat.ino === before.ino &&
    stat.dev === before.dev &&
    stat.size === before.size &&
    stat.mtimeNs === before.mtimeNs &&
    stat.ctimeNs === before.ctimeNs;
  const file = await open(input, evaluationReadFlags);
  try {
    if (!same(await file.stat({ bigint: true }))) throw new Error("Evaluation input changed.");
    const buffer = Buffer.alloc(limit + 1);
    let bytes = 0;
    while (bytes <= limit) {
      const { bytesRead } = await file.read(buffer, bytes, buffer.length - bytes, bytes);
      if (!bytesRead) break;
      bytes += bytesRead;
    }
    if (
      bytes > limit ||
      BigInt(bytes) !== before.size ||
      !same(await file.stat({ bigint: true })) ||
      !same(await lstat(input, { bigint: true }))
    )
      throw new Error("Evaluation input changed.");
    return JSON.parse(buffer.subarray(0, bytes).toString("utf8")) as unknown;
  } finally {
    await file.close();
  }
}

async function privateReportFolder() {
  const root = await realpath(workspaceRoot);
  const privateRoot = join(root, ".djl");
  const folder = join(privateRoot, "commerce-evaluation");
  for (const path of [privateRoot, folder]) {
    await mkdir(path, { recursive: true });
    if (!(await lstat(path)).isDirectory() || (await realpath(path)) !== path)
      throw new Error("Evaluation report folder is not private to the workspace.");
  }
  return folder;
}

async function writeReport(file: Awaited<ReturnType<typeof open>>, value: unknown): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(value, null, 2));
  await file.truncate(0);
  let position = 0;
  while (position < bytes.length) {
    const { bytesWritten } = await file.write(bytes, position, bytes.length - position, position);
    if (!bytesWritten) throw new Error("Report could not be written.");
    position += bytesWritten;
  }
  await file.sync();
}

export async function runImageSearchCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let options: CliOptions;
  try {
    const parsed = parseImageEvaluationArguments(args);
    if (parsed === "help") {
      console.log(IMAGE_EVALUATION_USAGE);
      return 0;
    }
    options = parsed;
    // This is deliberately before reading the manifest or constructing any clients.
    if (options.imagesDir) {
      if (env.DJL_ENV !== "test" && env.DJL_ENV !== "local")
        throw new Error("Local preparation only.");
    } else if (options.stageImagesDir) validateCommerceImageEvaluationDatabase(env);
    else validateCommerceImageEvaluationEnvironment(env);
    if (
      !options.imagesDir &&
      !options.stageImagesDir &&
      ["OPENAI_API_KEY_FALLBACK", "ANTHROPIC_API_KEY_FALLBACK", "OPENROUTER_API_KEY_FALLBACK"].some(
        (name) => env[name]?.trim(),
      )
    )
      throw new Error(
        "Evaluation requires a single primary provider key without automatic retries.",
      );
  } catch {
    console.error(`Evaluation preflight refused.\n${IMAGE_EVALUATION_USAGE}`);
    return 1;
  }

  let reportFile: Awaited<ReturnType<typeof open>> | undefined;
  let runId = "";
  let closeDatabase: (() => Promise<void>) | undefined;
  let redis: import("ioredis").Redis | undefined;
  try {
    const manifest = await readInputJson(options.manifest);
    const id =
      manifest && typeof manifest === "object" ? (manifest as Record<string, unknown>).runId : null;
    if (typeof id !== "string" || !RUN_ID.test(id)) throw new Error("Invalid run id.");
    runId = id;
    if (options.imagesDir) {
      const plan = parseCommerceImageEvaluationManifest(manifest, options.maxCostUsdCents);
      const lock = await prepareCommerceImageCorpus(plan, resolve(options.imagesDir));
      const reportFolder = await privateReportFolder();
      reportFile = await open(join(reportFolder, runId + ".corpus.json"), "wx", 0o600);
      await writeReport(reportFile, lock);
      console.log(
        JSON.stringify({
          runId,
          status: "corpus_prepared",
          cases: lock.files.length,
          reportDirectory: ".djl/commerce-evaluation",
        }),
      );
      return 0;
    }
    let corpusLock: unknown;
    if (options.corpusLock) {
      corpusLock = await readInputJson(options.corpusLock);
      readCommerceImageCorpusLock(
        parseCommerceImageEvaluationManifest(manifest, options.maxCostUsdCents),
        corpusLock,
      );
    }
    if (options.stageImagesDir) {
      const databaseName = validateCommerceImageEvaluationDatabase(env);
      if (databaseName !== `djl_commerce_eval_${runId.replaceAll("-", "")}`)
        throw new ApiError(400, "evaluation_database_forbidden", "Use the database for this run.");
      const blobs = createCommerceImageStageStorage(env, runId);
      const reportFolder = await privateReportFolder();
      reportFile = await open(join(reportFolder, runId + ".stage.json"), "wx", 0o600);
      await writeReport(reportFile, { runId, status: "initializing" });
      const [{ createDatabase }, { createMemoryRateLimiter }, { stageCommerceImageCorpus }] =
        await Promise.all([
          import("@djl/db"),
          import("../gateway/RateLimiter.ts"),
          import("./imageSearchCorpusStage.ts"),
        ]);
      const connection = createDatabase(env.DATABASE_URL!, {
        max: 1,
        queryTimeouts: { statementMs: 15_000, lockMs: 5_000 },
      });
      closeDatabase = connection.close;
      const report = await stageCommerceImageCorpus({
        db: connection.db,
        limiter: createMemoryRateLimiter(),
        blobs,
        manifest,
        corpusLock,
        databaseName,
        maxCostUsdCents: options.maxCostUsdCents,
        imagesDir: resolve(options.stageImagesDir),
      });
      if (report.runId !== runId) throw new Error("Unexpected stage report identity.");
      await writeReport(reportFile, report);
      console.log(JSON.stringify({ runId, status: report.status, staged: report.staged }));
      return 0;
    }
    const reportFolder = await privateReportFolder();
    // Reserve a writable, non-overwriting report before any possible paid request.
    // Dry-run and execution files differ so a reviewed dry-run can later be executed once.
    reportFile = await open(
      join(reportFolder, `${runId}${options.execute ? "" : ".dry-run"}.json`),
      "wx",
      0o600,
    );
    await writeReport(reportFile, { runId, status: "initializing" });

    const [
      { createDatabase },
      { Redis },
      { CommerceImageUploads },
      { blobStoreFromEnv },
      { buildProviders },
      { createRedisRateLimiter },
      { CommerceService },
    ] = await Promise.all([
      import("@djl/db"),
      import("ioredis"),
      import("./CommerceImageUploads.ts"),
      import("../sync/BlobStore.ts"),
      import("../gateway/providers.ts"),
      import("../gateway/RateLimiter.ts"),
      import("./CommerceService.ts"),
    ]);
    const environment = env.DJL_ENV;
    if (environment !== "local" && environment !== "test") throw new Error("Invalid environment.");
    const blobs = blobStoreFromEnv(env, { mockExternals: false });
    const providers = buildProviders({ mockExternals: false }, env, () => {
      console.warn(
        "Evaluation provider rejected a key; verify configured credentials before another run.",
      );
    });
    const connection = createDatabase(env.DATABASE_URL!, { max: 1 });
    closeDatabase = connection.close;
    redis = new Redis(env.REDIS_URL!, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    redis.on("error", () => undefined);
    await redis.connect();
    const limiter = createRedisRateLimiter(redis);
    const report = await runCommerceImageEvaluation({
      db: connection.db,
      commerce: new CommerceService(connection.db, { mode: "disabled", environment }),
      uploads: new CommerceImageUploads(connection.db, blobs, { enabled: () => false, limiter }),
      providers,
      limiter,
      redis,
      blobs,
      mockExternals: false,
      environment,
      ...(env.WEB_PUBLIC_URL ? { webPublicUrl: env.WEB_PUBLIC_URL } : {}),
      processEnv: env,
      manifest,
      ...(options.corpusLock ? { corpusLock } : {}),
      execute: options.execute,
      maxCostUsdCents: options.maxCostUsdCents,
    });
    if (report.runId !== runId) throw new Error("Unexpected report identity.");
    await writeReport(reportFile, report);
    console.log(
      JSON.stringify({ runId, status: report.status, reportDirectory: ".djl/commerce-evaluation" }),
    );
    return report.status === "failed" ? 1 : 0;
  } catch (error) {
    if (reportFile) {
      await writeReport(reportFile, {
        runId,
        status: "failed",
        errorCode: options.stageImagesDir
          ? error instanceof ApiError
            ? error.code
            : "evaluation_stage_cli_failed"
          : "evaluation_cli_failed",
      });
    }
    if (options.stageImagesDir)
      console.error(
        "Corpus staging stopped. Review the local report and do not replay a partial run.",
      );
    else
      console.error(
        "Evaluation could not complete. Inspect the local report; never automatically retry an unknown spending outcome. Public image-search gates were not changed.",
      );
    return 1;
  } finally {
    await Promise.allSettled([
      redis?.quit().catch(() => redis!.disconnect()),
      closeDatabase?.(),
      reportFile?.close(),
    ]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runImageSearchCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error("Evaluation failed; inspect the local report before any retry.");
      process.exitCode = 1;
    });
}
