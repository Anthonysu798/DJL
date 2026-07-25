import { describe, expect, it } from "vitest";

import {
  modelProviderStatusText,
  resolveAuthenticatedModelSelection,
} from "./OpenCodeModelsSettingsPanel";

describe("modelProviderStatusText", () => {
  it("directs an unconfigured installation to add an API key", () => {
    expect(modelProviderStatusText(0, 0)).toBe("Add an API key to choose a model");
  });

  it("summarizes configured providers and models", () => {
    expect(modelProviderStatusText(2, 14)).toBe("2 providers · 14 models available");
  });
});

describe("resolveAuthenticatedModelSelection", () => {
  it("preserves a valid model and falls back to the first authenticated model", () => {
    const models = [{ slug: "anthropic/claude" }, { slug: "openai/gpt" }];
    expect(resolveAuthenticatedModelSelection("openai/gpt", models)).toBe("openai/gpt");
    expect(resolveAuthenticatedModelSelection("removed/model", models)).toBe("anthropic/claude");
  });

  it("returns no model for an unconfigured install", () => {
    expect(resolveAuthenticatedModelSelection("openai/gpt", [])).toBeUndefined();
  });

  it("falls back from a retired DeepSeek selection to the supported V4 catalog", () => {
    expect(
      resolveAuthenticatedModelSelection("deepseek/deepseek-reasoner", [
        { slug: "deepseek/deepseek-v4-flash" },
        { slug: "deepseek/deepseek-v4-pro" },
      ]),
    ).toBe("deepseek/deepseek-v4-flash");
  });
});
