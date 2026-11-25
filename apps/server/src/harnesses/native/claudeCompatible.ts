// FILE: claudeCompatible.ts
// Purpose: Doubao (Volcengine Ark Coding Plan) and DeepSeek served through the Claude Code
// harness. Each vendor exposes an Anthropic-compatible endpoint; DJL points Claude Code at it
// with the user's plan key so tools, skills, MCP and streaming all behave like Claude Code.

import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";

import {
  MODEL_OPTIONS_BY_PROVIDER,
  type ClaudeCompatibleProviderId,
  type DoubaoRegion,
} from "@djl/contracts";

import { createClaudeCompatibleDriver, type ClaudeCompatibleRuntime } from "./claude";
import type { NativeDriverFactory } from "./types";

// Only the coding-plan endpoints draw on the plan. Ark's general `/api/v3` inference
// endpoint bills separately, so it must never be used here.
const DOUBAO_BASE_URL: Record<DoubaoRegion, string> = {
  china: "https://ark.cn-beijing.volces.com/api/coding",
  international: "https://ark.ap-southeast.bytepluses.com/api/coding",
};
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";

export function claudeCompatibleBaseUrl(
  provider: ClaudeCompatibleProviderId,
  region: DoubaoRegion = "china",
): string {
  return provider === "doubao" ? DOUBAO_BASE_URL[region] : DEEPSEEK_BASE_URL;
}

/**
 * Environment that makes Claude Code talk to the vendor endpoint with the vendor key. Every
 * model tier (main, subagents, the small fast model) maps to the chosen vendor model, and any
 * Anthropic credential the user has is blanked so it can never be sent to the vendor.
 */
export function claudeCompatibleEnv(input: {
  provider: ClaudeCompatibleProviderId;
  apiKey: string;
  model: string;
  region?: DoubaoRegion;
}): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: claudeCompatibleBaseUrl(input.provider, input.region),
    ANTHROPIC_AUTH_TOKEN: input.apiKey,
    ANTHROPIC_API_KEY: "",
    CLAUDE_CODE_OAUTH_TOKEN: "",
    ANTHROPIC_MODEL: input.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: input.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: input.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: input.model,
    ANTHROPIC_SMALL_FAST_MODEL: input.model,
    CLAUDE_CODE_SUBAGENT_MODEL: input.model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}

// Same file layout as ServerSecretStore (`<name>.bin`, 0600 in the 0700 secrets dir).
function keyPath(secretsDir: string, provider: ClaudeCompatibleProviderId): string {
  return nodePath.join(secretsDir, `provider-key-${provider}.bin`);
}

export async function readClaudeCompatibleKey(
  secretsDir: string,
  provider: ClaudeCompatibleProviderId,
): Promise<string | null> {
  try {
    const key = (await readFile(keyPath(secretsDir, provider), "utf8")).trim();
    return key || null;
  } catch {
    return null;
  }
}

export async function writeClaudeCompatibleKey(
  secretsDir: string,
  provider: ClaudeCompatibleProviderId,
  apiKey: string,
): Promise<void> {
  const trimmed = apiKey.trim();
  const path = keyPath(secretsDir, provider);
  if (!trimmed) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(secretsDir, { recursive: true, mode: 0o700 });
  await writeFile(path, trimmed, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

/** Which coding plans have a key saved. Never returns the keys themselves. */
export async function listClaudeCompatibleKeys(secretsDir: string) {
  const providers: ClaudeCompatibleProviderId[] = ["doubao", "deepseek"];
  return {
    keys: await Promise.all(
      providers.map(async (provider) => ({
        provider,
        configured: (await readClaudeCompatibleKey(secretsDir, provider)) !== null,
      })),
    ),
  };
}

export function claudeCompatibleModels(provider: ClaudeCompatibleProviderId) {
  return MODEL_OPTIONS_BY_PROVIDER[provider].map((model) => ({
    slug: model.slug,
    name: model.name,
  }));
}

export function createClaudeCompatibleDriverFactory(input: {
  provider: ClaudeCompatibleProviderId;
  secretsDir: string;
}): NativeDriverFactory {
  const label = input.provider === "doubao" ? "Doubao" : "DeepSeek";
  return createClaudeCompatibleDriver(async (start): Promise<ClaudeCompatibleRuntime> => {
    const apiKey = await readClaudeCompatibleKey(input.secretsDir, input.provider);
    if (!apiKey)
      throw new Error(`Add your ${label} API key in Settings > Accounts before starting a chat.`);
    const model =
      start.modelSelection?.provider === input.provider
        ? start.modelSelection.model
        : (MODEL_OPTIONS_BY_PROVIDER[input.provider][0]?.slug ?? "");
    const region = input.provider === "doubao" ? start.providerOptions?.doubao?.region : undefined;
    return {
      provider: input.provider,
      env: claudeCompatibleEnv({
        provider: input.provider,
        apiKey,
        model,
        ...(region ? { region } : {}),
      }),
      models: claudeCompatibleModels(input.provider),
    };
  });
}
