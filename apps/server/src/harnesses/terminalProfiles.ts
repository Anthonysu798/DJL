import { resolveCodexTerminalBinary } from "./codexTerminalBinary";
import { prepareProfileShell } from "./profileShell";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ServerSettings, TerminalAgentProfile, TerminalOpenInput } from "@synara/contracts";
import { Effect } from "effect";
import { buildHarnessInvocation } from "./accounts";
import { TerminalError, type TerminalManagerShape } from "../terminal/Services/Manager";

// Profiles contain CLI-owned credentials. Only their opaque ids cross the RPC boundary.
export function buildProfileTerminalLaunch(
  profile: TerminalAgentProfile,
  settings: ServerSettings,
  root: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
  sessionKey = "default",
) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(profile.profileId))
    throw new Error("Invalid account profile id.");
  const directory = join(root, profile.provider, profile.profileId);
  const cleanEnv = { ...baseEnv };
  const removeEnv = [
    ...new Set([
      ...Object.keys(cleanEnv).filter(
        (name) =>
          /(?:_API_KEY|_AUTH_TOKEN|_OAUTH_TOKEN|_ACCESS_TOKEN|_BEARER_TOKEN|_SESSION_TOKEN|_ACCESS_KEY_ID|_SECRET_ACCESS_KEY)$/.test(
            name,
          ) ||
          /^(?:CODEX_HOME|CODEX_SQLITE_HOME|CODEX_THREAD_ID|CODEX_INTERNAL_ORIGINATOR_OVERRIDE|CLAUDE_CONFIG_DIR|CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CLAUDE_CODE_USE_.*|CURSOR_CONFIG_DIR|OPENCODE_CONFIG.*|OPENCODE_AUTH.*|GOOGLE_APPLICATION_CREDENTIALS|AWS_PROFILE|AWS_DEFAULT_PROFILE|ANTHROPIC_BASE_URL|OPENAI_BASE_URL)$/.test(
            name,
          ),
      ),
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CURSOR_API_KEY",
      "OPENCODE_AUTH_JSON",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "CLAUDE_CODE_USE_FOUNDRY",
      "npm_config_user_agent",
      "npm_execpath",
      "npm_lifecycle_event",
      "npm_command",
      "CODEX_MANAGED_BY_BUN",
      "CODEX_MANAGED_BY_NPM",
      "CODEX_MANAGED_BY_PNPM",
      "CODEX_MANAGED_PACKAGE_ROOT",
    ]),
  ];
  for (const name of removeEnv) delete cleanEnv[name];
  const invocation = buildHarnessInvocation(profile.provider, settings, directory, cleanEnv);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(invocation.env)) {
    if (value !== undefined && value !== baseEnv[name]) env[name] = value;
  }
  const prefix = [...invocation.prefixArgs];
  if (profile.provider === "codex") {
    env.CODEX_HOME = directory;
    // Concurrent first launches otherwise race Codex's SQLite migrations.
    env.CODEX_SQLITE_HOME = join(
      directory,
      "terminals",
      createHash("sha256").update(sessionKey).digest("hex"),
    );
    prefix.push("-c", 'cli_auth_credentials_store="file"');
  } else if (profile.provider === "claudeAgent") env.CLAUDE_CONFIG_DIR = directory;
  else if (profile.provider === "cursor") env.CURSOR_CONFIG_DIR = directory;
  else if (profile.provider === "opencode") {
    // Explicit workspace account profiles remain isolated; the default Accounts
    // login shares the installed CLI's home instead.
    env.XDG_DATA_HOME = join(directory, "data");
    env.XDG_CONFIG_HOME = join(directory, "config");
    env.XDG_CACHE_HOME = join(directory, "cache");
    env.XDG_STATE_HOME = join(directory, "state");
  }
  const args =
    profile.action === "login"
      ? invocation.loginArgs
      : profile.action === "status"
        ? invocation.statusArgs
        : [];
  return {
    directory,
    env,
    prefixArgs: prefix,
    initialArgs: args,
    command: {
      executable: invocation.binary,
      args: [...prefix, ...args],
      // The manager applies removals after overrides; never remove a pinned profile directory.
      removeEnv: removeEnv.filter((name) => !(name in env)),
    },
  };
}

export function openProfileTerminal(
  input: TerminalOpenInput,
  settings: ServerSettings,
  root: string,
  manager: Pick<TerminalManagerShape, "open" | "isRunning">,
) {
  if (!input.agentProfile) return manager.open(input);
  return Effect.gen(function* () {
    // Reattaching a viewport must not rediscover CLIs or rewrite startup scripts.
    if (
      yield* manager.isRunning({
        threadId: input.threadId,
        terminalId: input.terminalId ?? "default",
      })
    )
      return yield* manager.open(input);
    return yield* Effect.tryPromise({
      try: async () => {
        const launch = buildProfileTerminalLaunch(
          input.agentProfile!,
          settings,
          root,
          process.env,
          `${input.threadId}::${input.terminalId}`,
        );
        await mkdir(launch.directory, { recursive: true, mode: 0o700 });
        if (launch.env.CODEX_SQLITE_HOME)
          await mkdir(launch.env.CODEX_SQLITE_HOME, { recursive: true, mode: 0o700 });
        const probeEnv = { ...process.env, ...launch.env };
        for (const key of launch.command.removeEnv) delete probeEnv[key];
        const executable =
          input.agentProfile!.provider === "codex"
            ? await resolveCodexTerminalBinary(launch.command.executable, probeEnv)
            : launch.command.executable;
        return prepareProfileShell({
          cwd: input.cwd,
          directory:
            launch.env.CODEX_SQLITE_HOME ??
            join(
              launch.directory,
              "terminals",
              createHash("sha256").update(`${input.threadId}::${input.terminalId}`).digest("hex"),
            ),
          provider: input.agentProfile!.provider,
          executable,
          prefixArgs: launch.prefixArgs,
          initialArgs: launch.initialArgs,
          env: launch.env,
          removeEnv: launch.command.removeEnv,
        });
      },
      catch: (cause) => new TerminalError({ message: "Could not prepare account profile.", cause }),
    }).pipe(
      Effect.flatMap((launch) => manager.open({ ...input, env: launch.env }, launch.command)),
    );
  });
}
