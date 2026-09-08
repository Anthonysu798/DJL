import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { prepareWindowsSafeProcess } from "@synara/shared/windowsProcess";
import type { HarnessLegacyOpenCodeCredentialsResult } from "@synara/contracts";

type Credentials = Record<string, unknown>;
export interface OpenCodeCredentialTransferOptions {
  readonly legacyRootDir: string;
  readonly binaryPath: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly resolveDataDirectory?: () => Promise<string>;
}
async function readStore(path: string): Promise<{ text: string | undefined; data: Credentials }> {
  let text: string;
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new Error("Credential store links cannot be transferred.");
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { text: undefined, data: {} };
    // oxlint-disable-next-line eslint/preserve-caught-error -- Keep private credential-store paths out of RPC-facing errors.
    throw new Error("Unable to read the OpenCode credential store.");
  }
  try {
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return { text, data: data as Credentials };
  } catch {
    throw new Error("OpenCode credential store is invalid; nothing was transferred.");
  }
}
function providerIds(data: Credentials): string[] {
  return Object.keys(data)
    .filter((id) => /^[a-zA-Z0-9._:/-]{1,128}$/.test(id))
    .toSorted();
}
async function dataDirectory(options: OpenCodeCredentialTransferOptions): Promise<string> {
  if (options.resolveDataDirectory) return options.resolveDataDirectory();
  const env = options.env ?? process.env;
  const command = prepareWindowsSafeProcess(options.binaryPath, ["debug", "paths"], { env });
  try {
    const { stdout } = await promisify(execFile)(command.command, command.args, {
      ...command,
      env,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    const path = /^data\s+(.+)$/m.exec(stdout)?.[1]?.trim();
    if (path && isAbsolute(path)) return path;
  } catch {
    /* Return a fixed message without CLI output or credentials. */
  }
  throw new Error("Unable to locate installed OpenCode credentials.");
}
const sourcePath = (options: OpenCodeCredentialTransferOptions) =>
  join(options.legacyRootDir, "data", "opencode", "auth.json");

/** Returns provider identifiers only. No credential values cross the API boundary. */
export async function listLegacyOpenCodeCredentials(
  options: OpenCodeCredentialTransferOptions,
): Promise<HarnessLegacyOpenCodeCredentialsResult> {
  const source = await readStore(sourcePath(options));
  const available = providerIds(source.data);
  if (!available.length)
    return { availableProviderIds: [], existingProviderIds: [], transferredProviderIds: [] };
  const target = await readStore(join(await dataDirectory(options), "auth.json"));
  return {
    availableProviderIds: available.filter((id) => !Object.hasOwn(target.data, id)),
    existingProviderIds: available.filter((id) => Object.hasOwn(target.data, id)),
    transferredProviderIds: [],
  };
}

/** Called only by the explicit transfer action. Existing destination entries always win. */
export async function transferLegacyOpenCodeCredentials(
  options: OpenCodeCredentialTransferOptions,
): Promise<HarnessLegacyOpenCodeCredentialsResult> {
  const source = await readStore(sourcePath(options));
  if (!providerIds(source.data).length)
    return { availableProviderIds: [], existingProviderIds: [], transferredProviderIds: [] };
  const directory = await dataDirectory(options);
  const targetPath = join(directory, "auth.json");
  if (resolve(targetPath) === resolve(sourcePath(options)))
    throw new Error("Credential source and destination must differ.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, "auth.json.djl-transfer.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch {
    throw new Error(
      "Another OpenCode credential transfer is in progress; try again after it finishes.",
    );
  }
  const temporary = join(directory, `.auth-djl-${randomUUID()}.tmp`);
  try {
    const target = await readStore(targetPath);
    const transferred = providerIds(source.data).filter((id) => !Object.hasOwn(target.data, id));
    const existing = providerIds(source.data).filter((id) => Object.hasOwn(target.data, id));
    if (!transferred.length)
      return {
        availableProviderIds: [],
        existingProviderIds: existing,
        transferredProviderIds: [],
      };
    const backupDirectory = join(options.legacyRootDir, "credential-transfer-backups");
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    await writeFile(join(backupDirectory, `${randomUUID()}.json`), source.text!, {
      mode: 0o600,
      flag: "wx",
    });
    const merged = { ...target.data };
    for (const id of transferred)
      Object.defineProperty(merged, id, {
        value: source.data[id],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    await writeFile(temporary, JSON.stringify(merged, null, 2), { mode: 0o600, flag: "wx" });
    const current = await readStore(targetPath);
    if (current.text !== target.text)
      throw new Error(
        "OpenCode credentials changed during transfer; retry to preserve those changes.",
      );
    if (target.text === undefined)
      await link(temporary, targetPath); // Exclusive creation preserves a concurrently created login.
    else await rename(temporary, targetPath);
    return {
      availableProviderIds: [],
      existingProviderIds: existing,
      transferredProviderIds: transferred,
    };
  } finally {
    await rm(temporary, { force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
