import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { OpenCodeCatalogCache } from "./openCodeCatalogCache";

const temporaryDirectories: string[] = [];

async function makeStateDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "djl-opencode-catalog-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("OpenCodeCatalogCache", () => {
  it("round-trips the last-known-good provider and model catalogs", async () => {
    const stateDir = await makeStateDir();
    const cache = new OpenCodeCatalogCache(stateDir);
    await cache.setProviders(
      {
        providers: [
          {
            id: "deepseek",
            name: "DeepSeek",
            supportsApiKey: true,
            connected: true,
            modelCount: 1,
          },
        ],
        configuredProviderCount: 1,
        modelCount: 1,
      },
      100,
    );
    await cache.setModels(
      {
        models: [{ slug: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
        source: "opencode",
        cached: false,
      },
      100,
    );
    await cache.setAgents(
      {
        agents: [{ name: "build", displayName: "Build" }],
        source: "opencode",
        cached: false,
      },
      100,
    );

    const reloaded = new OpenCodeCatalogCache(stateDir);
    await reloaded.load();

    expect(reloaded.providers).toMatchObject({
      configuredProviderCount: 1,
      cached: true,
      source: "djl.cache",
    });
    expect(reloaded.models).toMatchObject({
      models: [{ slug: "deepseek/deepseek-v4-flash" }],
      cached: true,
    });
    expect(reloaded.agents).toMatchObject({
      agents: [{ name: "build", displayName: "Build" }],
      cached: true,
    });
  });

  it("ignores a corrupt persisted catalog", async () => {
    const stateDir = await makeStateDir();
    const path = join(stateDir, "cache", "opencode-catalog-v2.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{not-json", "utf8");

    const cache = new OpenCodeCatalogCache(stateDir);
    await cache.load();

    expect(cache.providers).toBeNull();
    expect(cache.models).toBeNull();
    expect(cache.agents).toBeNull();
  });

  it("does not restore the previous catalog cache version after an upgrade", async () => {
    const stateDir = await makeStateDir();
    const previousCachePath = join(stateDir, "cache", "opencode-catalog-v1.json");
    await mkdir(dirname(previousCachePath), { recursive: true });
    await writeFile(
      previousCachePath,
      JSON.stringify({
        version: 1,
        providers: null,
        models: {
          models: [{ slug: "deepseek/deepseek-reasoner", name: "DeepSeek Reasoner" }],
          source: "opencode",
          cached: false,
        },
        agents: null,
        providersUpdatedAt: 0,
        modelsUpdatedAt: 100,
        agentsUpdatedAt: 0,
      }),
      "utf8",
    );

    const upgraded = new OpenCodeCatalogCache(stateDir);
    await upgraded.load();

    expect(upgraded.models).toBeNull();
  });
});
