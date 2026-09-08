import type { ThreadTokenUsageSnapshot } from "@synara/contracts";
import { nonNegativeInteger, positiveInteger } from "../../provider/tokenUsage";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

export function codexContextUsage(value: unknown): ThreadTokenUsageSnapshot | undefined {
  const usage = record(value);
  const last = record(usage.last ?? usage.last_token_usage);
  const total = record(usage.total ?? usage.total_token_usage);
  const usedTokens = nonNegativeInteger(last.totalTokens ?? last.total_tokens);
  if (usedTokens === undefined) return undefined;
  const maxTokens = positiveInteger(usage.modelContextWindow ?? usage.model_context_window);
  const totalProcessedTokens = nonNegativeInteger(total.totalTokens ?? total.total_tokens);
  return {
    usedTokens,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(totalProcessedTokens !== undefined ? { totalProcessedTokens } : {}),
    compactsAutomatically: true,
  };
}

// One API call's prompt, including cache hits, is the current context. Session totals are not.
export function claudeContextUsage(
  value: unknown,
  window?: number,
): ThreadTokenUsageSnapshot | undefined {
  const usage = record(value);
  if (nonNegativeInteger(usage.input_tokens) === undefined) return undefined;
  const inputTokens =
    (nonNegativeInteger(usage.input_tokens) ?? 0) +
    (nonNegativeInteger(usage.cache_read_input_tokens) ?? 0) +
    (nonNegativeInteger(usage.cache_creation_input_tokens) ?? 0);
  const outputTokens = nonNegativeInteger(usage.output_tokens) ?? 0;
  const maxTokens = positiveInteger(window);
  return {
    usedTokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    cachedInputTokens: nonNegativeInteger(usage.cache_read_input_tokens) ?? 0,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    compactsAutomatically: true,
  };
}
