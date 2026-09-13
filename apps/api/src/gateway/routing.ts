/**
 * Model resolution: a concrete model id, or a capability alias resolved from
 * the catalog by quality, health, and cost. Every decision carries a reason
 * code that is stored on the usage row (PRD 25, 34.1).
 */
import type { schema } from "@djl/db";

export type CatalogModel = typeof schema.modelCatalog.$inferSelect;

export const CAPABILITY_ALIASES: Record<
  string,
  { readonly needs: readonly string[]; readonly prefer: "quality" | "cost" }
> = {
  "text.fast": { needs: ["text.chat"], prefer: "cost" },
  "text.high": { needs: ["text.chat", "tools"], prefer: "quality" },
  "vision.high": { needs: ["text.chat", "vision"], prefer: "quality" },
  "image.generate": { needs: ["image.generate"], prefer: "quality" },
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

/** Rough token estimate for reservations: 4 chars per token plus per-message overhead; images ~1k tokens. */
export function estimateInputTokens(messages: readonly { readonly content: unknown }[]): number {
  let chars = 0;
  let images = 0;
  for (const m of messages) {
    if (typeof m.content === "string") chars += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const part of m.content as { type: string; text?: string }[]) {
        if (part.type === "text") chars += part.text?.length ?? 0;
        else images += 1;
      }
    }
    chars += 16;
  }
  return Math.ceil(chars / 4) + images * 1000;
}
