// FILE: claudeCompatible.test.ts
// Purpose: Doubao and DeepSeek coding plans reach Claude Code only through the plan endpoint
// and key, and keys are stored privately and never echoed back.

import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import nodePath from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  claudeCompatibleBaseUrl,
  claudeCompatibleEnv,
  listClaudeCompatibleKeys,
  readClaudeCompatibleKey,
  writeClaudeCompatibleKey,
} from "./claudeCompatible";
import { museSubscriptionEnvironment } from "./muse";

const dirs: string[] = [];
function secretsDir() {
  const dir = mkdtempSync(nodePath.join(os.tmpdir(), "djl-plan-keys-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("claudeCompatibleEnv", () => {
  it("uses Ark's coding-plan endpoint, never the separately billed /api/v3", () => {
    expect(claudeCompatibleBaseUrl("doubao", "china")).toBe(
      "https://ark.cn-beijing.volces.com/api/coding",
    );
    expect(claudeCompatibleBaseUrl("doubao", "international")).toBe(
      "https://ark.ap-southeast.bytepluses.com/api/coding",
    );
    expect(claudeCompatibleBaseUrl("doubao")).not.toContain("/api/v3");
    expect(claudeCompatibleBaseUrl("deepseek")).toBe("https://api.deepseek.com/anthropic");
  });

  it("maps every Claude model tier to the plan model and blanks Anthropic credentials", () => {
    const env = claudeCompatibleEnv({
      provider: "deepseek",
      apiKey: "sk-plan",
      model: "deepseek-v4-pro",
    });
    expect(env).toMatchObject({
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_AUTH_TOKEN: "sk-plan",
      ANTHROPIC_API_KEY: "",
      CLAUDE_CODE_OAUTH_TOKEN: "",
      ANTHROPIC_MODEL: "deepseek-v4-pro",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-pro",
      ANTHROPIC_SMALL_FAST_MODEL: "deepseek-v4-pro",
    });
  });
});

describe("coding plan keys", () => {
  it("stores keys owner-only and lists only whether one is set", async () => {
    const dir = secretsDir();
    await writeClaudeCompatibleKey(dir, "doubao", "  ark-key  ");

    expect(await readClaudeCompatibleKey(dir, "doubao")).toBe("ark-key");
    expect(statSync(nodePath.join(dir, "provider-key-doubao.bin")).mode & 0o777).toBe(0o600);
    const listed = await listClaudeCompatibleKeys(dir);
    expect(listed).toEqual({
      keys: [
        { provider: "doubao", configured: true },
        { provider: "deepseek", configured: false },
      ],
    });
    expect(JSON.stringify(listed)).not.toContain("ark-key");
  });

  it("removes the key when saved empty", async () => {
    const dir = secretsDir();
    await writeClaudeCompatibleKey(dir, "deepseek", "sk-1");
    await writeClaudeCompatibleKey(dir, "deepseek", "");
    expect(await readClaudeCompatibleKey(dir, "deepseek")).toBeNull();
  });
});

describe("museSubscriptionEnvironment", () => {
  it("drops META_API_KEY so turns bill the Muse subscription, not the API", () => {
    const env = museSubscriptionEnvironment({ META_API_KEY: "mk", PATH: "/usr/bin" });
    expect(env.META_API_KEY).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });
});
