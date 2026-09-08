// Migrates one legacy session through the installed CLI, retaining its source snapshot.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";

import { prepareWindowsSafeProcess } from "@synara/shared/windowsProcess";

export interface OpenCodeMigrationCommand {
  readonly binaryPath: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}
export interface OpenCodeMigrationCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}
export interface InstalledOpenCodeMigrationOptions {
  readonly binaryPath: string;
  readonly legacyRootDir: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly runCommand?: (
    input: OpenCodeMigrationCommand,
  ) => Promise<OpenCodeMigrationCommandResult>;
}

const execute = promisify(execFile);
async function runCommand(
  input: OpenCodeMigrationCommand,
): Promise<OpenCodeMigrationCommandResult> {
  const prepared = prepareWindowsSafeProcess(input.binaryPath, input.args, {
    cwd: input.cwd,
    env: input.env,
  });
  try {
    const output = await execute(prepared.command, prepared.args, {
      ...prepared,
      cwd: input.cwd,
      env: input.env,
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
      encoding: "utf8",
    });
    return { ...output, exitCode: 0 };
  } catch (error) {
    const failure = error as { code?: unknown; stdout?: string; stderr?: string };
    if (typeof failure.code !== "number")
      throw new Error("OpenCode migration CLI could not run.", { cause: error });
    return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", exitCode: failure.code };
  }
}

type Transcript = { info: Record<string, unknown> & { id: string }; messages: unknown[] };
function parseTranscript(value: string, sessionId: string): Transcript {
  const data = JSON.parse(value) as Transcript;
  if (!data || data.info?.id !== sessionId || !Array.isArray(data.messages)) {
    throw new Error("OpenCode migration export does not match the requested session.");
  }
  return data;
}
function comparable(data: Transcript) {
  // Official import assigns the current project; transcript and every other session field must survive.
  const { projectID: _project, path: _path, directory: _directory, ...info } = data.info;
  return { info, messages: data.messages };
}
async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function atomicWrite(path: string, value: string) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, path);
}

async function snapshotData(source: string, destination: string): Promise<void> {
  await cp(source, destination, {
    recursive: true,
    filter: (path) =>
      !["auth.json", "auth.json.lock"].includes(basename(path)) &&
      !/\.db(?:-wal|-shm|-journal)?$/.test(path),
  });
  // SQLite online backup includes committed WAL pages without modifying the live database.
  const entries = await readdir(source, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".db")) continue;
    const databasePath = join(entry.parentPath, entry.name);
    const { DatabaseSync, backup } = await import("node:sqlite");
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      await backup(database, join(destination, databasePath.slice(source.length + 1)));
    } finally {
      database.close();
    }
  }
}

const pending = new Map<string, Promise<string>>();
/** Call before resuming a legacy session. Never transfers auth. */
export function migrateInstalledOpenCodeSession(
  input: InstalledOpenCodeMigrationOptions,
): Promise<string> {
  const target = resolve(
    input.env.XDG_DATA_HOME ?? join(input.env.HOME ?? homedir(), ".local", "share"),
  );
  const key = `${resolve(input.legacyRootDir)}\0${target}\0${input.sessionId}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const result = migrate(input, target).finally(() => pending.delete(key));
  pending.set(key, result);
  return result;
}

async function migrate(input: InstalledOpenCodeMigrationOptions, target: string): Promise<string> {
  if (!/^ses_[A-Za-z0-9_-]+$/.test(input.sessionId))
    throw new Error("Invalid legacy OpenCode session ID.");
  if (target === resolve(input.legacyRootDir, "data"))
    throw new Error("Migration target must differ from legacy storage.");
  const targetKey = createHash("sha256").update(target).digest("hex").slice(0, 20);
  const directory = join(
    input.legacyRootDir,
    "installed-cli-migrations",
    targetKey,
    input.sessionId,
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const invoke = (args: string[], env = input.env) =>
    (input.runCommand ?? runCommand)({
      binaryPath: input.binaryPath,
      args,
      cwd: input.cwd,
      env,
    });
  const exportShared = async () => {
    const result = await invoke(["export", input.sessionId]);
    if (result.exitCode === 0) return parseTranscript(result.stdout, input.sessionId);
    // Do not treat network, permissions, database or executable errors as absence.
    if (result.stderr.includes(`Session not found: ${input.sessionId}`)) return undefined;
    throw new Error("Unable to check the shared OpenCode session; migration was not imported.");
  };
  const completed = await readOptional(join(directory, "complete.json"));
  if (completed) {
    const record = JSON.parse(completed) as { sessionId?: string; target?: string };
    if (record.sessionId !== input.sessionId || record.target !== target)
      throw new Error("Invalid OpenCode migration record.");
    // A migrated session may have new turns, so never compare it to its historical snapshot again.
    if (await exportShared()) return input.sessionId;
    throw new Error(
      "Previously migrated OpenCode session is missing from shared storage; retained backup requires recovery.",
    );
  }
  const exportPath = join(directory, "session.json");
  let sourceText = await readOptional(exportPath);
  if (!sourceText) {
    const snapshot = await mkdtemp(join(directory, "snapshot-"));
    await snapshotData(join(input.legacyRootDir, "data"), join(snapshot, "backup"));
    await cp(join(snapshot, "backup"), join(snapshot, "data"), { recursive: true });
    // Empty config/state/cache prevents loading legacy login or plugin configuration.
    const env = { ...input.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("OPENCODE_") || key === "DJL_MANAGED_AUTH") delete env[key];
    }
    Object.assign(env, {
      XDG_DATA_HOME: join(snapshot, "data"),
      XDG_CONFIG_HOME: join(snapshot, "config"),
      XDG_STATE_HOME: join(snapshot, "state"),
      XDG_CACHE_HOME: join(snapshot, "cache"),
      OPENCODE_DISABLE_PROJECT_CONFIG: "true",
      OPENCODE_DISABLE_AUTOUPDATE: "true",
    });
    const exported = await invoke(["export", input.sessionId], env);
    if (exported.exitCode !== 0)
      throw new Error(
        "Unable to export legacy OpenCode session; original storage and snapshot retained.",
      );
    parseTranscript(exported.stdout, input.sessionId);
    sourceText = exported.stdout;
    await atomicWrite(exportPath, sourceText);
  }
  const source = parseTranscript(sourceText, input.sessionId);
  const expectedDirectory = await realpath(input.cwd).catch(() => input.cwd);
  const verify = (destination: Transcript | undefined) => {
    if (
      !destination ||
      !isDeepStrictEqual(comparable(source), comparable(destination)) ||
      destination.info.directory !== expectedDirectory
    ) {
      throw new Error(
        "Shared OpenCode session conflicts with the retained legacy transcript; no further import attempted.",
      );
    }
  };
  const destination = await exportShared();
  if (destination) verify(destination);
  else {
    // Persist source before import. If interrupted after import, the next run verifies it above.
    const imported = await invoke(["import", exportPath]);
    if (imported.exitCode !== 0)
      throw new Error("OpenCode session import failed; retained export permits recovery.");
    verify(await exportShared());
  }
  await atomicWrite(
    join(directory, "complete.json"),
    JSON.stringify({ sessionId: input.sessionId, target }),
  );
  return input.sessionId;
}
