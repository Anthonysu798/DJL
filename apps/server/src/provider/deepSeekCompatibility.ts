// FILE: deepSeekCompatibility.ts
// Purpose: Applies DJL's compatibility policy for the official DeepSeek OpenCode provider.
// Layer: Provider compatibility policy

const OFFICIAL_DEEPSEEK_PROVIDER_ID = "deepseek";
const SUPPORTED_OFFICIAL_DEEPSEEK_MODELS = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);
const DEPRECATED_OFFICIAL_DEEPSEEK_MODEL_SLUGS = new Set([
  "deepseek/deepseek-chat",
  "deepseek/deepseek-reasoner",
]);

export const OFFICIAL_DEEPSEEK_V4_FLASH_MODEL_SLUG = "deepseek/deepseek-v4-flash";

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

export function isSupportedOfficialDeepSeekCatalogModel(
  providerId: string,
  modelId: string,
): boolean {
  return (
    normalized(providerId) !== OFFICIAL_DEEPSEEK_PROVIDER_ID ||
    SUPPORTED_OFFICIAL_DEEPSEEK_MODELS.has(normalized(modelId))
  );
}

export function canonicalizeDeprecatedDeepSeekModelSelection(
  provider: string,
  model: string,
): string {
  return normalized(provider) === "opencode" &&
    DEPRECATED_OFFICIAL_DEEPSEEK_MODEL_SLUGS.has(normalized(model))
    ? OFFICIAL_DEEPSEEK_V4_FLASH_MODEL_SLUG
    : model;
}
