// FILE: knownHosts.ts
// Purpose: Explicit host-key trust for registered servers via ssh-keygen/ssh-keyscan.
// Layer: Servers domain helpers
import * as Crypto from "node:crypto";
import * as nodePath from "node:path";
import { Effect, FileSystem } from "effect";

import { runProcess } from "../processRunner";
import { SshRunnerError } from "./SshRunner";

/** "h" for port 22, "[h]:port" otherwise, matching OpenSSH known_hosts syntax. */
export function hostPattern(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${port}`;
}

/** Parses one known_hosts/keyscan line into its key type and the SHA256 fingerprint OpenSSH prints. */
export function fingerprintOfKeyLine(line: string): { type: string; fingerprint: string } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith("#")) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length < 3) return null;
  const type = parts[1];
  const base64 = parts[2];
  if (!type || !base64 || !/^(ssh-|ecdsa-|sk-)/.test(type)) return null;
  let blob: Buffer;
  try {
    blob = Buffer.from(base64, "base64");
  } catch {
    return null;
  }
  if (blob.length === 0) return null;
  const digest = Crypto.createHash("sha256").update(blob).digest("base64").replace(/=+$/, "");
  return { type, fingerprint: `SHA256:${digest}` };
}

/** ssh-keygen/ssh-keyscan live next to ssh when it is an absolute path, otherwise on PATH. */
function siblingTool(sshCommand: string, tool: "ssh-keygen" | "ssh-keyscan"): string {
  if (nodePath.isAbsolute(sshCommand)) {
    const ext = process.platform === "win32" ? ".exe" : "";
    return nodePath.join(nodePath.dirname(sshCommand), `${tool}${ext}`);
  }
  return tool;
}

export interface KnownHostsShape {
  /** `ssh-keygen -F` across every known_hosts file. */
  readonly isKnown: (host: string, port: number) => Effect.Effect<boolean, SshRunnerError>;
  /** `ssh-keyscan` key lines, comments removed. */
  readonly scan: (
    host: string,
    port: number,
  ) => Effect.Effect<ReadonlyArray<string>, SshRunnerError>;
  /** Appends the lines to the DJL known_hosts file. */
  readonly trust: (lines: ReadonlyArray<string>) => Effect.Effect<void, SshRunnerError>;
  /** `ssh-keygen -R` on the DJL known_hosts file only. */
  readonly forget: (host: string, port: number) => Effect.Effect<void, SshRunnerError>;
}

export const makeKnownHosts = (input: {
  sshCommand: string;
  knownHostsFiles: ReadonlyArray<string>;
  djlKnownHostsPath: string;
}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const keygen =
      process.env.DJL_SSH_KEYGEN_COMMAND ?? siblingTool(input.sshCommand, "ssh-keygen");
    const keyscan =
      process.env.DJL_SSH_KEYSCAN_COMMAND ?? siblingTool(input.sshCommand, "ssh-keyscan");

    const exec = (command: string, args: string[], timeoutMs: number) =>
      Effect.tryPromise({
        try: () =>
          runProcess(command, args, { timeoutMs, allowNonZeroExit: true, outputMode: "truncate" }),
        catch: (cause) => new SshRunnerError({ message: `Failed to run ${command}.`, cause }),
      });

    const isKnown: KnownHostsShape["isKnown"] = (host, port) =>
      Effect.gen(function* () {
        const pattern = hostPattern(host, port);
        for (const file of input.knownHostsFiles) {
          const exists = yield* fileSystem.exists(file).pipe(Effect.orElseSucceed(() => false));
          if (!exists) continue;
          const result = yield* exec(keygen, ["-F", pattern, "-f", file], 5_000);
          if (result.code === 0 && result.stdout.trim().length > 0) return true;
        }
        return false;
      });

    const scan: KnownHostsShape["scan"] = (host, port) =>
      exec(keyscan, ["-p", String(port), "-T", "5", "--", host], 10_000).pipe(
        Effect.map((result) =>
          result.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && !line.startsWith("#")),
        ),
      );

    const trust: KnownHostsShape["trust"] = (lines) =>
      Effect.gen(function* () {
        const existing = yield* fileSystem
          .readFileString(input.djlKnownHostsPath)
          .pipe(Effect.orElseSucceed(() => ""));
        const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
        yield* fileSystem
          .writeFileString(input.djlKnownHostsPath, `${existing}${prefix}${lines.join("\n")}\n`)
          .pipe(
            Effect.mapError(
              (cause) => new SshRunnerError({ message: "Failed to write known_hosts.", cause }),
            ),
          );
        yield* fileSystem
          .chmod(input.djlKnownHostsPath, 0o600)
          .pipe(Effect.orElseSucceed(() => undefined));
      });

    const forget: KnownHostsShape["forget"] = (host, port) =>
      exec(keygen, ["-R", hostPattern(host, port), "-f", input.djlKnownHostsPath], 5_000).pipe(
        Effect.asVoid,
      );

    return { isKnown, scan, trust, forget } satisfies KnownHostsShape;
  });
