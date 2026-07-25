// FILE: modelDocumentRouting.ts
// Purpose: Server-owned cache and conservative routing for model document capabilities.

import type { ModelSelection, ProviderKind, ProviderModelDescriptor } from "@synara/contracts";

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
