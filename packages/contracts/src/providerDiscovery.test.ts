import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  OpenCodeCredentialMutationResult,
  OpenCodeListModelProvidersResult,
  OpenCodeSetApiKeyInput,
  ProviderListModelsResult,
} from "./providerDiscovery";

const decodeProviderListModelsResult = Schema.decodeUnknownSync(ProviderListModelsResult);

describe("ProviderListModelsResult", () => {
  it("preserves optional runtime model descriptions", () => {
    const result = decodeProviderListModelsResult({
      models: [
        {
          slug: "gpt-5.6-luna",
          name: "GPT-5.6 Luna",
          description: "0.4x Factory token rate",
        },
        {
          slug: "custom:GPT-5.6-Luna-0",
          name: "GPT-5.6 Luna",
        },
      ],
      source: "droid-acp",
    });

    expect(result.models[0]?.description).toBe("0.4x Factory token rate");
    expect(result.models[1]?.description).toBeUndefined();
  });

  it("preserves document, tool, context, and processing-locality capabilities", () => {
    const result = decodeProviderListModelsResult({
      models: [
        {
          slug: "ollama/qwen3:8b",
          name: "Qwen 3 8B",
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportsVision: false,
          supportsPdf: false,
          supportsAttachments: true,
          supportsToolCalls: true,
          contextLimitTokens: 32_768,
          processingLocality: "local",
        },
      ],
    });

    expect(result.models[0]).toMatchObject({
      inputModalities: ["text"],
      supportsVision: false,
      contextLimitTokens: 32_768,
      processingLocality: "local",
    });
  });
});

describe("OpenCode credential contracts", () => {
  it("models connection state without exposing credentials", () => {
    const result = Schema.decodeUnknownSync(OpenCodeListModelProvidersResult)({
      providers: [
        {
          id: "openai",
          name: "OpenAI",
          supportsApiKey: true,
          connected: true,
          modelCount: 4,
        },
      ],
      configuredProviderCount: 1,
      modelCount: 4,
    });

    expect(result.providers[0]).not.toHaveProperty("apiKey");
  });

  it("accepts API keys only on mutation inputs", () => {
    expect(
      Schema.decodeUnknownSync(OpenCodeSetApiKeyInput)({
        providerId: "openai",
        apiKey: "sk-test",
      }),
    ).toMatchObject({ providerId: "openai", apiKey: "sk-test" });
    expect(
      Schema.decodeUnknownSync(OpenCodeCredentialMutationResult)({
        providerId: "openai",
        connected: true,
      }),
    ).not.toHaveProperty("apiKey");
  });
});
