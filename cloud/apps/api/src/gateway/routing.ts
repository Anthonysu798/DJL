/**
 * Model resolution: a concrete model id, or a capability alias resolved from
 * the catalog by quality, health, and cost. Every decision carries a reason
 * code that is stored on the usage row (PRD 25, 34.1).
 */
import type { schema } from "@djl/db";
import { estimateTokens } from "@djl/domain";
import type { ChatRequest, ContentPart } from "@djl/providers";

export type CatalogModel = typeof schema.modelCatalog.$inferSelect;

export const CAPABILITY_ALIASES: Record<
  string,
  { readonly needs: readonly string[]; readonly prefer: "quality" | "cost" }
> = {
  "text.fast": { needs: ["text.chat"], prefer: "cost" },
  "text.high": { needs: ["text.chat", "tools"], prefer: "quality" },
  "vision.high": { needs: ["text.chat", "vision"], prefer: "quality" },
  "image.generate": { needs: ["image.generate"], prefer: "quality" },
  "image.edit": { needs: ["image.edit"], prefer: "quality" },
  embed: { needs: ["embeddings"], prefer: "cost" },
};

export interface RouteDecision {
  readonly model: CatalogModel;
  readonly reason: string;
}

export function resolveModel(
  requested: string,
  catalog: readonly CatalogModel[],
  healthy: (provider: CatalogModel["provider"]) => boolean,
): RouteDecision | { readonly error: "unknown_model" | "model_disabled" | "no_healthy_model" } {
  const alias = CAPABILITY_ALIASES[requested];
  if (!alias) {
    const model = catalog.find((m) => m.modelId === requested);
    if (!model) return { error: "unknown_model" };
    if (model.status === "disabled") return { error: "model_disabled" };
    if (healthy(model.provider)) return { model, reason: "explicit" };
    // Explicit model on an unhealthy provider: fall back within the same capabilities.
    const fallback = pick(
      catalog.filter(
        (m) =>
          m.modelId !== requested && alias_covers(m, model.capabilities) && healthy(m.provider),
      ),
      "quality",
    );
    return fallback
      ? { model: fallback, reason: `fallback:${model.provider}_unhealthy` }
      : { error: "no_healthy_model" };
  }
  const candidates = catalog.filter(
    (m) =>
      m.status === "active" &&
      alias.needs.every((c) => m.capabilities.includes(c)) &&
      healthy(m.provider),
  );
  const chosen = pick(candidates, alias.prefer);
  return chosen
    ? { model: chosen, reason: `capability:${requested}` }
    : { error: "no_healthy_model" };
}

function alias_covers(m: CatalogModel, needs: readonly string[]): boolean {
  return m.status === "active" && needs.every((c) => m.capabilities.includes(c));
}

function pick(models: readonly CatalogModel[], prefer: "quality" | "cost"): CatalogModel | null {
  if (models.length === 0) return null;
  const sorted = models.toSorted((a, b) => {
    if (prefer === "quality")
      return b.qualityScore - a.qualityScore || Number(a.inputMicroPerToken - b.inputMicroPerToken);
    const costA = a.inputMicroPerToken + a.outputMicroPerToken + a.microPerImage;
    const costB = b.inputMicroPerToken + b.outputMicroPerToken + b.microPerImage;
    return Number(costA - costB) || b.qualityScore - a.qualityScore;
  });
  return sorted[0] ?? null;
}

/** Tokens counted for one image part: providers bill an image by its size, not by the bytes sent. */
const IMAGE_TOKENS = 1_600;

/**
 * Input estimate for a chat request, from everything that is sent upstream:
 * every message with its tool calls and content parts, the tool definitions,
 * and the response format. Text is counted on the serialized request with the
 * conservative ratio of `estimateTokens`; an image part counts a flat amount
 * in place of its URL or bytes. `chars` is the serialized size without image
 * data, for the context window check.
 */
export function estimateInput(request: ChatRequest): {
  readonly tokens: number;
  readonly chars: number;
} {
  let images = 0;
  const messages = request.messages.map((message) =>
    Array.isArray(message?.content)
      ? {
          ...message,
          content: message.content.map((part: ContentPart) => {
            if (part?.type !== "image_url" || typeof part.image_url?.url !== "string") return part;
            images += 1;
            return { ...part, image_url: { ...part.image_url, url: "" } };
          }),
        }
      : message,
  );
  const text = JSON.stringify({ ...request, messages });
  return { tokens: Math.ceil(estimateTokens(text)) + images * IMAGE_TOKENS, chars: text.length };
}
