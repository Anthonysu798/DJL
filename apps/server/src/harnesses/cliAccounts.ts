// FILE: cliAccounts.ts
// Purpose: Extra Claude Code / Codex subscription accounts (Settings → AI accounts). Each account
//          is a CLI config folder under `<baseDir>/userdata/terminal-accounts/<provider>/<id>`,
//          the same isolation Agent workspaces use, so its login never touches the normal one.
//          Sign-in reuses the workspace profile terminal (`agentProfile` action `login`).

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rm, stat, symlink } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CLI_ACCOUNT_ID,
  type CliAccountAddInput,
  type CliAccountProvider,
  type CliAccountSetting,
  type CliAccountStatus,
  type CliAccountSummary,
  type CliAccountsUsageResult,
  type ServerSettings,
  type ServerSettingsPatch,
} from "@djl/contracts";
import { acquireClaudeAuthStatusLock } from "../provider/claudeAuthStatusLock";
import { fetchCliAccountUsage } from "../providerUsage";
import { buildHarnessInvocation, probe } from "./accounts";
import { activeCliAccountDir, withNormalCliLogin } from "./cliAccountSelection";
import { buildProfileTerminalLaunch } from "./terminalProfiles";
import { parseProfileAccountOutput } from "./profileAccounts";

export const CLI_ACCOUNT_PROVIDERS: readonly CliAccountProvider[] = ["claudeAgent", "codex"];

export function cliAccountsRoot(baseDir: string): string {
  return path.join(baseDir, "userdata", "terminal-accounts");
}

// Settings, skills, plugins and instructions are shared from the normal CLI folder so an extra
// account behaves like the user's own CLI. Login files are never shared.
const SHARED_CONFIG: Record<CliAccountProvider, readonly string[]> = {
  claudeAgent: [
    "settings.json",
    "CLAUDE.md",
    "skills",
    "agents",
    "commands",
    "plugins",
    "output-styles",
    "hooks",
  ],
  codex: ["config.toml", "AGENTS.md", "skills", "prompts", "rules"],
};

function normalCliFolder(
  provider: CliAccountProvider,
  settings: ServerSettings,
  homeDir: string,
): string {
  if (provider === "claudeAgent") return path.join(homeDir, ".claude");
  return settings.providers.codex.homePath.trim() || path.join(homeDir, ".codex");
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

/** Links the normal CLI's shared config into an account folder; leaves existing files alone. */
export async function linkSharedCliConfig(
  provider: CliAccountProvider,
  dir: string,
  sourceDir: string,
): Promise<void> {
  for (const name of SHARED_CONFIG[provider]) {
    const source = path.join(sourceDir, name);
    const target = path.join(dir, name);
    if (!(await exists(source)) || (await exists(target))) continue;
    try {
      await symlink(source, target);
    } catch {
      /* A missing link only means that piece of config is not shared. */
    }
  }
}

function emailOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const address = value.trim();
  return address.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ? address : null;
}

/** Codex keeps a ChatGPT login in `auth.json`; the id token's claims carry the email. */
async function readCodexAuth(
  codexHome: string,
): Promise<{ status: CliAccountStatus; email: string | null } | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(codexHome, "auth.json"), "utf8"));
  } catch {
    return null;
  }
  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const tokens =
    record.tokens && typeof record.tokens === "object"
      ? (record.tokens as Record<string, unknown>)
      : null;
  if (tokens && typeof tokens.access_token === "string") {
    let email: string | null = null;
    const idToken = typeof tokens.id_token === "string" ? tokens.id_token : "";
    try {
      const claims = JSON.parse(
        Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"),
      ) as Record<string, unknown>;
      email = emailOf(claims.email);
    } catch {
      /* No readable identity; still signed in. */
    }
    return { status: "signedIn", email };
  }
  if (typeof record.OPENAI_API_KEY === "string" && record.OPENAI_API_KEY)
    return { status: "signedIn", email: null };
  return { status: "signedOut", email: null };
}

async function probeClaude(
  binary: string,
  env: NodeJS.ProcessEnv,
): Promise<{ status: CliAccountStatus; email: string | null }> {
  // `claude auth status` may refresh and rotate the stored token: never run two at once.
  const release = await acquireClaudeAuthStatusLock();
  try {
    return parseProfileAccountOutput("claudeAgent", await probe(binary, ["auth", "status"], env));
  } catch {
    return { status: "unknown", email: null };
  } finally {
    release();
  }
}

async function readIdentity(
  provider: CliAccountProvider,
  settings: ServerSettings,
  root: string,
  homeDir: string,
  account: CliAccountSetting | null,
): Promise<{ status: CliAccountStatus; email: string | null }> {
  if (!settings.providers[provider].enabled) return { status: "unavailable", email: null };
  if (account) {
    try {
      await stat(account.dir);
    } catch {
      return { status: "signedOut", email: null };
    }
  }
  if (provider === "codex") {
    const codexHome = account?.dir ?? normalCliFolder("codex", settings, homeDir);
    const fromFile = await readCodexAuth(codexHome);
    if (fromFile || account) return fromFile ?? { status: "signedOut", email: null };
    // The normal login may live in the system keyring instead of auth.json.
    const invocation = buildHarnessInvocation("codex", withNormalCliLogin(settings), root);
    try {
      return parseProfileAccountOutput(
        "codex",
        await probe(invocation.binary, [...invocation.statusArgs], invocation.env),
      );
    } catch {
      return { status: "unknown", email: null };
    }
  }
  if (account) {
    const launch = buildProfileTerminalLaunch(
      { provider, profileId: account.id, action: "status" },
      settings,
      root,
      process.env,
      "account-status",
    );
    const env = { ...process.env, ...launch.env };
    for (const name of launch.command.removeEnv) delete env[name];
    return probeClaude(launch.command.executable, env);
  }
  const invocation = buildHarnessInvocation("claudeAgent", withNormalCliLogin(settings), root);
  return probeClaude(invocation.binary, invocation.env);
}

export async function listCliAccounts(
  settings: ServerSettings,
  input: { readonly root: string; readonly homeDir: string },
): Promise<CliAccountSummary[]> {
  const rows = CLI_ACCOUNT_PROVIDERS.flatMap((provider) => [
    { provider, account: null as CliAccountSetting | null },
    ...settings.cliAccounts.accounts
      .filter((account) => account.provider === provider)
      .map((account) => ({ provider, account })),
  ]);
  return Promise.all(
    rows.map(async ({ provider, account }) => {
      const id = account?.id ?? DEFAULT_CLI_ACCOUNT_ID;
      const activeId = settings.cliAccounts.active[provider] ?? DEFAULT_CLI_ACCOUNT_ID;
      const identity = await readIdentity(provider, settings, input.root, input.homeDir, account);
      return {
        id,
        provider,
        name: account?.name ?? "",
        isDefault: account === null,
        active: activeId === id || (account === null && !activeCliAccountDir(settings, provider)),
        status: identity.status,
        email: identity.email,
      };
    }),
  );
}

export async function addCliAccount(
  settings: ServerSettings,
  input: CliAccountAddInput,
  options: { readonly root: string; readonly homeDir: string },
): Promise<{ account: CliAccountSetting; patch: ServerSettingsPatch }> {
  const prefix = input.provider === "codex" ? "codex" : "claude";
  const id = `${prefix}-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const dir = path.join(options.root, input.provider, id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await linkSharedCliConfig(
    input.provider,
    dir,
    normalCliFolder(input.provider, settings, options.homeDir),
  );
  const account: CliAccountSetting = { id, provider: input.provider, name: input.name, dir };
  return {
    account,
    patch: { cliAccounts: { accounts: [...settings.cliAccounts.accounts, account] } },
  };
}

export async function removeCliAccount(
  settings: ServerSettings,
  id: string,
  options: { readonly root: string },
): Promise<ServerSettingsPatch> {
  const account = settings.cliAccounts.accounts.find((item) => item.id === id);
  if (!account) throw new Error("That account no longer exists.");
  // Sign the CLI out first so Claude's Keychain item for this folder goes too.
  if (account.provider === "claudeAgent") {
    const launch = buildProfileTerminalLaunch(
      { provider: "claudeAgent", profileId: account.id, action: "status" },
      settings,
      options.root,
      process.env,
      "account-remove",
    );
    const env = { ...process.env, ...launch.env };
    for (const name of launch.command.removeEnv) delete env[name];
    const release = await acquireClaudeAuthStatusLock();
    try {
      await probe(launch.command.executable, ["auth", "logout"], env).catch(() => undefined);
    } finally {
      release();
    }
  }
  const resolved = path.resolve(account.dir);
  // Only ever delete folders DJL created for its accounts.
  if (resolved.startsWith(path.resolve(options.root) + path.sep))
    await rm(resolved, { recursive: true, force: true });
  return {
    cliAccounts: {
      accounts: settings.cliAccounts.accounts.filter((item) => item.id !== id),
      ...(settings.cliAccounts.active[account.provider] === id
        ? { active: { [account.provider]: DEFAULT_CLI_ACCOUNT_ID } }
        : {}),
    },
  };
}

export function setActiveCliAccount(
  settings: ServerSettings,
  provider: CliAccountProvider,
  id: string,
): ServerSettingsPatch {
  if (
    id !== DEFAULT_CLI_ACCOUNT_ID &&
    !settings.cliAccounts.accounts.some((item) => item.id === id && item.provider === provider)
  )
    throw new Error("That account no longer exists.");
  return { cliAccounts: { active: { [provider]: id } } };
}

export async function cliAccountsUsage(
  settings: ServerSettings,
  input: { readonly homeDir: string; readonly forceRefresh?: boolean },
): Promise<CliAccountsUsageResult> {
  const rows: Array<{ provider: CliAccountProvider; id: string; dir?: string }> = [];
  for (const provider of CLI_ACCOUNT_PROVIDERS) {
    rows.push({ provider, id: DEFAULT_CLI_ACCOUNT_ID });
    for (const account of settings.cliAccounts.accounts)
      if (account.provider === provider) rows.push({ provider, id: account.id, dir: account.dir });
  }
  const usage = await Promise.all(
    rows.map(async ({ provider, id, dir }) => ({
      accountId: id,
      provider,
      snapshot: await fetchCliAccountUsage({
        provider,
        homeDir: input.homeDir,
        ...(dir ? { accountDir: dir } : {}),
        ...(input.forceRefresh ? { forceRefresh: true } : {}),
      }),
    })),
  );
  return { usage };
}
