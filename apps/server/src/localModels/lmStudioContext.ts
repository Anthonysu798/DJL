export const LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS = 16_384;

export interface LmStudioContextResolutionInput {
  readonly managed: boolean;
  readonly supportsToolCalls: boolean | null;
  readonly maxContextWindowTokens: number | null;
  readonly loadedContextWindowTokens: number | null;
}

export interface LmStudioContextResolution {
  readonly effectiveContextWindowTokens: number | null;
  readonly requiredLoadContextWindowTokens: number | null;
  readonly toolsUsable: boolean;
}

export function resolveLmStudioContext(
  input: LmStudioContextResolutionInput,
): LmStudioContextResolution {
  if (input.supportsToolCalls !== true) {
    return {
      effectiveContextWindowTokens: input.loadedContextWindowTokens,
      requiredLoadContextWindowTokens: null,
      toolsUsable: false,
    };
  }
  if (
    input.maxContextWindowTokens === null ||
    input.maxContextWindowTokens < LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS
  ) {
    return {
      effectiveContextWindowTokens: input.loadedContextWindowTokens,
      requiredLoadContextWindowTokens: null,
      toolsUsable: false,
    };
  }
  if (
    input.loadedContextWindowTokens !== null &&
    input.loadedContextWindowTokens >= LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS
  ) {
    return {
      effectiveContextWindowTokens: input.loadedContextWindowTokens,
      requiredLoadContextWindowTokens: null,
      toolsUsable: true,
    };
  }
  if (!input.managed) {
    return {
      effectiveContextWindowTokens: input.loadedContextWindowTokens,
      requiredLoadContextWindowTokens: null,
      toolsUsable: false,
    };
  }
  return {
    effectiveContextWindowTokens: LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS,
    requiredLoadContextWindowTokens: LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS,
    toolsUsable: true,
  };
}
