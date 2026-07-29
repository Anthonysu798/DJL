import type { NativeApi } from "@synara/contracts";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { providerModelsQueryOptions } from "./providerDiscoveryReactQuery";
import * as nativeApi from "../nativeApi";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("providerModelsQueryOptions", () => {
  it("uses a stable global OpenCode catalog with a bounded retry budget", () => {
    const options = providerModelsQueryOptions({
      provider: "opencode",
      cwd: "C:\\workspace",
    });

    expect(options.queryKey.at(-1)).toBeNull();
    expect(options.retry).toBe(2);
    expect(options.retryDelay).toBeTypeOf("function");
    const retryDelay = options.retryDelay as (attemptIndex: number) => number;
    expect(retryDelay(0)).toBe(500);
    expect(retryDelay(3)).toBe(1_000);
    expect(retryDelay(20)).toBe(1_000);
  });

  it("does not expand retry budgets for unrelated providers", () => {
    expect(providerModelsQueryOptions({ provider: "cursor" }).retry).toBe(1);
    expect(providerModelsQueryOptions({ provider: "codex" }).retry).toBe(3);
  });

  it("forces OpenCode to reconcile its local provider inventory", async () => {
    const listModels = vi.fn().mockResolvedValue({
      models: [],
      source: "opencode",
      cached: false,
    });
    vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
      provider: { listModels },
    } as unknown as NativeApi);

    await new QueryClient().fetchQuery(
      providerModelsQueryOptions({
        provider: "opencode",
        cwd: "/workspace",
      }),
    );

    expect(listModels).toHaveBeenCalledWith({
      provider: "opencode",
      forceReload: true,
    });
  });
});
