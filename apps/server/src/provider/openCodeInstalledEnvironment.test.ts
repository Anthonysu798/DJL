import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  prepareInstalledOpenCodeEnvironment,
  writeOpenCodeSessionPolicy,
} from "./openCodeInstalledEnvironment";

describe("installed OpenCode process environment", () => {
  it("adds DJL compatibility and local models without moving shared credentials or mutating config", async () => {
    const root = await mkdtemp(join(tmpdir(), "djl-installed-env-"));
    try {
      const configDir = join(root, "config", "opencode");
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, "opencode.json"),
        JSON.stringify({
          provider: {
            ollama: { models: { qwen: { name: "Qwen" } } },
            openai: { options: { apiKey: "legacy-do-not-transfer" } },
          },
        }),
      );
      const baseEnv = {
        HOME: "/user",
        XDG_DATA_HOME: "/user/data",
        OPENAI_API_KEY: "shared",
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          plugin: ["user-plugin"],
          provider: { openai: { options: { baseURL: "https://example.test" } } },
        }),
      };
      const env = await prepareInstalledOpenCodeEnvironment(root, baseEnv);
      expect(env.HOME).toBe("/user");
      expect(env.XDG_DATA_HOME).toBe("/user/data");
      expect(env.OPENAI_API_KEY).toBe("shared");
      const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!);
      expect(config.plugin[0]).toBe("user-plugin");
      expect(config.plugin[1]).toMatch(/^file:/);
      expect(config.provider.ollama.models.qwen.name).toBe("Qwen");
      expect(config.provider.openai.options).toEqual({ baseURL: "https://example.test" });
      expect(baseEnv.OPENCODE_CONFIG_CONTENT).not.toContain("file:");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("atomically preserves policies for concurrent sessions and clears only the stopped session", async () => {
    const root = await mkdtemp(join(tmpdir(), "djl-installed-policy-"));
    try {
      await Promise.all([
        writeOpenCodeSessionPolicy(root, "ses_one", { instructionScope: "work-isolated" }),
        writeOpenCodeSessionPolicy(root, "ses_two", { instructionScope: "native" }),
      ]);
      await writeOpenCodeSessionPolicy(root, "ses_one", null);
      expect(
        JSON.parse(await readFile(join(root, "compatibility", "policies.json"), "utf8")),
      ).toEqual({ ses_two: { instructionScope: "native" } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
