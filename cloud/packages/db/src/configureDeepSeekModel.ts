import { creditPricePerUnitFromUsdPerMillion } from "@djl/domain";
import { eq } from "drizzle-orm";

import { createDatabase, schema } from "./index.ts";

const MODEL_ID = "deepseek-v4.1-flash";
const UPSTREAM_ID = "deepseek/deepseek-v4.1-flash";
const BASE = "https://openrouter.ai/api/v1";
const RED_SQUARE =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==";

type Endpoint = {
  context_length?: number;
  max_completion_tokens?: number;
  supported_parameters?: string[];
  pricing?: Record<string, unknown>;
};

function price(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    !Number.isFinite(Number(value)) ||
    Number(value) < 0
  )
    throw new Error("Invalid DeepSeek endpoint price.");
  return Number(value) * 1_000_000;
}

const auditValue = (value: unknown) =>
  JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)));

/** Use the highest route price; OpenRouter's headline price is the cheapest route. */
export function validateDeepSeekModel(metadata: unknown) {
  const model = metadata as {
    id?: string;
    architecture?: { input_modalities?: string[]; output_modalities?: string[] };
    endpoints?: Endpoint[];
  } | null;
  if (
    model?.id !== UPSTREAM_ID ||
    !model.architecture?.input_modalities?.includes("image") ||
    !model.architecture.input_modalities.includes("text") ||
    !model.architecture.output_modalities?.includes("text") ||
    !Array.isArray(model.endpoints) ||
    model.endpoints.length === 0
  )
    throw new Error("DeepSeek vision model metadata is unavailable or unsupported.");

  const prices = model.endpoints.flatMap((endpoint) => {
    const pricing = endpoint.pricing;
    if (
      !pricing ||
      !["max_tokens", "tools"].every((p) => endpoint.supported_parameters?.includes(p)) ||
      !Number.isSafeInteger(endpoint.context_length) ||
      (endpoint.context_length ?? 0) <= 0 ||
      !Number.isSafeInteger(endpoint.max_completion_tokens) ||
      (endpoint.max_completion_tokens ?? 0) <= 0
    )
      throw new Error("Unsupported DeepSeek endpoint capabilities or additional pricing.");
    const { overrides, ...base } = pricing;
    if (overrides !== undefined && !Array.isArray(overrides))
      throw new Error("Invalid scheduled DeepSeek prices.");
    const bands = [
      base,
      ...(overrides ?? []).map((override: unknown) => {
        if (!override || typeof override !== "object" || Array.isArray(override))
          throw new Error("Invalid scheduled DeepSeek prices.");
        return Object.assign({}, base, override);
      }),
    ];
    return bands.map((band) => {
      if (
        Object.entries(band).some(
          ([key, value]) =>
            ![
              "prompt",
              "completion",
              "input_cache_read",
              "discount",
              "utc_start",
              "utc_end",
              "utc_days",
            ].includes(key) &&
            value != null &&
            Number(value) !== 0,
        )
      )
        throw new Error("Unsupported additional DeepSeek pricing.");
      const input = price(band.prompt),
        output = price(band.completion);
      if (input <= 0 || output <= 0) throw new Error("Expected a priced DeepSeek endpoint.");
      return { input, output, cached: price(band.input_cache_read ?? band.prompt) };
    });
  });
  const input = Math.max(...prices.map((p) => p.input));
  const output = Math.max(...prices.map((p) => p.output));
  const cached = Math.max(...prices.map((p) => p.cached));
  const json = model.endpoints.every((e) =>
    e.supported_parameters?.some((p) => p === "response_format" || p === "structured_outputs"),
  );
  return {
    modelId: MODEL_ID,
    provider: "openrouter" as const,
    upstreamModelId: UPSTREAM_ID,
    displayName: "DeepSeek V4.1 Flash",
    capabilities: ["text.chat", "tools", "vision", ...(json ? ["json"] : [])],
    inputMicroPerToken: creditPricePerUnitFromUsdPerMillion(input, 0.4),
    outputMicroPerToken: creditPricePerUnitFromUsdPerMillion(output, 0.4),
    cachedInputMicroPerToken: creditPricePerUnitFromUsdPerMillion(cached, 0.4),
    providerInputUsdPerMillion: String(input),
    providerOutputUsdPerMillion: String(output),
    contextWindow: Math.min(...model.endpoints.map((e) => e.context_length!)),
    maxOutputTokens: Math.min(8192, ...model.endpoints.map((e) => e.max_completion_tokens!)),
    freeEligible: false,
    qualityScore: 80,
    sortOrder: 41,
  };
}

async function getData(path: string, fetchImpl: typeof fetch, key?: string) {
  const response = await fetchImpl(`${BASE}/${path}`, {
    ...(key ? { headers: { authorization: `Bearer ${key}` } } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OpenRouter ${path} check failed (${response.status}).`);
  return ((await response.json()) as { data: unknown }).data;
}

export async function verifyDeepSeekFunding(key: string, fetchImpl: typeof fetch = fetch) {
  const credits = (await getData("credits", fetchImpl, key)) as {
    total_credits?: number;
    total_usage?: number;
  };
  if (
    !Number.isFinite(credits?.total_credits) ||
    !Number.isFinite(credits?.total_usage) ||
    credits.total_credits! - credits.total_usage! < 0.01
  )
    throw new Error(
      "Fund the existing OpenRouter account before activating DeepSeek (at least $0.01 available).",
    );
  const info = (await getData("key", fetchImpl, key)) as {
    limit?: number | null;
    limit_remaining?: number | null;
  };
  if (
    info?.limit !== null &&
    (!Number.isFinite(info?.limit_remaining) || info.limit_remaining! < 0.01)
  )
    throw new Error("The existing OpenRouter key has insufficient remaining allowance.");
}

export function validateDeepSeekProbe(body: string) {
  let name = "",
    args = "",
    finished = false,
    metered = false;
  const lines = body
    .replaceAll("\r", "")
    .split("\n")
    .filter((line) => line.startsWith("data: "));
  if (lines.at(-1) !== "data: [DONE]") throw new Error("DeepSeek probe stream is incomplete.");
  for (const line of lines.slice(0, -1)) {
    const frame = JSON.parse(line.slice(6)) as {
      error?: unknown;
      choices?: {
        delta?: {
          tool_calls?: { index?: number; function?: { name?: string; arguments?: string } }[];
        };
        finish_reason?: string;
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    if (frame.error) throw new Error("DeepSeek probe returned an upstream error.");
    for (const call of frame.choices?.[0]?.delta?.tool_calls ?? []) {
      if (call.index !== 0) throw new Error("DeepSeek probe returned unexpected tool calls.");
      name += call.function?.name ?? "";
      args += call.function?.arguments ?? "";
    }
    finished ||= frame.choices?.[0]?.finish_reason === "tool_calls";
    metered ||= (frame.usage?.prompt_tokens ?? 0) > 0 && (frame.usage?.completion_tokens ?? 0) > 0;
  }
  if (!finished || !metered || name !== "report_colour" || JSON.parse(args).colour !== "red")
    throw new Error("DeepSeek did not complete the metered vision/tool probe correctly.");
}

export async function configureDeepSeekModel(
  databaseUrl: string,
  mode: "prepare" | "activate",
  {
    fetchImpl = fetch,
    key = process.env.OPENROUTER_API_KEY,
  }: { fetchImpl?: typeof fetch; key?: string } = {},
) {
  const values = validateDeepSeekModel(await getData(`models/${UPSTREAM_ID}/endpoints`, fetchImpl));
  if (mode === "activate") {
    if (!key) throw new Error("OPENROUTER_API_KEY is required for activation.");
    await verifyDeepSeekFunding(key, fetchImpl);
    const response = await fetchImpl(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: UPSTREAM_ID,
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 128,
        reasoning: { enabled: false },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Identify the solid square's colour and call report_colour exactly once. Do not write other text.",
              },
              { type: "image_url", image_url: { url: `data:image/png;base64,${RED_SQUARE}` } },
            ],
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_colour",
              parameters: {
                type: "object",
                properties: { colour: { type: "string", enum: ["red", "blue", "green"] } },
                required: ["colour"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "report_colour" } },
      }),
    });
    if (!response.ok)
      throw new Error(`DeepSeek live probe failed (${response.status}); catalog unchanged.`);
    validateDeepSeekProbe(await response.text());
  }
  const { db, close } = createDatabase(databaseUrl, { max: 1 });
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(schema.modelCatalog)
        .where(eq(schema.modelCatalog.modelId, MODEL_ID))
        .for("update");
      if (mode === "prepare" && before?.status === "active")
        throw new Error("DeepSeek is already active; preparation will not disable it.");
      const row = {
        ...values,
        status: mode === "activate" ? ("active" as const) : ("disabled" as const),
      };
      await tx
        .insert(schema.modelCatalog)
        .values(row)
        .onConflictDoUpdate({ target: schema.modelCatalog.modelId, set: row });
      await tx.insert(schema.auditEvents).values({
        actorId: "setup:vps",
        actorType: "system",
        action: `model.deepseek.${mode}`,
        targetType: "model",
        targetId: MODEL_ID,
        before: before ? auditValue(before) : null,
        after: auditValue(row),
        traceId: crypto.randomUUID(),
      });
    });
  } finally {
    await close();
  }
  return { modelId: MODEL_ID, status: mode === "activate" ? "active" : "disabled" };
}

if (import.meta.main) {
  const mode = process.argv[2],
    url = process.env.DATABASE_URL;
  if (!url || (mode !== "prepare" && mode !== "activate"))
    throw new Error(
      "Usage: DATABASE_URL=... [OPENROUTER_API_KEY=...] bun cloud/packages/db/src/configureDeepSeekModel.ts prepare|activate",
    );
  console.log(JSON.stringify(await configureDeepSeekModel(url, mode)));
}
