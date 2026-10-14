import { creditPriceFromUsd } from "@djl/domain";
import { createDatabase, schema } from "./index.ts";
import { eq } from "drizzle-orm";

type Endpoint = {
  supported_parameters?: Record<
    string,
    { type?: string; values?: string[]; min?: number; max?: number }
  >;
  pricing?: { billable: string; unit: string; cost_usd: number; variant?: string }[];
};

/** Mobile supports one raster image and three fixed aspect ratios. Fail closed on pricing drift. */
export function validateImageModel(
  metadata: unknown,
  modelId: string,
): { usdPerImage: number; canEdit: boolean } {
  const model = metadata as { id?: string; endpoints?: Endpoint[] };
  if (model?.id !== modelId || !Array.isArray(model.endpoints) || model.endpoints.length === 0)
    throw new Error("Image model is unavailable.");
  const prices = model.endpoints.map((endpoint) => {
    const n = endpoint.supported_parameters?.n;
    const ratios = endpoint.supported_parameters?.aspect_ratio;
    const lines = endpoint.pricing;
    if (
      n?.type !== "range" ||
      (n.min ?? 2) > 1 ||
      (n.max ?? 0) < 1 ||
      ratios?.type !== "enum" ||
      !["1:1", "4:3", "3:4"].every((r) => ratios.values?.includes(r)) ||
      lines?.length !== 1
    )
      throw new Error("Unsupported image model capabilities or pricing.");
    const price = lines[0]!;
    if (
      price.billable !== "output_image" ||
      price.unit !== "image" ||
      price.variant ||
      !Number.isFinite(price.cost_usd) ||
      price.cost_usd <= 0 ||
      price.cost_usd > 1
    )
      throw new Error("Unsupported image price.");
    return price.cost_usd;
  });
  return { usdPerImage: Math.max(...prices), canEdit: false };
}

export async function configureImageModel(
  databaseUrl: string,
  modelId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!/^[a-z0-9-]+\/[a-z0-9.-]+$/.test(modelId)) throw new Error("Invalid image model ID.");
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is required.");
  const response = await fetchImpl(
    `https://openrouter.ai/api/v1/images/models/${modelId}/endpoints`,
  );
  if (!response.ok) throw new Error("Image endpoint metadata is unavailable.");
  const verified = validateImageModel(await response.json(), modelId);
  const credits = await fetchImpl("https://openrouter.ai/api/v1/credits", {
    headers: { authorization: `Bearer ${key}` },
  });
  if (!credits.ok) throw new Error("Cannot verify provider funding.");
  const balance = (await credits.json()) as {
    data?: { total_credits?: number; total_usage?: number };
  };
  if ((balance.data?.total_credits ?? 0) - (balance.data?.total_usage ?? 0) < verified.usdPerImage)
    throw new Error("Fund the existing provider account before enabling images.");
  const { db, close } = createDatabase(databaseUrl, { max: 1 });
  try {
    await db.transaction(async (tx) => {
      const id = "recraft-image";
      const [before] = await tx
        .select()
        .from(schema.modelCatalog)
        .where(eq(schema.modelCatalog.modelId, id))
        .for("update");
      const values = {
        modelId: id,
        provider: "openrouter" as const,
        upstreamModelId: modelId,
        displayName: "Recraft",
        capabilities: ["image.generate"],
        inputMicroPerToken: 0n,
        outputMicroPerToken: 0n,
        microPerImage: creditPriceFromUsd(verified.usdPerImage, 0.4),
        status: "active" as const,
        freeEligible: false,
        qualityScore: 85,
        sortOrder: 101,
      };
      await tx
        .insert(schema.modelCatalog)
        .values(values)
        .onConflictDoUpdate({ target: schema.modelCatalog.modelId, set: values });
      await tx.insert(schema.auditEvents).values({
        actorId: "setup:vps",
        actorType: "system",
        action: "model.configure_image",
        targetType: "model",
        targetId: id,
        before: before ? { upstreamModelId: before.upstreamModelId, status: before.status } : null,
        after: { modelId, usdPerImage: verified.usdPerImage, canEdit: false },
        traceId: crypto.randomUUID(),
      });
    });
  } finally {
    await close();
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL,
    model = process.env.OPENROUTER_IMAGE_MODEL_ID;
  if (!url || !model) throw new Error("DATABASE_URL and OPENROUTER_IMAGE_MODEL_ID are required.");
  await configureImageModel(url, model);
  console.log("Verified image model configured; editing remains unavailable.");
}
