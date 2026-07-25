import { afterEach, describe, expect, it, vi } from "vitest";

function installBrowserStorage(values: Record<string, string>): void {
  const storage = new Map(Object.entries(values));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("provider catalog browser cache", () => {
  it("does not restore the retired v1 model catalog after an upgrade", async () => {
    installBrowserStorage({
      "djl.provider-catalog.v1": JSON.stringify({
        data: {
          providers: [
            {
              id: "deepseek",
              name: "DeepSeek",
              supportsApiKey: true,
              connected: true,
              modelCount: 4,
            },
          ],
          configuredProviderCount: 1,
          modelCount: 4,
        },
        updatedAt: 100,
      }),
      "djl.model-catalog.v1": JSON.stringify({
        data: {
          models: [{ slug: "deepseek/deepseek-reasoner", name: "DeepSeek Reasoner" }],
          source: "opencode",
          cached: false,
        },
        updatedAt: 100,
      }),
    });

    const { readOpenCodeModelCatalogCache, readOpenCodeProviderCatalogCache } =
      await import("./providerCatalogBrowserCache");

    expect(readOpenCodeModelCatalogCache()).toBeNull();
    expect(readOpenCodeProviderCatalogCache()).toBeNull();
  });
});
