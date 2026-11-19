import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  customProviderConfig,
  fetchCustomModels,
  fetchSavedCustomModels,
  readCustomProviders,
  writeCustomProvider,
  removeCustomProvider,
} from "./customModelProviders";

const definition = {
  providerId: "test-relay",
  name: "Test relay",
  baseUrl: "http://127.0.0.1:9999/v1",
  protocol: "openai-chat" as const,
  models: [{ id: "org/model", name: "My model" }],
};

describe("custom model providers", () => {
  it("preserves other providers, persists no secret, and removes only the requested provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "djl-custom-"));
    try {
      await writeCustomProvider(root, definition);
      await writeCustomProvider(root, { ...definition, providerId: "another-relay" });
      expect((await readCustomProviders(root)).map((p) => p.providerId)).toEqual([
        "test-relay",
        "another-relay",
      ]);
      expect(await readFile(join(root, "custom-providers.json"), "utf8")).not.toContain("apiKey");
      await removeCustomProvider(root, "test-relay");
      expect((await readCustomProviders(root)).map((p) => p.providerId)).toEqual(["another-relay"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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

  it("rejects duplicate provider creation while allowing an explicit edit", async () => {
    const root = await mkdtemp(join(tmpdir(), "djl-custom-collision-"));
    try {
      await writeCustomProvider(root, definition);
      await expect(
        writeCustomProvider(root, { ...definition, name: "Replacement" }),
      ).rejects.toThrow("already exists");
      expect((await readCustomProviders(root))[0]?.name).toBe("Test relay");
      await writeCustomProvider(root, { ...definition, name: "Edited" }, true);
      expect((await readCustomProviders(root))[0]?.name).toBe("Edited");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reuses a stored key only for the saved provider's unchanged endpoint and protocol", async () => {
    const root = await mkdtemp(join(tmpdir(), "djl-custom-stored-key-"));
    try {
      await writeCustomProvider(root, definition);
      const authPath = join(root, "auth.json");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        authPath,
        JSON.stringify({ "test-relay": { type: "api", key: "fixture-key" } }),
      );
      const request = vi.fn().mockImplementation(async () => new Response('{"data":[]}'));
      await fetchSavedCustomModels(root, definition, authPath, request);
      expect(request.mock.calls[0]?.[1].headers.Authorization).toBe("Bearer fixture-key");
      await expect(
        fetchSavedCustomModels(
          root,
          { ...definition, baseUrl: "https://another.test/v1" },
          authPath,
          request,
        ),
      ).rejects.toThrow("changed endpoint");
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fetches models from the base path, sends protocol auth, and deduplicates IDs", async () => {
    const request = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "org/model", display_name: "My model" }, { id: "org/model" }],
          }),
        ),
    );
    expect(await fetchCustomModels({ ...definition, apiKey: "test-only" }, request)).toEqual({
      models: [{ id: "org/model", name: "My model" }],
    });
    expect(request.mock.calls[0]?.[0]).toBe("http://127.0.0.1:9999/v1/models");
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      headers: { Authorization: "Bearer test-only" },
    });
    await fetchCustomModels({ ...definition, protocol: "anthropic", apiKey: "test-only" }, request);
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      headers: { "x-api-key": "test-only", "anthropic-version": "2023-06-01" },
    });
  });

  it("reports an HTTP failure without exposing the response body or API key", async () => {
    const request = vi.fn().mockResolvedValue(new Response("private response", { status: 401 }));
    await expect(fetchCustomModels({ ...definition, apiKey: "secret" }, request)).rejects.toThrow(
      "401",
    );
  });
});
