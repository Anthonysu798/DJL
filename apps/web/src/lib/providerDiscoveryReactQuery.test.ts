import { describe, expect, it } from "vitest";

import { providerModelsQueryOptions } from "./providerDiscoveryReactQuery";

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
});
