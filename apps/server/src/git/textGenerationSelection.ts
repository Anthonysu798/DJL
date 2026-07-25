import type { ModelSelection, ProviderKind, ProviderStartOptions } from "@synara/contracts";

import { canonicalizeDeprecatedDeepSeekModelSelection } from "../provider/deepSeekCompatibility.ts";

export interface TextGenerationProviderInput {
  readonly modelSelection: ModelSelection;
  readonly providerOptions?: ProviderStartOptions;
  readonly codexHomePath?: string;
}

export function hasDedicatedTextGenerationProvider(provider: ProviderKind | undefined): boolean {
  return (
    provider === "codex" || provider === "cursor" || provider === "kilo" || provider === "opencode"
  );
}

export function resolveTextGenerationInputForSelection(
  modelSelection: ModelSelection | undefined,
  providerOptions: ProviderStartOptions | undefined,
): TextGenerationProviderInput | null {
  const normalizedModelSelection =
    modelSelection === undefined
      ? undefined
      : {
          ...modelSelection,
          model: canonicalizeDeprecatedDeepSeekModelSelection(
            modelSelection.provider,
            modelSelection.model,
          ),
        };
  if (
    !normalizedModelSelection ||
    !hasDedicatedTextGenerationProvider(normalizedModelSelection.provider)
  ) {
    return null;
  }

  if (normalizedModelSelection.provider === "codex") {
    return {
      modelSelection: normalizedModelSelection,
      ...(providerOptions ? { providerOptions } : {}),
      ...(providerOptions?.codex?.homePath
        ? { codexHomePath: providerOptions.codex.homePath }
        : {}),
    };
  }

  return {
    modelSelection: normalizedModelSelection,
    ...(providerOptions ? { providerOptions } : {}),
  };
}

export function buildGitTextGenerationCallInput(input: {
  readonly textGenerationModel?: string | undefined;
  readonly textGenerationModelSelection?: ModelSelection | undefined;
  readonly codexHomePath?: string | undefined;
  readonly providerOptions?: ProviderStartOptions | undefined;
}): {
  readonly model?: string;
  readonly modelSelection?: ModelSelection;
  readonly codexHomePath?: string;
  readonly providerOptions?: ProviderStartOptions;
} {
  const modelSelection = input.textGenerationModelSelection;
  const model = input.textGenerationModel?.trim() || modelSelection?.model;

  return {
    ...(model ? { model } : {}),
    ...(modelSelection ? { modelSelection } : {}),
    ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
    ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
  };
}
