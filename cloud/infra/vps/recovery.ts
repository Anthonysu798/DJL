import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { posix, resolve } from "node:path";
import { createGunzip } from "node:zlib";

const artifactNames = ["postgres.dump", "files.tar.gz", "recovery-baseline.jsonl"] as const;
const sqlPath = new URL("recovery-verify.sql", import.meta.url);
const digestPattern = /^[a-f0-9]{64}$/;
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const serviceNames = ["s3", "api", "worker"] as const;
type Service = (typeof serviceNames)[number];
export interface RecoveryManifest {
  format: "djl-vps-backup";
  version: 1;
  completedAt: string;
  database: { name: "djl"; postgresMajor: 17; image: "postgres:17-alpine"; imageId: string };
  storage: { image: "chrislusf/seaweedfs:4.47"; imageId: string };
  quiescence: {
    assumption: "all-writers-quiesced";
    initiallyRunning: Service[];
    baselineBeforeAfterMatched: true;
  };
  artifacts: { name: (typeof artifactNames)[number]; sizeBytes: number; sha256: string }[];
  verification: { sqlSha256: string };
  exclusions: ["redis", "remote-relay", "local-ai", "private-configuration"];
}
function requireThat(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function regular(path: string) {
  const stat = lstatSync(path);
  requireThat(stat.isFile() && !stat.isSymbolicLink(), "Backup artifacts must be regular files.");
  return stat;
}
async function sha256(path: string | URL) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export function baseline(text: string) {
  requireThat(
    text.endsWith("\n") && !text.includes("\r") && text.length < 32 * 1024 * 1024,
    "Expected newline-terminated verification JSON Lines.",
  );
  const records = text
    .slice(0, -1)
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const header = records.shift();
  requireThat(
    header?.format === "djl-vps-recovery-baseline" && header.version === 1,
    "Unsupported verification baseline.",
  );
  let lastTable: string | null = null;
  let lastInvariant: string | null = null;
  for (const record of records) {
    requireThat(
      record && typeof record === "object" && !Array.isArray(record),
      "Invalid verification record.",
    );
    if (record.kind === "table") {
      requireThat(
        lastInvariant === null &&
          typeof record.schema === "string" &&
          typeof record.name === "string" &&
          record.schema.length &&
          record.name.length &&
          typeof record.rows === "string" &&
          /^(0|[1-9]\d*)$/.test(record.rows) &&
          typeof record.sha256 === "string" &&
          digestPattern.test(record.sha256),
        "Invalid table fingerprint.",
      );
      const key = `${record.schema}\0${record.name}`;
      requireThat(
        lastTable === null || Buffer.compare(Buffer.from(lastTable), Buffer.from(key)) < 0,
        "Table fingerprints must be unique and sorted.",
      );
      lastTable = key;
    } else {
      requireThat(
        record.kind === "invariant" &&
          typeof record.name === "string" &&
          record.name.length &&
          record.violations === "0",
        "Database invariant violations; recovery is not accepted.",
      );
      requireThat(
        lastInvariant === null ||
          Buffer.compare(Buffer.from(lastInvariant), Buffer.from(record.name)) < 0,
        "Invariant records must be unique and sorted.",
      );
      lastInvariant = record.name;
    }
  }
  requireThat(lastInvariant !== null, "Verification invariants are missing.");
  return text;
}
export function sameBaseline(before: string, after: string) {
  requireThat(
    baseline(before) === baseline(after),
    "Verification baseline changed; backup/recovery is not complete.",
  );
}
export function initialServices(value: string): Service[] {
  const services = value.split(/[\s,]+/).filter(Boolean);
  requireThat(
    services.every((name) => serviceNames.includes(name as Service)),
    "Unexpected service name.",
  );
  return serviceNames.filter((name) => services.includes(name));
}
export function recoveryTarget(target: string, project: string) {
  requireThat(
    /^djl-restore-[a-z0-9][a-z0-9-]{0,39}$/.test(project),
    "Use a new djl-restore-* project name.",
  );
  requireThat(
    posix.isAbsolute(target) && /^\/[A-Za-z0-9._/-]+$/.test(target),
    "Target must be an explicit absolute Linux path without special characters.",
  );
  const result = posix.resolve(target);
  requireThat(
    /^djl-restore-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(result.split("/").at(-1) ?? ""),
    "Use a new djl-restore-* target directory.",
  );
  return { target: result, project };
}

/** Stream gzip/tar validation: never extract untrusted paths, links, devices or extension records. */
export async function validateArchive(path: string) {
  regular(path);
  let header = Buffer.alloc(0);
  let skip = 0;
  let zeroBlocks = 0;
  let ended = false;
  let entries = 0;
  let expandedBytes = 0;
  const number = (bytes: Buffer) => {
    const text = bytes.toString("ascii").split("\0").join("").trim();
    requireThat(/^[0-7]+$/.test(text), "Unsupported tar number.");
    const value = Number.parseInt(text, 8);
    requireThat(Number.isSafeInteger(value) && value >= 0, "Invalid tar length.");
    return value;
  };
  const input = createReadStream(path);
  const unzip = createGunzip();
  input.on("error", (cause) => unzip.destroy(cause));
  input.pipe(unzip);
  try {
    for await (const data of unzip) {
      let chunk = Buffer.from(data);
      while (chunk.length) {
        if (ended) {
          requireThat(
            chunk.every((byte) => byte === 0),
            "Unexpected data after tar end.",
          );
          break;
        }
        if (skip) {
          const count = Math.min(skip, chunk.length);
          skip -= count;
          chunk = chunk.subarray(count);
          continue;
        }
        const count = Math.min(512 - header.length, chunk.length);
        header = Buffer.concat([header, chunk.subarray(0, count)]);
        chunk = chunk.subarray(count);
        if (header.length !== 512) continue;
        if (header.every((byte) => byte === 0)) {
          ended = ++zeroBlocks >= 2;
          header = Buffer.alloc(0);
          continue;
        }
        requireThat(zeroBlocks === 0, "Invalid tar end marker.");
        let checksum = 0;
        for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i]!;
        requireThat(checksum === number(header.subarray(148, 156)), "Tar checksum mismatch.");
        const text = (start: number, length: number) =>
          header
            .subarray(start, start + length)
            .toString("utf8")
            .split("\0")[0]!;
        const prefix = text(345, 155);
        const name = `${prefix ? `${prefix}/` : ""}${text(0, 100)}`;
        const type = text(156, 1);
        requireThat(
          type === "" || type === "0" || type === "5",
          "Tar links/devices/extension records are not permitted.",
        );
        requireThat(
          name.length &&
            !name.startsWith("/") &&
            !name.includes("\\") &&
            !Array.from(name).some(
              (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
            ) &&
            !name.split("/").includes(".."),
          "Unsafe tar path.",
        );
        const size = number(header.subarray(124, 136));
        requireThat(type !== "5" || size === 0, "Invalid tar directory.");
        expandedBytes += size;
        requireThat(
          Number.isSafeInteger(expandedBytes) && ++entries <= 1_000_000,
          "Archive exceeds verification limits.",
        );
        skip = Math.ceil(size / 512) * 512;
        header = Buffer.alloc(0);
      }
    }
    requireThat(ended && skip === 0 && header.length === 0, "Truncated tar archive.");
    return { entries, expandedBytes };
  } finally {
    input.destroy();
    unzip.destroy();
  }
}

export async function createManifest(
  directory: string,
  postgresImageId: string,
  storageImageId: string,
  running: string,
) {
  requireThat(
    imagePattern.test(postgresImageId) && imagePattern.test(storageImageId),
    "Invalid source image identifier.",
  );
  sameBaseline(
    readFileSync(resolve(directory, "baseline-before.jsonl"), "utf8"),
    readFileSync(resolve(directory, "recovery-baseline.jsonl"), "utf8"),
  );
  const dump = openSync(resolve(directory, "postgres.dump"), "r");
  try {
    const magic = Buffer.alloc(5);
    requireThat(
      readSync(dump, magic) === 5 && magic.toString() === "PGDMP",
      "Invalid Postgres custom dump.",
    );
  } finally {
    closeSync(dump);
  }
  await validateArchive(resolve(directory, "files.tar.gz"));
  const artifacts: RecoveryManifest["artifacts"] = [];
  for (const name of artifactNames) {
    const path = resolve(directory, name);
    const sizeBytes = regular(path).size;
    requireThat(sizeBytes > 0 && Number.isSafeInteger(sizeBytes), "Empty or oversized artifact.");
    artifacts.push({ name, sizeBytes, sha256: await sha256(path) });
  }
  const manifest: RecoveryManifest = {
    format: "djl-vps-backup",
    version: 1,
    completedAt: new Date().toISOString(),
    database: {
      name: "djl",
      postgresMajor: 17,
      image: "postgres:17-alpine",
      imageId: postgresImageId,
    },
    storage: { image: "chrislusf/seaweedfs:4.47", imageId: storageImageId },
    quiescence: {
      assumption: "all-writers-quiesced",
      initiallyRunning: initialServices(running),
      baselineBeforeAfterMatched: true,
    },
    artifacts,
    verification: { sqlSha256: await sha256(sqlPath) },
    exclusions: ["redis", "remote-relay", "local-ai", "private-configuration"],
  };
  writeFileSync(resolve(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  unlinkSync(resolve(directory, "baseline-before.jsonl"));
  return manifest;
}

export async function verifyBackup(directory: string): Promise<RecoveryManifest> {
  regular(resolve(directory, "manifest.json"));
  const manifest = JSON.parse(
    readFileSync(resolve(directory, "manifest.json"), "utf8"),
  ) as RecoveryManifest;
  requireThat(
    manifest.format === "djl-vps-backup" && manifest.version === 1,
    "Unsupported backup manifest.",
  );
  requireThat(
    typeof manifest.completedAt === "string" &&
      manifest.completedAt.endsWith("Z") &&
      Number.isFinite(Date.parse(manifest.completedAt)),
    "Invalid backup time.",
  );
  requireThat(
    manifest.database?.name === "djl" &&
      manifest.database.postgresMajor === 17 &&
      manifest.database.image === "postgres:17-alpine" &&
      imagePattern.test(manifest.database.imageId),
    "Unsupported database backup.",
  );
  requireThat(
    manifest.storage?.image === "chrislusf/seaweedfs:4.47" &&
      imagePattern.test(manifest.storage.imageId),
    "Unsupported storage backup.",
  );
  requireThat(
    manifest.quiescence?.assumption === "all-writers-quiesced" &&
      manifest.quiescence.baselineBeforeAfterMatched === true &&
      Array.isArray(manifest.quiescence.initiallyRunning),
    "Unverified quiescence baseline.",
  );
  initialServices(manifest.quiescence.initiallyRunning.join(","));
  requireThat(
    manifest.verification?.sqlSha256 === (await sha256(sqlPath)),
    "Verification SQL version mismatch; use the matching recovery source.",
  );
  requireThat(
    Array.isArray(manifest.artifacts) &&
      manifest.artifacts.length === artifactNames.length &&
      new Set(manifest.artifacts.map((entry) => entry.name)).size === artifactNames.length,
    "Incomplete artifact manifest.",
  );
  for (const name of artifactNames) {
    const entry = manifest.artifacts.find((item) => item.name === name);
    const path = resolve(directory, name);
    requireThat(
      entry &&
        digestPattern.test(entry.sha256) &&
        Number.isSafeInteger(entry.sizeBytes) &&
        entry.sizeBytes > 0 &&
        regular(path).size === entry.sizeBytes,
      "Artifact size mismatch.",
    );
    requireThat((await sha256(path)) === entry.sha256, "Artifact hash mismatch.");
  }
  baseline(readFileSync(resolve(directory, "recovery-baseline.jsonl"), "utf8"));
  await validateArchive(resolve(directory, "files.tar.gz"));
  return manifest;
}

if (import.meta.main) {
  try {
    const [command, directory, ...args] = process.argv.slice(2);
    requireThat(directory, "A backup directory is required.");
    if (command === "manifest") await createManifest(directory, args[0]!, args[1]!, args[2] ?? "");
    else if (command === "verify") {
      const manifest = await verifyBackup(directory);
      console.log(manifest.database.imageId);
      console.log(manifest.storage.imageId);
    } else if (command === "plan") {
      const manifest = await verifyBackup(directory);
      const target = recoveryTarget(args[0]!, args[1]!);
      console.log(
        JSON.stringify(
          {
            mode: "dry_run",
            ...target,
            backupCompletedAt: manifest.completedAt,
            services: ["postgres", "files-restore"],
            publishedPorts: [],
            applicationServices: [],
            mutableResourceCollisionCheck: "required_before_execute",
            externalReconciliation: "not_performed",
          },
          null,
          2,
        ),
      );
    } else if (command === "compare") {
      await verifyBackup(directory);
      sameBaseline(
        readFileSync(resolve(directory, "recovery-baseline.jsonl"), "utf8"),
        readFileSync(args[0]!, "utf8"),
      );
      console.log(
        "Restored database baseline matches. Storage/object and runtime checks remain separate; no external financial reconciliation was performed.",
      );
    } else throw new Error("Unknown recovery helper operation.");
  } catch (cause) {
    console.error(
      cause instanceof SyntaxError
        ? "Invalid backup metadata JSON."
        : cause instanceof Error
          ? cause.message
          : "Recovery verification failed.",
    );
    process.exitCode = 1;
  }
}
