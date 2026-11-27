// FILE: modelDocumentRouting.ts
// Purpose: Server-owned cache and conservative routing for model document capabilities.

import type { ModelSelection, ProviderKind, ProviderModelDescriptor } from "@djl/contracts";

import { isLocalHarness } from "../harnesses/native/types.ts";

export interface WorkModelDocumentRouting {
  readonly capabilitiesKnown: boolean;
  readonly supportsVision: boolean;
  readonly supportsPdf: boolean;
  readonly processingLocality: "local" | "remote" | "unknown";
  readonly requireOcrForImages: boolean;
}

const capabilitiesByModel = new Map<string, ProviderModelDescriptor>();

function key(provider: ProviderKind, model: string): string {
  return `${provider}\0${model.trim().toLowerCase()}`;
}

export function recordProviderModelDocumentCapabilities(
  provider: ProviderKind,
  descriptors: ReadonlyArray<ProviderModelDescriptor>,
): void {
  for (const descriptor of descriptors) {
    capabilitiesByModel.set(key(provider, descriptor.slug), descriptor);
  }
}

export function clearProviderModelDocumentCapabilitiesForTests(): void {
  capabilitiesByModel.clear();
}

export function resolveWorkModelDocumentRouting(
  selection: ModelSelection,
): WorkModelDocumentRouting {
  const descriptor = capabilitiesByModel.get(key(selection.provider, selection.model));
  // A local harness is handed the saved file itself, so nothing has to be read out of an image
  // first. Whether its model can see is the harness's own affair and its own error to report.
  if (isLocalHarness(selection.provider)) {
    return {
      capabilitiesKnown: true,
      supportsVision: true,
      supportsPdf: false,
      processingLocality: descriptor?.processingLocality ?? "unknown",
      requireOcrForImages: false,
    };
  }
  if (descriptor) {
    const supportsVision = descriptor.supportsVision === true;
    return {
      capabilitiesKnown:
        typeof descriptor.supportsVision === "boolean" &&
        typeof descriptor.supportsPdf === "boolean",
      supportsVision,
      supportsPdf: descriptor.supportsPdf === true,
      processingLocality: descriptor.processingLocality ?? "unknown",
      requireOcrForImages: !supportsVision,
    };
  }

  const upstreamProvider = selection.model.split("/", 1)[0]?.toLowerCase() ?? "";
  const isKnownLocal = ["ollama", "lmstudio", "llama.cpp", "vllm"].includes(upstreamProvider);
  return {
    capabilitiesKnown: false,
    supportsVision: false,
    supportsPdf: false,
    processingLocality: isKnownLocal ? "local" : "unknown",
    requireOcrForImages: true,
  };
}
