import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, open, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { ComputerActivityGenerationError } from "./computerActivitySummarization";

// Identity of the installed runtime whose effective no-tools wire recipe was
// measured. New versions require new verification, not a permissive version range.
const nativeDigest = "a45099154d7fb4a5ed8a56f40966a95deb938e508bab23e6985035c709e9a85a";
const wrapperDigest = "61b0194f3bb6534439c8d26a3ed57d0805f84b884588b761795323eeb92fcf70";
const unavailable = () => new ComputerActivityGenerationError("provider-unavailable");
function check(signal: AbortSignal) {
  if (signal.aborted) throw new ComputerActivityGenerationError("generation-failed");
}
async function fingerprint(file: string, signal: AbortSignal): Promise<string> {
  check(signal);
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    check(signal);
    if (
      !before.isFile() ||
      !(before.mode & 0o111) ||
      before.size < 1 ||
      before.size > 512 * 1024 * 1024
    )
      throw unavailable();
    const hash = createHash("sha256"),
      buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    while (bytes < before.size) {
      check(signal);
      const read = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, before.size - bytes),
        bytes,
      );
      check(signal);
      if (!read.bytesRead) throw unavailable();
      hash.update(buffer.subarray(0, read.bytesRead));
      bytes += read.bytesRead;
    }
    const after = await handle.stat();
    check(signal);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw unavailable();
    const current = await stat(file);
    check(signal);
    if (
      after.dev !== current.dev ||
      after.ino !== current.ino ||
      after.size !== current.size ||
      after.mtimeMs !== current.mtimeMs ||
      after.ctimeMs !== current.ctimeMs ||
      !(current.mode & 0o111)
    )
      throw unavailable();
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

export async function resolveActivityCodexRuntime(input: {
  readonly binaryPath?: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
}): Promise<
  Readonly<{ executable: string; sha256: string; recipe: "codex-0.165.0-darwin-arm64-no-tools-v1" }>
> {
  check(input.signal);
  try {
    if (process.platform !== "darwin" || process.arch !== "arm64") throw unavailable();
    const command = input.binaryPath?.trim() || "codex";
    if (
      command.length > 8192 ||
      Array.from(command).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw unavailable();
    let selected: string | undefined;
    if (path.isAbsolute(command)) selected = await realpath(command);
    else {
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(command)) throw unavailable();
      const sourcePath = Object.hasOwn(input.environment, "PATH")
        ? input.environment.PATH
        : undefined;
      if (typeof sourcePath !== "string" || sourcePath.length > 32_768) throw unavailable();
      const entries = sourcePath.split(path.delimiter);
      if (entries.length > 128) throw unavailable();
      for (const directory of entries) {
        check(input.signal);
        if (!path.isAbsolute(directory)) continue;
        const candidate = path.join(directory, command);
        try {
          await access(candidate, constants.X_OK);
          check(input.signal);
          const candidateStat = await stat(candidate);
          check(input.signal);
          if (!candidateStat.isFile()) continue;
          selected = await realpath(candidate);
          check(input.signal);
          break;
        } catch (error) {
          if (
            !["ENOENT", "ENOTDIR", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")
          )
            throw error;
        }
      }
    }
    if (!selected) throw unavailable();
    let digest = await fingerprint(selected, input.signal);
    if (digest === wrapperDigest) {
      const packagePath = createRequire(selected).resolve(
        "@openai/codex-darwin-arm64/package.json",
      );
      selected = await realpath(
        path.join(path.dirname(packagePath), "vendor/aarch64-apple-darwin/bin/codex"),
      );
      digest = await fingerprint(selected, input.signal);
    }
    if (digest !== nativeDigest) throw unavailable();
    check(input.signal);
    return Object.freeze({
      executable: selected,
      sha256: digest,
      recipe: "codex-0.165.0-darwin-arm64-no-tools-v1",
    });
  } catch (error) {
    check(input.signal);
    throw error instanceof ComputerActivityGenerationError ? error : unavailable();
  }
}
