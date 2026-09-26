/**
 * Model catalog seed. Provider prices below are PLACEHOLDERS entered at build
 * time; the admin app's catalog page is where real list prices are confirmed
 * before launch. User prices are derived with the configured margin so a
 * price edit in admin recomputes credits consistently.
 */
import { creditPriceFromUsd, creditPricePerUnitFromUsdPerMillion } from "@djl/domain";

import { createDatabase } from "./client.ts";
import { modelCatalog } from "./schema/index.ts";

interface SeedModel {
  readonly modelId: string;
  readonly provider: "openai" | "anthropic" | "openrouter";
  readonly upstreamModelId: string;
  readonly displayName: string;
  readonly capabilities: readonly string[];
  readonly inputUsdPerMillion?: number;
  readonly outputUsdPerMillion?: number;
  readonly cachedInputUsdPerMillion?: number;
  readonly usdPerImage?: number;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly qualityScore: number;
  readonly sortOrder: number;
  /** Cheap models the weekly free allowance may be spent on. */
  readonly freeEligible?: boolean;
}

const TEXT = ["text.chat", "tools", "vision", "json"] as const;

export const SEED_MODELS: readonly SeedModel[] = [
  {
    modelId: "gpt-5",
    provider: "openai",
    upstreamModelId: "gpt-5",
    displayName: "GPT-5",
    capabilities: TEXT,
    inputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
    cachedInputUsdPerMillion: 0.125,
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    qualityScore: 90,
    sortOrder: 10,
  },
  {
    modelId: "gpt-5-mini",
    provider: "openai",
    upstreamModelId: "gpt-5-mini",
    displayName: "GPT-5 mini",
    capabilities: TEXT,
    inputUsdPerMillion: 0.25,
    outputUsdPerMillion: 2,
    cachedInputUsdPerMillion: 0.025,
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    qualityScore: 75,
    sortOrder: 20,
    freeEligible: true,
  },
  {
    modelId: "claude-opus-5",
    provider: "anthropic",
    upstreamModelId: "claude-opus-5",
    displayName: "Claude Opus 5",
    capabilities: TEXT,
    inputUsdPerMillion: 15,
    outputUsdPerMillion: 75,
    cachedInputUsdPerMillion: 1.5,
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    qualityScore: 95,
    sortOrder: 5,
  },
  {
    modelId: "claude-sonnet-5",
    provider: "anthropic",
    upstreamModelId: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    capabilities: TEXT,
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    cachedInputUsdPerMillion: 0.3,
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    qualityScore: 88,
    sortOrder: 12,
  },
  {
    modelId: "claude-haiku-4-5",
    provider: "anthropic",
    upstreamModelId: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    capabilities: TEXT,
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 5,
    cachedInputUsdPerMillion: 0.1,
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    qualityScore: 72,
    sortOrder: 22,
    freeEligible: true,
  },
  {
    modelId: "gemini-2.5-pro",
    provider: "openrouter",
    upstreamModelId: "google/gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    capabilities: TEXT,
    inputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    qualityScore: 85,
    sortOrder: 30,
  },
  {
    modelId: "grok-4",
    provider: "openrouter",
    upstreamModelId: "x-ai/grok-4",
    displayName: "Grok 4",
    capabilities: TEXT,
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    contextWindow: 256_000,
    maxOutputTokens: 32_000,
    qualityScore: 82,
    sortOrder: 32,
  },
  {
    modelId: "deepseek-v3",
    provider: "openrouter",
    upstreamModelId: "deepseek/deepseek-chat-v3",
    displayName: "DeepSeek V3",
    capabilities: ["text.chat", "tools", "json"],
    inputUsdPerMillion: 0.3,
    outputUsdPerMillion: 1.2,
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    qualityScore: 74,
    sortOrder: 40,
    freeEligible: true,
  },
  {
    modelId: "kimi-k2",
    provider: "openrouter",
    upstreamModelId: "moonshotai/kimi-k2",
    displayName: "Kimi K2",
    capabilities: ["text.chat", "tools", "json"],
    inputUsdPerMillion: 0.6,
    outputUsdPerMillion: 2.5,
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    qualityScore: 74,
    sortOrder: 42,
  },
  {
    modelId: "glm-4.5",
    provider: "openrouter",
    upstreamModelId: "z-ai/glm-4.5",
    displayName: "GLM 4.5",
    capabilities: ["text.chat", "tools", "json"],
    inputUsdPerMillion: 0.6,
    outputUsdPerMillion: 2.2,
    contextWindow: 128_000,
    maxOutputTokens: 16_000,
    qualityScore: 72,
    sortOrder: 44,
  },
  {
    modelId: "gpt-image-1",
    provider: "openai",
    upstreamModelId: "gpt-image-1",
    displayName: "GPT Image 1",
    capabilities: ["image.generate", "image.edit"],
    usdPerImage: 0.04,
    qualityScore: 88,
    sortOrder: 100,
  },
  {
    modelId: "flux-1.1-pro",
    provider: "openrouter",
    upstreamModelId: "black-forest-labs/flux-1.1-pro",
    displayName: "FLUX 1.1 Pro",
    capabilities: ["image.generate"],
    usdPerImage: 0.04,
    qualityScore: 84,
    sortOrder: 102,
  },
  {
    modelId: "text-embedding-3-small",
    provider: "openai",
    upstreamModelId: "text-embedding-3-small",
    displayName: "Text Embedding 3 Small",
    capabilities: ["embeddings"],
    inputUsdPerMillion: 0.02,
    outputUsdPerMillion: 0,
    qualityScore: 70,
    sortOrder: 200,
  },
];

export async function seedModels(databaseUrl: string, margin = 0.4): Promise<number> {
  const { db, close } = createDatabase(databaseUrl, { max: 1 });
  try {
    let inserted = 0;
    for (const m of SEED_MODELS) {
      const result = await db
        .insert(modelCatalog)
        .values({
          modelId: m.modelId,
          provider: m.provider,
          upstreamModelId: m.upstreamModelId,
          displayName: m.displayName,
          capabilities: [...m.capabilities],
          inputMicroPerToken:
            m.inputUsdPerMillion !== undefined
              ? creditPricePerUnitFromUsdPerMillion(m.inputUsdPerMillion, margin)
              : 0n,
          outputMicroPerToken:
            m.outputUsdPerMillion !== undefined
              ? creditPricePerUnitFromUsdPerMillion(m.outputUsdPerMillion, margin)
              : 0n,
          cachedInputMicroPerToken:
            m.cachedInputUsdPerMillion !== undefined
              ? creditPricePerUnitFromUsdPerMillion(m.cachedInputUsdPerMillion, margin)
              : 0n,
          microPerImage:
            m.usdPerImage !== undefined ? creditPriceFromUsd(m.usdPerImage, margin) : 0n,
          providerInputUsdPerMillion: m.inputUsdPerMillion?.toString() ?? null,
          providerOutputUsdPerMillion: m.outputUsdPerMillion?.toString() ?? null,
          contextWindow: m.contextWindow ?? null,
          maxOutputTokens: m.maxOutputTokens ?? null,
          qualityScore: m.qualityScore,
          sortOrder: m.sortOrder,
          freeEligible: m.freeEligible ?? false,
        })
        .onConflictDoNothing({ target: modelCatalog.modelId })
        .returning({ id: modelCatalog.modelId });
      inserted += result.length;
    }
    return inserted;
  } finally {
    await close();
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  console.log(`seeded ${await seedModels(url)} models`);
}
