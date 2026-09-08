// FILE: sshArgs.ts
// Purpose: Pure builder for OpenSSH argv/env. No IO, no secrets on argv.
// Layer: Servers domain helpers
import type { ServerRecord } from "@synara/contracts";

export interface SshInvocationPlan {
  /** Everything after `ssh`, ending with the remote command. */
  readonly args: ReadonlyArray<string>;
  /** True when a secret must be delivered via askpass. */
  readonly needsAskpass: boolean;
  readonly askpassSecretKind: "password" | "passphrase" | null;
}

export interface SshArgsInput {
  readonly server: Pick<ServerRecord, "host" | "port" | "username" | "auth" | "sshConfigAlias">;
  readonly command: string;
  /** DJL file first, then the user's. */
  readonly knownHostsFiles: ReadonlyArray<string>;
  /** From ServerSecretStore.pathOf, when auth.type === "importedKey". */
  readonly importedKeyPath: string | null;
  /** Default 10. */
  readonly connectTimeoutSeconds?: number;
}

export function knownHostsOptionValue(files: ReadonlyArray<string>): string {
  return files.map((file) => `"${file.replace(/"/g, '\\"')}"`).join(" ");
}

export function buildSshArgs(input: SshArgsInput): SshInvocationPlan {
  const { server, command, knownHostsFiles, importedKeyPath } = input;
  const timeout = input.connectTimeoutSeconds ?? 10;
  const auth = server.auth;

  const askpassSecretKind: SshInvocationPlan["askpassSecretKind"] =
    auth.type === "password"
      ? "password"
      : (auth.type === "keyPath" || auth.type === "importedKey") && auth.hasPassphrase
        ? "passphrase"
        : null;
  const needsAskpass = askpassSecretKind !== null;

  const options: string[] = [
    "-T",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${knownHostsOptionValue(knownHostsFiles)}`,
    "-o",
    `ConnectTimeout=${timeout}`,
    "-o",
    "LogLevel=ERROR",
    "-o",
    "NumberOfPasswordPrompts=1",
    "-o",
    "KbdInteractiveAuthentication=no",
    "-p",
    String(server.port),
  ];

  if (!needsAskpass) options.push("-o", "BatchMode=yes");

  if (auth.type === "password") {
    options.push("-o", "PreferredAuthentications=password", "-o", "PubkeyAuthentication=no");
  } else {
    options.push("-o", "PasswordAuthentication=no");
  }

  if (auth.type === "keyPath") {
    options.push("-i", auth.path, "-o", "IdentitiesOnly=yes");
  } else if (auth.type === "importedKey" && importedKeyPath) {
    options.push("-i", importedKeyPath, "-o", "IdentitiesOnly=yes");
  }

  const target = `${server.username}@${server.host}`;
  return { args: [...options, target, "--", command], needsAskpass, askpassSecretKind };
}

export function buildSshEnv(
  base: NodeJS.ProcessEnv,
  askpass: { helperPath: string; secretFilePath: string } | null,
): NodeJS.ProcessEnv {
  if (!askpass) return { ...base };
  return {
    ...base,
    SSH_ASKPASS: askpass.helperPath,
    SSH_ASKPASS_REQUIRE: "force",
    DJL_SSH_SECRET_FILE: askpass.secretFilePath,
    DISPLAY: base.DISPLAY ?? "djl",
  };
}
