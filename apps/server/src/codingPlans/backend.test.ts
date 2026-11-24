import { findCodingPlan } from "@djl/contracts";
import { describe, expect, it } from "vitest";

import {
  buildClaudeBackendEnv,
  describeClaudeBackendError,
  modelBackendKey,
  ollamaContextWindow,
  ollamaModelMaxContext,
  ollamaPickerModels,
  parseModelBackend,
} from "./backend";

const PLAN_KEY = "fake-key-0000-9876";
const inherited = {
  HOME: "/tmp/home",
  PATH: "/usr/bin",
  ANTHROPIC_BASE_URL: "https://corp-proxy.example",
  ANTHROPIC_API_KEY: "sk-user-own",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth-user",
};

describe("parseModelBackend", () => {
  it("routes plan, Ollama, and normal slugs", () => {
    expect(parseModelBackend("claude-sonnet-4-6")).toEqual({
      kind: "default",
      model: "claude-sonnet-4-6",
    });
    const plan = parseModelBackend("plan/zai-coding-plan/glm-5.3");
    expect(plan.kind === "plan" && plan.plan.id).toBe("zai-coding-plan");
    expect(plan.kind === "plan" && plan.model).toBe("glm-5.3");
    expect(parseModelBackend("ollama/hf.co/org/model:q4")).toEqual({
      kind: "ollama",
      model: "hf.co/org/model:q4",
    });
    expect(() => parseModelBackend("plan/unknown/x")).toThrow(/Unknown coding plan/);
    expect(modelBackendKey(plan)).toBe("plan:zai-coding-plan");
  });
});

describe("buildClaudeBackendEnv", () => {
  it("leaves a normal Claude session's env untouched", () => {
    expect(buildClaudeBackendEnv(inherited, parseModelBackend("claude-opus-4-6"))).toBeUndefined();
  });

  it("routes a Z.AI plan session to its endpoint with its token and model tiers", () => {
    const result = buildClaudeBackendEnv(
      inherited,
      parseModelBackend("plan/zai-coding-plan/glm-5.3"),
      PLAN_KEY,
    )!;
    const plan = findCodingPlan("zai-coding-plan")!;
    expect(result.env).toMatchObject({
      HOME: "/tmp/home",
      PATH: "/usr/bin",
      ANTHROPIC_BASE_URL: plan.baseUrl,
      ANTHROPIC_AUTH_TOKEN: PLAN_KEY,
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_MODEL: "glm-5.3",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3[1m]",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.3[1m]",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.3-flash[1m]",
      API_TIMEOUT_MS: "3000000",
    });
    expect(result.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(result.settingsEnv.ANTHROPIC_BASE_URL).toBe(plan.baseUrl);
    expect(result.settingsEnv.ANTHROPIC_AUTH_TOKEN).toBe(PLAN_KEY);
    // The caller's env object is not mutated, so a later normal session sees none of this.
    expect(inherited.ANTHROPIC_BASE_URL).toBe("https://corp-proxy.example");
  });

  it("uses ANTHROPIC_API_KEY for Kimi, as Kimi documents", () => {
    const result = buildClaudeBackendEnv(
      inherited,
      parseModelBackend("plan/kimi-for-coding/k3.1-pro"),
      PLAN_KEY,
    )!;
    expect(result.env.ANTHROPIC_API_KEY).toBe(PLAN_KEY);
    expect(result.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(result.env.ANTHROPIC_BASE_URL).toBe("https://api.kimi.ai/coding/");
  });

  it("refuses a plan session without a saved key", () => {
    expect(() =>
      buildClaudeBackendEnv(inherited, parseModelBackend("plan/zai-coding-plan/glm-5.3")),
    ).toThrow(/not connected/);
  });

  it("routes an Ollama session to the local Anthropic-compatible API", () => {
    const result = buildClaudeBackendEnv(
      inherited,
      parseModelBackend("ollama/qwen2.5-coder:1.5b"),
    )!;
    expect(result.env).toMatchObject({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:11434",
      ANTHROPIC_AUTH_TOKEN: "ollama",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_MODEL: "qwen2.5-coder:1.5b",
    });
  });
});

const model = (
  modelId: string,
  runtime: "ollama" | "lmstudio",
  supportsToolCalls: boolean | null,
) => ({
  runtime,
  modelId,
  name: modelId,
  sizeBytes: 1,
  contextWindowTokens: null,
  supportsToolCalls,
});

describe("ollamaPickerModels", () => {
  it("lists only downloaded Ollama models, keeping their tool support", () => {
    expect(
      ollamaPickerModels([
        model("qwen2.5-coder:1.5b", "ollama", false),
        model("granite4.1:3b", "ollama", null),
        model("qwen/qwen3.5-2b", "lmstudio", true),
      ]),
    ).toEqual([
      {
        slug: "ollama/qwen2.5-coder:1.5b",
        name: "qwen2.5-coder:1.5b",
        upstreamProviderId: "ollama",
        upstreamProviderName: "Local (Ollama)",
        processingLocality: "local",
        supportsToolCalls: false,
      },
      {
        slug: "ollama/granite4.1:3b",
        name: "granite4.1:3b",
        upstreamProviderId: "ollama",
        upstreamProviderName: "Local (Ollama)",
        processingLocality: "local",
      },
    ]);
    // A removed model is simply absent from the next snapshot, so it leaves every picker.
    expect(ollamaPickerModels([])).toEqual([]);
  });
});

describe("local model context window", () => {
  it("tells Claude Code the window Ollama serves, for that session only", () => {
    const result = buildClaudeBackendEnv(
      inherited,
      parseModelBackend("ollama/qwen2.5-coder:0.5b"),
      undefined,
      {
        contextTokens: 32768,
      },
    )!;
    expect(result.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("32768");
    expect(result.settingsEnv.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("32768");
    expect(
      buildClaudeBackendEnv(inherited, parseModelBackend("ollama/qwen2.5-coder:0.5b"))!.env
        .CLAUDE_CODE_MAX_CONTEXT_TOKENS,
    ).toBeUndefined();
  });

  it("uses the documented window for Kimi plan models", () => {
    const result = buildClaudeBackendEnv(
      inherited,
      parseModelBackend("plan/kimi-for-coding/k3.1-pro"),
      PLAN_KEY,
    )!;
    expect(result.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("262144");
  });

  it("loads the model, then reads the serving window from /api/ps", async () => {
    const calls: string[] = [];
    const fetchMock = async (url: string, init?: RequestInit) => {
      calls.push(
        `${init?.method ?? "GET"} ${url} ${typeof init?.body === "string" ? init.body : ""}`.trim(),
      );
      return new Response(
        JSON.stringify(
          url.endsWith("/api/ps")
            ? { models: [{ name: "qwen2.5-coder:0.5b", context_length: 32768 }] }
            : { done_reason: "load" },
        ),
      );
    };
    await expect(ollamaContextWindow("qwen2.5-coder:0.5b", fetchMock)).resolves.toBe(32768);
    expect(calls).toEqual([
      'POST http://127.0.0.1:11434/api/generate {"model":"qwen2.5-coder:0.5b","prompt":""}',
      "GET http://127.0.0.1:11434/api/ps",
    ]);
    await expect(ollamaContextWindow("missing:1b", fetchMock)).resolves.toBeNull();
    await expect(
      ollamaContextWindow("qwen2.5-coder:0.5b", async () => {
        throw new TypeError("fetch failed");
      }),
    ).resolves.toBeNull();
  });
});

const show = async () =>
  new Response(JSON.stringify({ model_info: { "qwen2.context_length": 32768 } }));

describe("describeClaudeBackendError", () => {
  const local = parseModelBackend("ollama/qwen2.5-coder:0.5b");

  it("explains a too-small local window instead of Claude Code's bare error", () => {
    expect(
      describeClaudeBackendError(local, "Prompt is too long", { served: 32768, modelMax: 32768 }),
    ).toBe(
      "qwen2.5-coder:0.5b can hold at most 32k tokens, too small for Claude Code's instructions plus this conversation. Pick a model with a larger window, then start a new chat.",
    );
    expect(
      describeClaudeBackendError(local, "Prompt is too long", { served: 4096, modelMax: 262144 }),
    ).toBe(
      "qwen2.5-coder:0.5b runs with a 4k-token context window in Ollama, too small for Claude Code's instructions plus this conversation. The model supports up to 256k: set the context length in Ollama's settings to 64k or more, then start a new chat.",
    );
    expect(
      describeClaudeBackendError(local, "Prompt is too long", { served: 32768, modelMax: null }),
    ).toContain("runs with a 32k-token context window in Ollama, which is too small");
    expect(describeClaudeBackendError(local, "Prompt is too long")).toContain(
      "qwen2.5-coder:0.5b runs with a context window in Ollama that is too small",
    );
  });

  it("reads the model's trained window from /api/show", async () => {
    await expect(ollamaModelMaxContext("qwen2.5-coder:0.5b", show)).resolves.toBe(32768);
    await expect(
      ollamaModelMaxContext("x", async () => new Response(JSON.stringify({}))),
    ).resolves.toBeNull();
  });

  it("leaves other errors and other backends alone", () => {
    expect(
      describeClaudeBackendError(local, "Connection refused", { served: 32768, modelMax: null }),
    ).toBe("Connection refused");
    expect(
      describeClaudeBackendError(
        parseModelBackend("plan/kimi-for-coding/k3.1-pro"),
        "Prompt is too long",
        { served: 262144, modelMax: 262144 },
      ),
    ).toBe("Prompt is too long");
    expect(
      describeClaudeBackendError(parseModelBackend("claude-sonnet-4-6"), "Prompt is too long"),
    ).toBe("Prompt is too long");
  });
});
