// FILE: claudeLogin.ts
// Purpose: Reads a Claude Code login (the main one or an extra account's CLAUDE_CONFIG_DIR)
//          straight from where the CLI stores it, without starting `claude`.
//
// Why: Claude's refresh token is single-use. `claude auth status` renews it when the access
// token is due, so every status check DJL ran could rotate the token, and a check DJL then
// killed on a timeout lost the new token: Claude found its stored refresh token already used
// and wiped the login. Reading the store never renews anything, so checks can run as often
// as the UI likes. Renewal is left to Claude itself (chats, and claudeCredentialKeepalive).

import os from "node:os";
import path from "node:path";

import {
  decodeKeychainJson,
  readJsonFile,
  readKeychainPassword,
} from "../providerUsage/credentials";
import { claudeKeychainServiceForConfigDir } from "../providerUsage/providers/claude";

const KEYCHAIN_SERVICE = "Claude Code-credentials";

export interface ClaudeLogin {
  readonly signedIn: boolean;
  readonly email: string | null;
  readonly subscriptionType: string | null;
  /** When the access token runs out; Claude renews it with the refresh token. */
  readonly accessExpiresAtMs: number | null;
}

export interface ClaudeLoginInput {
  /** An extra account's CLAUDE_CONFIG_DIR; omit for the main login. */
  readonly configDir?: string | undefined;
  readonly homeDir?: string;
  readonly platform?: NodeJS.Platform;
  readonly user?: string;
  readonly nowMs?: number;
}

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const time = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function emailOf(value: unknown): string | null {
  const address = text(value);
  return address && address.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)
    ? address
    : null;
}

async function readOAuth(
  input: Required<Pick<ClaudeLoginInput, "homeDir" | "platform">> & {
    configDir: string | undefined;
    user: string | undefined;
  },
) {
  const stores: unknown[] = [];
  const claudeDir = input.configDir ?? path.join(input.homeDir, ".claude");
  stores.push(await readJsonFile(path.join(claudeDir, ".credentials.json")));
  // The main login's Keychain item belongs to the macOS user, so only their real home reads it.
  if (input.configDir || path.resolve(input.homeDir) === path.resolve(os.homedir())) {
    const secret = await readKeychainPassword({
      service: input.configDir
        ? claudeKeychainServiceForConfigDir(input.configDir)
        : KEYCHAIN_SERVICE,
      ...(input.user ? { account: input.user } : {}),
      platform: input.platform,
    });
    if (secret) stores.push(decodeKeychainJson(secret));
  }
  return stores.map((store) => record(record(store)?.claudeAiOauth)).filter((oauth) => !!oauth);
}

/** Signed in while the CLI holds a refresh token that has not passed its own expiry. */
export async function readClaudeLogin(input: ClaudeLoginInput = {}): Promise<ClaudeLogin> {
  const homeDir = input.homeDir ?? os.homedir();
  const nowMs = input.nowMs ?? Date.now();
  const configDir = input.configDir?.trim() || undefined;
  const candidates = await readOAuth({
    configDir,
    homeDir,
    platform: input.platform ?? process.platform,
    user: input.user ?? process.env.USER ?? process.env.LOGNAME,
  });
  const live = candidates.find((oauth) => {
    const refreshExpiresAt = time(oauth.refreshTokenExpiresAt);
    if (text(oauth.refreshToken) && (refreshExpiresAt === undefined || refreshExpiresAt > nowMs))
      return true;
    const accessExpiresAt = time(oauth.expiresAt);
    return !!text(oauth.accessToken) && accessExpiresAt !== undefined && accessExpiresAt > nowMs;
  });
  if (!live)
    return { signedIn: false, email: null, subscriptionType: null, accessExpiresAtMs: null };
  const profile = record(
    await readJsonFile(path.join(configDir ?? homeDir, ".claude.json")),
  )?.oauthAccount;
  return {
    signedIn: true,
    email: emailOf(record(profile)?.emailAddress),
    subscriptionType: text(live.subscriptionType) ?? null,
    accessExpiresAtMs: time(live.expiresAt) ?? null,
  };
}
