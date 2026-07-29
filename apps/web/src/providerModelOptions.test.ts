// FILE: providerModelOptions.test.ts
// Purpose: Verifies provider-aware model-name formatting for picker and composer labels.
// Layer: Web unit tests
// Depends on: providerModelOptions shared formatting helpers.

import { describe, expect, it } from "vitest";

import {
  buildProviderOptionPatch,
  formatProviderModelOptionName,
  groupProviderModelOptions,
  isChatOnlyModel,
  groupProviderModelOptionsWithFavorites,
  mergeDynamicModelOptions,
  providerModelCostMultiplierLabel,
  resolveModelGroupDefaultOpen,
  shouldUseCollapsibleModelGroups,
  type ProviderModelOption,
} from "./providerModelOptions";

describe("formatProviderModelOptionName", () => {
  it("humanizes unknown OpenCode runtime model slugs using the model identifier", () => {
    expect(
      formatProviderModelOptionName({
        provider: "opencode",
        slug: "opencode-go/kimi-k2.6",
      }),
    ).toBe("Kimi K2.6");
  });

  it("keeps known OpenCode-backed models on their shared display names", () => {
    expect(
      formatProviderModelOptionName({
        provider: "opencode",
        slug: "openai/gpt-5",
      }),
    ).toBe("GPT-5");
  });

  it("leaves non-OpenCode unknown slugs unchanged", () => {
    expect(
      formatProviderModelOptionName({
        provider: "codex",
        slug: "custom/internal-model",
      }),
    ).toBe("custom/internal-model");
  });
});

describe("mergeDynamicModelOptions", () => {
  it("preserves runtime descriptions without inventing them for custom models", () => {
    const options = mergeDynamicModelOptions({
      provider: "droid",
      staticOptions: [{ slug: "custom:model", name: "Custom model", isCustom: true }],
      dynamicModels: [
        {
          slug: "gpt-5.6-luna",
          name: "GPT-5.6 Luna",
          description: " 0.4x Factory token rate ",
        },
        { slug: "custom:model", name: "Custom model" },
      ],
    });

    expect(options).toEqual([
      {
        slug: "gpt-5.6-luna",
        name: "GPT-5.6 Luna",
        description: "0.4x Factory token rate",
      },
      { slug: "custom:model", name: "Custom model" },
    ]);
  });

  it("preserves model locality and document capabilities for disclosure and routing", () => {
    const [model] = mergeDynamicModelOptions({
      provider: "opencode",
      staticOptions: [],
      dynamicModels: [
        {
          slug: "custom/model",
          name: "Custom Model",
          processingLocality: "unknown",
          supportsVision: false,
          supportsPdf: false,
        },
      ],
    });

    expect(model).toMatchObject({
      processingLocality: "unknown",
      supportsVision: false,
      supportsPdf: false,
    });
  });
});

describe("providerModelCostMultiplierLabel", () => {
  it("formats live provider multipliers without hardcoding their values", () => {
    expect(providerModelCostMultiplierLabel("0.38x Factory token rate")).toBe("0.38×");
    expect(providerModelCostMultiplierLabel("12x Factory token rate")).toBe("12×");
  });

  it("ignores descriptions that do not begin with a multiplier", () => {
    expect(providerModelCostMultiplierLabel("Launch Pricing")).toBeNull();
    expect(providerModelCostMultiplierLabel()).toBeNull();
  });
});

describe("buildProviderOptionPatch", () => {
  it("maps generic Gemini thinking selections back to the provider-specific option shape", () => {
    expect(buildProviderOptionPatch("gemini", "thinkingBudget", "512")).toEqual({
      thinkingBudget: 512,
    });
    expect(buildProviderOptionPatch("gemini", "thinkingLevel", "HIGH")).toEqual({
      thinkingLevel: "HIGH",
    });
  });

  it("passes through non-Gemini option ids unchanged", () => {
    expect(buildProviderOptionPatch("codex", "reasoningEffort", "xhigh")).toEqual({
      reasoningEffort: "xhigh",
    });
    expect(buildProviderOptionPatch("droid", "reasoningEffort", "high")).toEqual({
      reasoningEffort: "high",
    });
    expect(buildProviderOptionPatch("grok", "reasoningEffort", "high")).toEqual({
      reasoningEffort: "high",
    });
    expect(buildProviderOptionPatch("cursor", "fastMode", true)).toEqual({ fastMode: true });
  });
});

describe("groupProviderModelOptions", () => {
  it("groups provider models by upstream provider", () => {
    const options = [
      {
        slug: "anthropic/claude-sonnet",
        name: "Claude Sonnet",
        upstreamProviderId: "anthropic",
        upstreamProviderName: "Anthropic",
      },
      {
        slug: "openai/gpt-5",
        name: "GPT-5",
        upstreamProviderId: "openai",
        upstreamProviderName: "OpenAI",
      },
    ] satisfies ProviderModelOption[];

    const groupedOptions = groupProviderModelOptions(options);

    expect(groupedOptions.map((group) => group.label)).toEqual(["Anthropic", "OpenAI"]);
  });
});

describe("groupProviderModelOptionsWithFavorites", () => {
  it("adds a favourites group ahead of the normal provider groups", () => {
    const options = [
      {
        slug: "anthropic/claude-sonnet",
        name: "Claude Sonnet",
        upstreamProviderId: "anthropic",
        upstreamProviderName: "Anthropic",
      },
      {
        slug: "openai/gpt-5",
        name: "GPT-5",
        upstreamProviderId: "openai",
        upstreamProviderName: "OpenAI",
      },
    ] satisfies ProviderModelOption[];

    const groupedOptions = groupProviderModelOptionsWithFavorites({
      options,
      favoriteSlugs: new Set(["openai/gpt-5"]),
    });

    expect(groupedOptions.map((group) => group.label)).toEqual(["Favourites", "Anthropic"]);
    expect(groupedOptions[0]?.options.map((option) => option.slug)).toEqual(["openai/gpt-5"]);
    expect(groupedOptions.flatMap((group) => group.options.map((option) => option.slug))).toEqual([
      "openai/gpt-5",
      "anthropic/claude-sonnet",
    ]);
  });
});

describe("collapsible model group helpers", () => {
  it("enables collapsible sections only for long grouped lists while not searching", () => {
    expect(shouldUseCollapsibleModelGroups(2, false)).toBe(false);
    expect(shouldUseCollapsibleModelGroups(3, false)).toBe(true);
    expect(shouldUseCollapsibleModelGroups(4, true)).toBe(false);
  });

  it("keeps favourites and the active model group expanded by default", () => {
    expect(
      resolveModelGroupDefaultOpen({
        groupKey: "__favorites__",
        options: [{ slug: "openai/gpt-5", name: "GPT-5" }],
        activeModel: "anthropic/claude-sonnet",
        groupCount: 4,
      }),
    ).toBe(true);
    expect(
      resolveModelGroupDefaultOpen({
        groupKey: "openai",
        options: [{ slug: "openai/gpt-5", name: "GPT-5" }],
        activeModel: "openai/gpt-5",
        groupCount: 4,
      }),
    ).toBe(true);
    expect(
      resolveModelGroupDefaultOpen({
        groupKey: "anthropic",
        options: [{ slug: "anthropic/claude-sonnet", name: "Claude Sonnet" }],
        activeModel: "openai/gpt-5",
        groupCount: 4,
      }),
    ).toBe(false);
  });
});

describe("chat-only local models", () => {
  it("carries the tool-call capability through from discovery", () => {
    const merged = mergeDynamicModelOptions({
      provider: "opencode",
      staticOptions: [],
      dynamicModels: [
        { slug: "ollama/qwen2.5:7b", upstreamProviderName: "On this computer" },
        {
          slug: "ollama/llama3.2:1b",
          upstreamProviderName: "On this computer",
          supportsToolCalls: false,
        },
      ],
    });

    expect(merged.find((m) => m.slug === "ollama/llama3.2:1b")?.supportsToolCalls).toBe(false);
    // Unknown must stay undefined rather than collapsing to false.
    expect(merged.find((m) => m.slug === "ollama/qwen2.5:7b")?.supportsToolCalls).toBeUndefined();
  });

  it("sinks models that cannot drive the agent to the bottom of their group", () => {
    const groups = groupProviderModelOptions([
      { slug: "ollama/qwen2.5-coder:0.5b", name: "a", upstreamProviderName: "On this computer", supportsToolCalls: false },
      { slug: "ollama/qwen2.5:7b", name: "b", upstreamProviderName: "On this computer" },
      { slug: "ollama/llama3.2:1b", name: "c", upstreamProviderName: "On this computer", supportsToolCalls: false },
      { slug: "ollama/djl-qwen:3b", name: "d", upstreamProviderName: "On this computer" },
    ]);

    expect(groups[0]?.options.map((o) => o.slug)).toEqual([
      "ollama/qwen2.5:7b",
      "ollama/djl-qwen:3b",
      "ollama/qwen2.5-coder:0.5b",
      "ollama/llama3.2:1b",
    ]);
  });

  it("leaves groups without any chat-only model in their original order", () => {
    const groups = groupProviderModelOptions([
      { slug: "deepseek/v4-flash", name: "a", upstreamProviderName: "DeepSeek" },
      { slug: "deepseek/v4-pro", name: "b", upstreamProviderName: "DeepSeek" },
    ]);

    expect(groups[0]?.options.map((o) => o.slug)).toEqual(["deepseek/v4-flash", "deepseek/v4-pro"]);
  });
});

describe("chat-only models are not selectable for agent work", () => {
  it("marks a known-incapable model as disabled", () => {
    const [capable, incapable] = groupProviderModelOptions([
      { slug: "ollama/qwen2.5:7b", name: "a", upstreamProviderName: "On this computer" },
      {
        slug: "ollama/llama3.2:1b",
        name: "b",
        upstreamProviderName: "On this computer",
        supportsToolCalls: false,
      },
    ])[0]!.options;

    expect(isChatOnlyModel(capable!)).toBe(false);
    expect(isChatOnlyModel(incapable!)).toBe(true);
  });

  it("treats unknown capability as selectable rather than guessing", () => {
    expect(isChatOnlyModel({ slug: "ollama/mystery:8b", name: "m" })).toBe(false);
  });
});
