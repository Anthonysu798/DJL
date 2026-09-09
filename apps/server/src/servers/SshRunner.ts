// FILE: SshRunner.ts
// Purpose: Runs one command on a registered server through the system OpenSSH client.
//          Secrets reach ssh via SSH_ASKPASS reading a 0600 temp file that is always deleted.
// Layer: Servers runtime service
import type { ServerCapabilities, ServerRecord, ServerTestOutcome } from "@synara/contracts";
import * as Crypto from "node:crypto";
import * as os from "node:os";
import { Data, Effect, FileSystem, Layer, Path, ServiceMap } from "effect";

import { ServerSecretStore } from "../auth/Services/ServerSecretStore";
import { ServerConfig } from "../config";
import { runProcess } from "../processRunner";
import { serverSecretName } from "./secrets";
import { buildSshArgs, buildSshEnv } from "./sshArgs";
import { classifySshResult, redactSshStderr, sanitizeSshStderr } from "./sshOutcome";

export class SshRunnerError extends Data.TaggedError("SshRunnerError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface SshRunResult {
  readonly outcome: ServerTestOutcome;
  readonly stdout: string;
  /** Raw stderr with secrets redacted, so callers can show ssh's own error text. */
  readonly stderr: string;
  /** ssh's exit status (the remote command's on success, 255 for ssh's own failures); null when killed. */
  readonly exitCode: number | null;
  readonly message: string | undefined;
  readonly latencyMs: number;
}

export interface SshRunInput {
  readonly server: ServerRecord;
  readonly command: string;
  /** Password or passphrase, when the auth method needs askpass. */
  readonly secret: string | null;
  /** Default 20_000. */
  readonly timeoutMs?: number;
}

export interface SshRunnerShape {
  readonly run: (input: SshRunInput) => Effect.Effect<SshRunResult, SshRunnerError>;
  readonly capabilities: () => Effect.Effect<ServerCapabilities>;
  /** [djlKnownHosts, userKnownHosts] */
  readonly knownHostsFiles: ReadonlyArray<string>;
  readonly djlKnownHostsPath: string;
  readonly sshCommand: string;
}

export class SshRunner extends ServiceMap.Service<SshRunner, SshRunnerShape>()(
  "synara/servers/SshRunner",
) {}

const DEFAULT_TIMEOUT_MS = 20_000;
const isWindows = process.platform === "win32";

export function defaultSshCommand(): string {
  if (process.env.DJL_SSH_COMMAND) return process.env.DJL_SSH_COMMAND;
  if (isWindows) {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    return `${systemRoot}\\System32\\OpenSSH\\ssh.exe`;
  }
  return "ssh";
}

export function parseSshVersion(banner: string): string | null {
  const match = /OpenSSH[_ ]([0-9]+\.[0-9]+)/i.exec(banner);
  return match?.[1] ?? null;
}

export function askpassSupportedForVersion(version: string | null): boolean {
  if (!version) return false;
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 8 || (major === 8 && minor >= 4);
}

const POSIX_HELPER = `#!/bin/sh\ncat "$DJL_SSH_SECRET_FILE"\n`;
const WINDOWS_HELPER = `@echo off\r\ntype "%DJL_SSH_SECRET_FILE%"\r\n`;

export const makeSshRunner = (options: { sshCommand?: string } = {}) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig;
    const secretStore = yield* ServerSecretStore;

    const sshCommand = options.sshCommand ?? defaultSshCommand();
    const sshDir = path.join(config.stateDir, "ssh");
    const askpassDir = path.join(sshDir, "askpass");
    const helperPath = path.join(sshDir, isWindows ? "djl-askpass.cmd" : "djl-askpass");
    const djlKnownHostsPath = path.join(sshDir, "known_hosts");
    const userKnownHostsPath = path.join(os.homedir(), ".ssh", "known_hosts");
    const knownHostsFiles = [djlKnownHostsPath, userKnownHostsPath];

    const ioError = (message: string) => (cause: unknown) => new SshRunnerError({ message, cause });

    yield* fileSystem
      .makeDirectory(askpassDir, { recursive: true })
      .pipe(Effect.mapError(ioError("Failed to create ssh state directory.")));
    yield* fileSystem.chmod(sshDir, 0o700).pipe(Effect.orElseSucceed(() => undefined));
    yield* fileSystem.chmod(askpassDir, 0o700).pipe(Effect.orElseSucceed(() => undefined));
    yield* fileSystem
      .writeFileString(helperPath, isWindows ? WINDOWS_HELPER : POSIX_HELPER)
      .pipe(Effect.mapError(ioError("Failed to write askpass helper.")));
    yield* fileSystem.chmod(helperPath, 0o700).pipe(Effect.orElseSucceed(() => undefined));
    const knownHostsExists = yield* fileSystem
      .exists(djlKnownHostsPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!knownHostsExists) {
      yield* fileSystem
        .writeFileString(djlKnownHostsPath, "")
        .pipe(Effect.mapError(ioError("Failed to create known_hosts.")));
      yield* fileSystem.chmod(djlKnownHostsPath, 0o600).pipe(Effect.orElseSucceed(() => undefined));
    }

    const writeSecretFile = (secret: string) =>
      Effect.gen(function* () {
        const secretFilePath = path.join(askpassDir, `${Crypto.randomUUID()}.secret`);
        yield* fileSystem
          .writeFileString(secretFilePath, secret)
          .pipe(Effect.mapError(ioError("Failed to stage askpass secret.")));
        yield* fileSystem.chmod(secretFilePath, 0o600).pipe(Effect.orElseSucceed(() => undefined));
        return secretFilePath;
      });

    const removeSecretFile = (secretFilePath: string) =>
      fileSystem.remove(secretFilePath, { force: true }).pipe(Effect.ignore);

    const run: SshRunnerShape["run"] = (input) =>
      Effect.gen(function* () {
        const importedKeyPath =
          input.server.auth.type === "importedKey"
            ? secretStore.pathOf(serverSecretName(input.server.id, "privateKey"))
            : null;
        const plan = buildSshArgs({
          server: input.server,
          command: input.command,
          knownHostsFiles,
          importedKeyPath,
        });
        if (plan.needsAskpass && input.secret === null) {
          return {
            outcome: "auth-failed" as const,
            stdout: "",
            stderr: "",
            exitCode: null,
            message: "This server needs a stored password or passphrase, but none is saved.",
            latencyMs: 0,
          };
        }
        const secretFilePath =
          plan.needsAskpass && input.secret !== null ? yield* writeSecretFile(input.secret) : null;
        const env = buildSshEnv(
          process.env,
          secretFilePath ? { helperPath, secretFilePath } : null,
        );
        const started = Date.now();
        const raw = yield* Effect.tryPromise({
          try: () =>
            runProcess(sshCommand, plan.args, {
              env,
              timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
              allowNonZeroExit: true,
              maxBufferBytes: 1024 * 1024,
              outputMode: "truncate",
            }),
          catch: (cause) => new SshRunnerError({ message: "Failed to start ssh.", cause }),
        }).pipe(Effect.ensuring(secretFilePath ? removeSecretFile(secretFilePath) : Effect.void));
        const latencyMs = Date.now() - started;
        const outcome = classifySshResult(raw);
        const redactions = [secretFilePath ?? "", input.secret ?? ""];
        const message =
          outcome === "ok"
            ? undefined
            : sanitizeSshStderr(raw.stderr || (raw.timedOut ? "Timed out." : ""), redactions) ||
              undefined;
        return {
          outcome,
          stdout: raw.stdout,
          stderr: redactSshStderr(raw.stderr, redactions),
          exitCode: raw.code,
          message,
          latencyMs,
        };
      });

    const capabilities: SshRunnerShape["capabilities"] = () =>
      Effect.tryPromise(() =>
        runProcess(sshCommand, ["-V"], { timeoutMs: 5_000, allowNonZeroExit: true }),
      ).pipe(
        Effect.map((result) => {
          const version = parseSshVersion(`${result.stderr}\n${result.stdout}`);
          return {
            sshPath: sshCommand,
            sshVersion: version,
            askpassSupported: isWindows ? askpassSupportedForVersion(version) : version !== null,
          } satisfies ServerCapabilities;
        }),
        Effect.orElseSucceed(
          (): ServerCapabilities => ({ sshPath: null, sshVersion: null, askpassSupported: false }),
        ),
      );

    return {
      run,
      capabilities,
      knownHostsFiles,
      djlKnownHostsPath,
      sshCommand,
    } satisfies SshRunnerShape;
  });

export const makeSshRunnerLayer = (options: { sshCommand?: string } = {}) =>
  Layer.effect(SshRunner, makeSshRunner(options));

export const SshRunnerLive = makeSshRunnerLayer();
