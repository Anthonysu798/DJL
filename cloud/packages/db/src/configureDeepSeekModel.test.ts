import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, schema } from "./index.ts";

import {
  configureDeepSeekModel,
  validateDeepSeekModel,
  validateDeepSeekProbe,
  verifyDeepSeekFunding,
} from "./configureDeepSeekModel.ts";

const metadata = {
  id: "deepseek/deepseek-v4.1-flash",
  architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
  endpoints: [
    {
      context_length: 1_048_576,
      max_completion_tokens: 131_072,
      pricing: {
        prompt: "0.0000000216",
        completion: "0.00000072",
        input_cache_read: "0.0000000054",
      },
      supported_parameters: ["max_tokens", "tools", "tool_choice", "response_format"],
    },
    {
      context_length: 1_000_000,
      max_completion_tokens: 65_536,
      pricing: { prompt: "0.0000006", completion: "0.0000024", input_cache_read: "0.00000003" },
      supported_parameters: ["max_tokens", "tools", "tool_choice", "response_format"],
    },
  ],
};

const jsonFetch = (credits: unknown, key: unknown) =>
  (async (input: string | URL | Request) =>
    Response.json({ data: String(input).endsWith("/credits") ? credits : key })) as typeof fetch;

describe("DeepSeek catalog preparation", () => {
  it("covers every endpoint's price and uses conservative context limits", () => {
    expect(validateDeepSeekModel(metadata)).toMatchObject({
      modelId: "deepseek-v4.1-flash",
      provider: "openrouter",
      capabilities: ["text.chat", "tools", "vision", "json"],
      inputMicroPerToken: 100n,
      outputMicroPerToken: 400n,
      cachedInputMicroPerToken: 5n,
      providerInputUsdPerMillion: "0.6",
      providerOutputUsdPerMillion: "2.4",
      contextWindow: 1_000_000,
      maxOutputTokens: 8192,
      freeEligible: false,
    });
  });

  it("covers scheduled price increases instead of using only the current price", () => {
    const endpoint = metadata.endpoints[0]!;
    const scheduled = {
      ...metadata,
      endpoints: [
        {
          ...endpoint,
          pricing: {
            ...endpoint.pricing,
            overrides: [
              {
                utc_start: 100,
                utc_end: 400,
                prompt: "0.0000009",
                completion: "0.000003",
                input_cache_read: "0.00000006",
              },
            ],
          },
        },
      ],
    };
    expect(validateDeepSeekModel(scheduled)).toMatchObject({
      inputMicroPerToken: 150n,
      outputMicroPerToken: 500n,
      cachedInputMicroPerToken: 10n,
    });
  });

  it.each([
    {},
    { ...metadata, id: "deepseek/other" },
    { ...metadata, endpoints: [] },
    { ...metadata, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
    {
      ...metadata,
      endpoints: [{ ...metadata.endpoints[0], pricing: { prompt: "NaN", completion: "1" } }],
    },
    { ...metadata, endpoints: [{ ...metadata.endpoints[0], supported_parameters: [] }] },
  ])("rejects unavailable or unsupported endpoint metadata", (input) => {
    expect(() => validateDeepSeekModel(input)).toThrow();
  });
});

describe("DeepSeek activation funding", () => {
  it.each([
    [
      { total_credits: 0, total_usage: 0 },
      { limit: 1, limit_remaining: 1 },
    ],
    [
      { total_credits: 1, total_usage: 2 },
      { limit: 1, limit_remaining: 1 },
    ],
    [
      { total_credits: 5, total_usage: 0 },
      { limit: 1, limit_remaining: 0 },
    ],
    [{}, { limit: 1, limit_remaining: 1 }],
  ])("blocks an unfunded account or exhausted key", async (credits, key) => {
    await expect(verifyDeepSeekFunding("test-key", jsonFetch(credits, key))).rejects.toThrow();
  });

  it("accepts funded access with the existing bounded key", async () => {
    await expect(
      verifyDeepSeekFunding(
        "test-key",
        jsonFetch({ total_credits: 5, total_usage: 1 }, { limit: 1, limit_remaining: 1 }),
      ),
    ).resolves.toBeUndefined();
  });

  it("does not open the database when activation cannot be funded", async () => {
    const fetchImpl = (async (input: string | URL | Request) =>
      String(input).endsWith("/endpoints")
        ? Response.json({ data: metadata })
        : Response.json({
            data: { total_credits: 0, total_usage: 0, limit: 1, limit_remaining: 1 },
          })) as typeof fetch;
    await expect(
      configureDeepSeekModel("invalid-database-url", "activate", { key: "test-key", fetchImpl }),
    ).rejects.toThrow("Fund the existing OpenRouter account");
  });
});

describe("DeepSeek streamed vision and tool probe", () => {
  const stream = [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { name: "report_colour", arguments: '{"colour":' } },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: '"red"}' } }] },
          finish_reason: "tool_calls",
        },
      ],
    },
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 8 } },
  ]
    .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
    .join("");

  it("requires a complete, metered tool call with the observed image colour", () => {
    expect(() => validateDeepSeekProbe(`${stream}data: [DONE]\n\n`)).not.toThrow();
  });

  it.each([
    stream,
    'data: {"error":{"message":"provider failed"}}\n\ndata: [DONE]\n\n',
    `${stream.replace("red", "blue")}data: [DONE]\n\n`,
    `${stream.replace('"prompt_tokens":100', '"prompt_tokens":0')}data: [DONE]\n\n`,
  ])("rejects failed, incomplete, incorrect, or unmetered responses", (body) => {
    expect(() => validateDeepSeekProbe(body)).toThrow();
  });
});

describe("DeepSeek catalog writes", () => {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://djl:djl@localhost:54329/djl";
  const admin = createDatabase(databaseUrl, { max: 1 });
  const namespace = `deepseek_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const scopedUrl = new URL(databaseUrl);
  scopedUrl.searchParams.set("options", `-c search_path=${namespace},public`);
  const scoped = createDatabase(scopedUrl.toString(), { max: 1 });
  const prepareFetch = (async () => Response.json({ data: metadata })) as typeof fetch;
  beforeAll(async () => {
    await admin.sql.unsafe(`CREATE SCHEMA ${namespace}`);
    await admin.sql.unsafe(
      `CREATE TABLE ${namespace}.model_catalog (LIKE public.model_catalog INCLUDING ALL)`,
    );
    await admin.sql.unsafe(
      `CREATE TABLE ${namespace}.audit_events (LIKE public.audit_events INCLUDING ALL)`,
    );
  });
  beforeEach(async () => {
    await scoped.sql.unsafe(`TRUNCATE ${namespace}.model_catalog, ${namespace}.audit_events`);
  });
  afterAll(async () => {
    await scoped.close();
    await admin.sql.unsafe(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);
    await admin.close();
  });

  it("prepares a hidden paid model with an audit record and safely repeats", async () => {
    await configureDeepSeekModel(scopedUrl.toString(), "prepare", { fetchImpl: prepareFetch });
    await configureDeepSeekModel(scopedUrl.toString(), "prepare", { fetchImpl: prepareFetch });
    const models = await scoped.db.select().from(schema.modelCatalog);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      status: "disabled",
      freeEligible: false,
      inputMicroPerToken: 100n,
      outputMicroPerToken: 400n,
    });
    const audits = await scoped.db.select().from(schema.auditEvents);
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      action: "model.deepseek.prepare",
      after: { status: "disabled" },
    });
  });

  it("does not disable an already active model", async () => {
    await scoped.db
      .insert(schema.modelCatalog)
      .values({ ...validateDeepSeekModel(metadata), status: "active" });
    await expect(
      configureDeepSeekModel(scopedUrl.toString(), "prepare", { fetchImpl: prepareFetch }),
    ).rejects.toThrow("already active");
    expect((await scoped.db.select().from(schema.modelCatalog))[0]?.status).toBe("active");
    expect(await scoped.db.select().from(schema.auditEvents)).toHaveLength(0);
  });

  it("keeps preparation unchanged when the funded live probe fails", async () => {
    await configureDeepSeekModel(scopedUrl.toString(), "prepare", { fetchImpl: prepareFetch });
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/endpoints")) return Response.json({ data: metadata });
      if (url.endsWith("/credits"))
        return Response.json({ data: { total_credits: 5, total_usage: 0 } });
      if (url.endsWith("/key")) return Response.json({ data: { limit: 1, limit_remaining: 1 } });
      return new Response("", { status: 502 });
    }) as typeof fetch;
    await expect(
      configureDeepSeekModel(scopedUrl.toString(), "activate", { key: "test-key", fetchImpl }),
    ).rejects.toThrow("live probe failed");
    expect((await scoped.db.select().from(schema.modelCatalog))[0]?.status).toBe("disabled");
    expect(await scoped.db.select().from(schema.auditEvents)).toHaveLength(1);
  });

  it("activates only after a funded, metered image/tool response and audits the change", async () => {
    await configureDeepSeekModel(scopedUrl.toString(), "prepare", { fetchImpl: prepareFetch });
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/endpoints")) return Response.json({ data: metadata });
      if (url.endsWith("/credits"))
        return Response.json({ data: { total_credits: 5, total_usage: 0 } });
      if (url.endsWith("/key")) return Response.json({ data: { limit: 1, limit_remaining: 1 } });
      const request = JSON.parse(String(init?.body));
      if (
        request.model !== metadata.id ||
        request.stream !== true ||
        request.max_tokens > 128 ||
        request.messages[0].content[1].type !== "image_url" ||
        request.tool_choice.function.name !== "report_colour"
      )
        return new Response("", { status: 400 });
      return new Response(
        `data: ${JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      name: "report_colour",
                      arguments: '{"colour":"red"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 8 },
        })}\n\ndata: [DONE]\n\n`,
      );
    }) as typeof fetch;
    await expect(
      configureDeepSeekModel(scopedUrl.toString(), "activate", { key: "test-key", fetchImpl }),
    ).resolves.toMatchObject({ status: "active" });
    expect((await scoped.db.select().from(schema.modelCatalog))[0]?.status).toBe("active");
    const audits = await scoped.db.select().from(schema.auditEvents);
    expect(audits).toHaveLength(2);
    expect(audits.find((row) => row.action === "model.deepseek.activate")).toMatchObject({
      before: { status: "disabled" },
      after: { status: "active", freeEligible: false },
    });
  });
});
