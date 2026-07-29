import { describe, expect, it } from "vitest";

import { LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS, resolveLmStudioContext } from "./lmStudioContext";

describe("resolveLmStudioContext", () => {
  it("prepares a managed tool model at the agent floor", () => {
    expect(
      resolveLmStudioContext({
        managed: true,
        supportsToolCalls: true,
        maxContextWindowTokens: 131_072,
        loadedContextWindowTokens: 8_192,
      }),
    ).toEqual({
      effectiveContextWindowTokens: LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS,
      requiredLoadContextWindowTokens: LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS,
      toolsUsable: true,
    });
  });

  it("uses a larger verified loaded context without shrinking it", () => {
    expect(
      resolveLmStudioContext({
        managed: true,
        supportsToolCalls: true,
        maxContextWindowTokens: 131_072,
        loadedContextWindowTokens: 32_768,
      }),
    ).toEqual({
      effectiveContextWindowTokens: 32_768,
      requiredLoadContextWindowTokens: null,
      toolsUsable: true,
    });
  });

  it("does not evict an undersized external instance", () => {
    expect(
      resolveLmStudioContext({
        managed: false,
        supportsToolCalls: true,
        maxContextWindowTokens: 131_072,
        loadedContextWindowTokens: 8_192,
      }),
    ).toEqual({
      effectiveContextWindowTokens: 8_192,
      requiredLoadContextWindowTokens: null,
      toolsUsable: false,
    });
  });

  it("keeps a model whose maximum is too small available as chat-only", () => {
    expect(
      resolveLmStudioContext({
        managed: true,
        supportsToolCalls: true,
        maxContextWindowTokens: 8_192,
        loadedContextWindowTokens: null,
      }),
    ).toEqual({
      effectiveContextWindowTokens: null,
      requiredLoadContextWindowTokens: null,
      toolsUsable: false,
    });
  });

  it("does not force-load a model already classified as chat-only", () => {
    expect(
      resolveLmStudioContext({
        managed: true,
        supportsToolCalls: false,
        maxContextWindowTokens: 40_960,
        loadedContextWindowTokens: null,
      }),
    ).toEqual({
      effectiveContextWindowTokens: null,
      requiredLoadContextWindowTokens: null,
      toolsUsable: false,
    });
  });
});
