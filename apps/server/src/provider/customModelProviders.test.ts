import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { customProviderConfig, readCustomProviders } from "./customModelProviders";

const definition = {
  providerId: "test-relay",
  name: "Test relay",
  baseUrl: "http://127.0.0.1:9999/v1",
  protocol: "openai-chat" as const,
  models: [{ id: "org/model", name: "My model" }],
};

describe("custom model providers", () => {
  it("maps each protocol to the right SDK and preserves exact model IDs", () => {
    for (const [protocol, npm] of [
      ["openai-chat", "@ai-sdk/openai-compatible"],
      ["openai-responses", "@ai-sdk/openai"],
      ["anthropic", "@ai-sdk/anthropic"],
    ] as const) {
      expect(customProviderConfig({ ...definition, protocol })).toMatchObject({
        npm,
        options: { baseURL: definition.baseUrl },
        models: { "org/model": { name: "My model" } },
      });
    }
  });

  it("still reads providers saved before the custom API dialog was removed", async () => {
    const root = await mkdtemp(join(tmpdir(), "djl-custom-providers-"));
    try {
      await expect(readCustomProviders(root)).resolves.toEqual([]);
      await writeFile(join(root, "custom-providers.json"), JSON.stringify([definition]));
      await expect(readCustomProviders(root)).resolves.toEqual([definition]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
