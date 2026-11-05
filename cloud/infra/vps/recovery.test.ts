import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  baseline,
  createManifest,
  initialServices,
  recoveryTarget,
  sameBaseline,
  validateArchive,
  verifyBackup,
} from "./recovery.ts";

const directories: string[] = [];
const fixture = () => {
  const directory = mkdtempSync(resolve(tmpdir(), "djl-recovery-test-"));
  directories.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(resolve(tmpdir(), "djl-recovery-test-")))
      throw new Error("Unsafe fixture cleanup.");
    rmSync(directory, { recursive: true });
  }
});
const validBaseline =
  [
    { format: "djl-vps-recovery-baseline", version: 1 },
    { kind: "table", schema: "public", name: "commerce_ledger", rows: "2", sha256: "1".repeat(64) },
    { kind: "invariant", name: "commerce_journals_balanced", violations: "0" },
  ]
    .map((record) => JSON.stringify(record))
    .join("\n") + "\n";
function tar(entries: { name: string; type?: string; bytes?: Buffer }[]) {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    const bytes = entry.bytes ?? Buffer.alloc(0);
    header.write(entry.name, 0, 100);
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124);
    header.write("00000000000\0", 136);
    header.fill(32, 148, 156);
    header.write(entry.type ?? "0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
    blocks.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
async function sealed() {
  const directory = fixture();
  writeFileSync(
    resolve(directory, "postgres.dump"),
    "PGDMP synthetic fixture, not a real pg_restore archive",
  );
  writeFileSync(
    resolve(directory, "files.tar.gz"),
    tar([{ name: "./file.dat", bytes: Buffer.from("synthetic") }]),
  );
  writeFileSync(resolve(directory, "baseline-before.jsonl"), validBaseline);
  writeFileSync(resolve(directory, "recovery-baseline.jsonl"), validBaseline);
  await createManifest(directory, `sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`, "s3 api");
  return directory;
}

describe("offline recovery artifacts, not Docker/pg_restore acceptance", () => {
  it("seals exact size/hash artifacts and SQL version without credentials, and verifies them", async () => {
    const directory = await sealed();
    const manifest = await verifyBackup(directory);
    expect(manifest.version).toBe(1);
    expect(manifest.quiescence.initiallyRunning).toEqual(["s3", "api"]);
    expect(manifest.artifacts.map((entry) => entry.name)).toEqual([
      "postgres.dump",
      "files.tar.gz",
      "recovery-baseline.jsonl",
    ]);
    expect(existsSync(resolve(directory, "baseline-before.jsonl"))).toBe(false);
    expect(JSON.stringify(manifest)).not.toMatch(/PASSWORD|SECRET|DATABASE_URL|sk_test_/);
  });
  it("rejects missing, changed and wrongly versioned artifacts rather than accepting partial backups", async () => {
    const directory = await sealed();
    const path = resolve(directory, "postgres.dump");
    const original = readFileSync(path);
    writeFileSync(path, Buffer.alloc(original.length, 48));
    await expect(verifyBackup(directory)).rejects.toThrow("hash mismatch");
    writeFileSync(path, original);
    const manifestPath = resolve(directory, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.verification.sqlSha256 = "0".repeat(64);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    await expect(verifyBackup(directory)).rejects.toThrow("SQL version mismatch");
    manifest.version = 2;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    await expect(verifyBackup(directory)).rejects.toThrow("Unsupported backup");
  });
  it("refuses a source changing around pg_dump or any nonzero financial invariant", () => {
    expect(baseline(validBaseline)).toBe(validBaseline);
    expect(() =>
      sameBaseline(validBaseline, validBaseline.replace('"rows":"2"', '"rows":"3"')),
    ).toThrow("baseline changed");
    expect(() => baseline(validBaseline.replace('"violations":"0"', '"violations":"1"'))).toThrow(
      "invariant violations",
    );
    expect(() => baseline(validBaseline.trimEnd())).toThrow("newline-terminated");
    const lines = validBaseline.trimEnd().split("\n");
    expect(() => baseline([lines[0], lines[2], lines[1], ""].join("\n"))).toThrow(
      "table fingerprint",
    );
    expect(() => baseline([lines[0], lines[1], lines[1], lines[2], ""].join("\n"))).toThrow(
      "unique and sorted",
    );
  });
  it("validates gzip/tar bytes without extracting, and rejects traversal, links, devices, extensions and truncation", async () => {
    const directory = fixture();
    const path = resolve(directory, "files.tar.gz");
    writeFileSync(
      path,
      tar([
        { name: "./", type: "5" },
        { name: "./file", bytes: Buffer.from("abc") },
      ]),
    );
    await expect(validateArchive(path)).resolves.toEqual({ entries: 2, expandedBytes: 3 });
    for (const entry of [
      { name: "../escape" },
      { name: "/absolute" },
      { name: "safe/../escape" },
      { name: "back\\slash" },
      ...["1", "2", "3", "4", "x", "L"].map((type) => ({ name: "record", type })),
    ]) {
      writeFileSync(path, tar([entry]));
      await expect(validateArchive(path)).rejects.toThrow();
    }
    writeFileSync(path, gzipSync(Buffer.alloc(512)));
    await expect(validateArchive(path)).rejects.toThrow("Truncated");
    writeFileSync(path, tar([{ name: "file" }]).subarray(0, 20));
    await expect(validateArchive(path)).rejects.toThrow();
  });
  it("requires explicit independent target/project names and only fixed service-state names", () => {
    expect(recoveryTarget("/tmp/djl-restore-new", "djl-restore-new")).toEqual({
      target: "/tmp/djl-restore-new",
      project: "djl-restore-new",
    });
    for (const [target, project] of [
      ["relative", "djl-restore-new"],
      ["/srv/djl-cloud-production", "djl-cloud"],
      ["/tmp/djl-restore-a,$HOME", "djl-restore-a"],
    ])
      expect(() => recoveryTarget(target!, project!)).toThrow();
    expect(initialServices("api s3 api")).toEqual(["s3", "api"]);
    expect(initialServices("")).toEqual([]);
    expect(() => initialServices("postgres api")).toThrow("Unexpected service");
  });
  it("keeps isolated Compose structurally separate: no published ports, app services, .env or provider values", () => {
    const text = readFileSync(new URL("recovery.compose.yml", import.meta.url), "utf8");
    expect(text).not.toMatch(/^\s*(?:ports|api|worker|redis|remote-relay|proxy|env_file):/m);
    expect(text).not.toMatch(/STRIPE|OPENAI|ANTHROPIC|RESEND|APNS|BETTER_AUTH|restart: unless/);
    expect(text).toContain("pull_policy: never");
    expect(text).toContain("network_mode: none");
    expect(text).toContain("external: true");
    const filesRestore = text
      .split(/^  files-restore:[ \t]*\r?$/m)[1]
      ?.split(/^(?:  [\w-]+:|[^\s#])/m)[0];
    expect(filesRestore).toMatch(
      /      - type: volume\r?\n        source: s3-data\r?\n        target: \/data\r?\n        volume:\r?\n          nocopy: true(?:\r?\n|$)/,
    );
    const script = readFileSync(new URL("recovery.sh", import.meta.url), "utf8");
    expect(script).toContain("docker network create --internal");
    expect(script).toContain("--env-file /dev/null");
    expect(script).not.toMatch(
      /docker.*(?:system prune|volume rm)|down --volumes|migrate\.ts|seed\.ts/,
    );
  });
});

// Real Bash control flow with a synthetic Docker executable; never contacts a Docker daemon.
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const unix = (path: string) =>
  path
    .replaceAll("\\", "/")
    .replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`);
function scriptFixture(running: string, stopFailure = false) {
  const directory = fixture();
  const bin = resolve(directory, "bin");
  mkdirSync(bin);
  copyFileSync(new URL("recovery.sh", import.meta.url), resolve(directory, "recovery.sh"));
  writeFileSync(resolve(directory, "recovery-verify.sql"), "-- synthetic stdin only\n");
  writeFileSync(
    resolve(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$MOCK_LOG"
if [[ "$*" == compose*'ps --all --quiet '* ]]; then echo "\${@: -1}-id"; exit 0; fi
if [[ "$*" == compose*'ps --quiet postgres' ]]; then echo postgres-id; exit 0; fi
if [[ "$*" == inspect*'.State.Status'* ]]; then
  service=\${@: -1}; service=\${service%-id}
  if [[ "$MOCK_PAUSED" == "$service" ]]; then echo 'paused true'; exit 0; fi
  if [[ " $MOCK_RUNNING " == *" $service "* ]]; then echo 'running false'; else echo 'exited false'; fi
  exit 0
fi
if [[ "$*" == inspect*'.Mounts'* ]]; then echo mock-storage-data; exit 0; fi
if [[ "$*" == inspect* ]]; then printf 'sha256:%064d\\n' 0; exit 0; fi
if [[ "$*" == compose*' stop '* ]]; then [[ "$MOCK_STOP_FAILURE" != true ]]; exit $?; fi
if [[ "$*" == compose*' start '* ]]; then [[ "$MOCK_START_FAILURE" != true ]]; exit $?; fi
if [[ "$*" == 'context inspect '* ]]; then echo 'unix:///var/run/docker.sock'; exit 0; fi
if [[ "$*" == 'ps --all --quiet --filter '* ]]; then
  if [[ "$MOCK_COLLISION" == project ]]; then echo existing-container; fi
  exit 0
fi
if [[ "$*" == 'volume ls '* || "$*" == 'network ls '* ]]; then exit 0; fi
if [[ "$*" == 'volume inspect '* ]]; then [[ "$MOCK_COLLISION" == volume ]]; exit $?; fi
if [[ "$*" == 'network inspect '* ]]; then exit 1; fi
if [[ "$*" == compose*'show server_version_num'* ]]; then echo 170006; exit 0; fi
if [[ "$*" == compose*'psql '* ]]; then cat > /dev/null; printf '%s' "$MOCK_BASELINE"; exit 0; fi
if [[ "$*" == compose*'pg_dump '* ]]; then echo PGDMP; exit 44; fi
if [[ "$*" == run* ]]; then echo '{}'; exit 0; fi
echo 'Unexpected synthetic Docker invocation' >&2
exit 99
`,
    { mode: 0o700 },
  );
  return {
    directory,
    run: (args = "backup", overrides: Record<string, string> = {}) =>
      spawnSync(bash, ["-c", `export PATH='${unix(bin)}':"$PATH"; bash ./recovery.sh ${args}`], {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          MOCK_RUNNING: running,
          MOCK_STOP_FAILURE: String(stopFailure),
          MOCK_LOG: resolve(directory, "commands.log"),
          MOCK_BASELINE: validBaseline,
          DOCKER_HOST: "",
          DOCKER_CONTEXT: "",
          ...overrides,
        },
      }),
    log: () => readFileSync(resolve(directory, "commands.log"), "utf8"),
  };
}
describe("offline Bash orchestration with a fake Docker binary", () => {
  it("preserves originally stopped services when dump fails and retains only a partial backup", () => {
    const fixture = scriptFixture("s3");
    const result = fixture.run();
    expect(result.status, result.stderr).toBe(44);
    expect(fixture.log()).toContain("stop s3\n");
    expect(fixture.log()).toContain("start s3\n");
    expect(fixture.log()).not.toMatch(/start .*api|start .*worker/);
    expect(existsSync(resolve(fixture.directory, ".env"))).toBe(false);
  });
  it("registers cleanup before a partially failing stop and never starts previously stopped workers", () => {
    const fixture = scriptFixture("s3 api", true);
    const result = fixture.run();
    expect(result.status, result.stderr).toBe(1);
    expect(fixture.log()).toContain("stop s3 api\n");
    expect(fixture.log()).toContain("start s3 api\n");
    expect(fixture.log()).not.toContain("start s3 api worker");
  });
  it("does not start any originally stopped service", () => {
    const fixture = scriptFixture("");
    expect(fixture.run().status).toBe(44);
    expect(fixture.log()).not.toMatch(/ stop | start /);
  });
  it("preserves the primary dump error even if restoring the original service state also fails", () => {
    const setup = scriptFixture("s3");
    const result = setup.run("backup", { MOCK_START_FAILURE: "true" });
    expect(result.status).toBe(44);
    expect(result.stderr).toContain("Failed to restore originally running services");
  });
  it("refuses paused source services before a stop, dump or target is created", () => {
    const setup = scriptFixture("s3");
    const result = setup.run("backup", { MOCK_PAUSED: "s3" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unstable/paused");
    expect(setup.log()).not.toMatch(/ stop | start |pg_dump/);
    expect(existsSync(resolve(setup.directory, "backups"))).toBe(false);
  });
  it("rejects existing project resources or named volumes before creating any recovery target", () => {
    for (const collision of ["project", "volume"]) {
      const setup = scriptFixture("");
      const target = resolve(fixture(), `djl-restore-${collision}`);
      const result = setup.run(
        `restore '${unix(setup.directory)}' --target '${unix(target)}' --project djl-restore-${collision} --execute`,
        { MOCK_COLLISION: collision },
      );
      expect(result.status, result.stderr).toBe(1);
      expect(result.stderr).toContain("already exist");
      expect(existsSync(target)).toBe(false);
      expect(setup.log()).not.toMatch(/volume create|network create|compose .*up|pg_restore/);
    }
  });
  it("defaults restore to a stateless plan and refuses an existing target before any Docker command", () => {
    const setup = scriptFixture("");
    const target = resolve(fixture(), "djl-restore-new");
    const result = setup.run(
      `restore '${unix(setup.directory)}' --target '${unix(target)}' --project djl-restore-new`,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("DRY RUN");
    expect(existsSync(target)).toBe(false);
    expect(setup.log()).not.toMatch(/volume create|network create|compose .*up|pg_restore/);
    mkdirSync(target);
    const before = setup.log();
    expect(
      setup.run(
        `restore '${unix(setup.directory)}' --target '${unix(target)}' --project djl-restore-new --execute`,
      ).status,
    ).toBe(1);
    expect(setup.log()).toBe(before);
  });
  it("refuses a .partial source before validation or any Docker invocation", () => {
    const setup = scriptFixture("");
    const source = resolve(setup.directory, "backup.partial");
    mkdirSync(source);
    const target = resolve(fixture(), "djl-restore-partial");
    const result = setup.run(
      `restore '${unix(source)}' --target '${unix(target)}' --project djl-restore-partial`,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Partial backups");
    expect(existsSync(resolve(setup.directory, "commands.log"))).toBe(false);
    expect(existsSync(target)).toBe(false);
  });
});
