import type { ModelSelection, ProviderModelDescriptor } from "@djl/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearProviderModelDocumentCapabilitiesForTests,
  recordProviderModelDocumentCapabilities,
  resolveWorkModelDocumentRouting,
} from "./modelDocumentRouting.ts";

afterEach(clearProviderModelDocumentCapabilitiesForTests);

describe("resolveWorkModelDocumentRouting", () => {
  it("requires local extraction for a discovered nonvision local model", () => {
    recordProviderModelDocumentCapabilities("opencode", [
      {
        slug: "ollama/qwen3:8b",
        name: "Qwen 3 8B",
        supportsVision: false,
        supportsPdf: false,
        processingLocality: "local",
      } satisfies ProviderModelDescriptor,
    ]);

    expect(
      resolveWorkModelDocumentRouting({
        provider: "opencode",
        model: "ollama/qwen3:8b",
      } satisfies ModelSelection),
    ).toMatchObject({
      capabilitiesKnown: true,
      processingLocality: "local",
      requireOcrForImages: true,
    });
  });

  it.each(["codex", "claudeAgent", "cursor", "gemini", "qwen"] as const)(
    "hands the original image to the local %s harness instead of requiring OCR",
    (provider) => {
      expect(resolveWorkModelDocumentRouting({ provider, model: "any-model" })).toMatchObject({
        capabilitiesKnown: true,
        supportsVision: true,
        requireOcrForImages: false,
      });
    },
  );

  it("still requires OCR for hosted DJL Cloud, which cannot open the original file", () => {
    expect(
      resolveWorkModelDocumentRouting({ provider: "djlCloud", model: "any-model" }),
    ).toMatchObject({ supportsVision: false, requireOcrForImages: true });
  });

  it("allows a vision model to receive an original image when OCR is unavailable", () => {
    recordProviderModelDocumentCapabilities("opencode", [
      {
        slug: "openai/gpt-5.4",
        name: "GPT-5.4",
        supportsVision: true,
        supportsPdf: true,
        processingLocality: "remote",
      } satisfies ProviderModelDescriptor,
    ]);

    expect(
      resolveWorkModelDocumentRouting({
        provider: "opencode",
        model: "openai/gpt-5.4",
      } satisfies ModelSelection),
    ).toMatchObject({
      supportsVision: true,
      requireOcrForImages: false,
    });
  });
});
