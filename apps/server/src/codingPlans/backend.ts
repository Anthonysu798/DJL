// FILE: backend.ts
// Purpose: Route a Claude Code / Codex model slug to its backend (Anthropic, a coding plan, or
// local Ollama) and build the env that backend needs for ONE session. Nothing here touches
// the user's global CLI config files.

import {
  CODING_PLAN_SLUG_PREFIX,
  type CodingPlanDefinition,
  findCodingPlan,
  type LocalInstalledModel,
  type ProviderModelDescriptor,
} from "@djl/contracts";

/** Ollama's default local endpoint (the server DJL's LocalModelManager probes and starts). */
export const OLLAMA_ENDPOINT = "http://127.0.0.1:11434";
/** Slug prefix that routes a Claude Code or Codex turn to a local Ollama model. */
export const OLLAMA_SLUG_PREFIX = "ollama/";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Window Ollama serves a model with, and the most the model itself was trained for. */
export interface OllamaWindow {
  readonly served: number | null;
  readonly modelMax: number | null;
}

const k = (tokens: number) => `${Math.round(tokens / 1024)}k`;

/**
 * Claude Code reports a local window too small for its own instructions as a bare
 * "Prompt is too long". Say which model, how big its window is, and the one change that helps:
 * Ollama's setting when the model can take more, another model when it cannot.
 */
export function describeClaudeBackendError(
  backend: ModelBackend,
  message: string,
  window?: OllamaWindow,
): string {
  if (backend.kind !== "ollama" || !/prompt is too long/i.test(message)) return message;
  const served = window?.served ?? null;
  const modelMax = window?.modelMax ?? null;
  const tooSmall = "too small for Claude Code's instructions plus this conversation.";
  if (served && modelMax && modelMax <= served)
    return `${backend.model} can hold at most ${k(modelMax)} tokens, ${tooSmall} Pick a model with a larger window, then start a new chat.`;
  if (served && modelMax)
    return `${backend.model} runs with a ${k(served)}-token context window in Ollama, ${tooSmall} The model supports up to ${k(modelMax)}: set the context length in Ollama's settings to 64k or more, then start a new chat.`;
  const runs = served
    ? `runs with a ${k(served)}-token context window in Ollama, which is`
    : "runs with a context window in Ollama that is";
  return `${backend.model} ${runs} ${tooSmall} Raise the context length in Ollama's settings or pick a model with a larger window, then start a new chat.`;
}

/** The model's trained window from /api/show (`<arch>.context_length`). Null when unknown. */
export async function ollamaModelMaxContext(
  model: string,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<number | null> {
  try {
    const response = await fetchImpl(`${OLLAMA_ENDPOINT}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(5_000),
    });
    const info = ((await response.json()) as { model_info?: Record<string, unknown> }).model_info;
    const value = Object.entries(info ?? {}).find(([key]) => key.endsWith(".context_length"))?.[1];
    return typeof value === "number" && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Context window Ollama will serve `model` with. Ollama sizes it when it loads the model
 * (server settings and the model's own limit), so load it (an empty prompt only loads it:
 * Ollama 0.40.14 answers `done_reason: "load"`) and read `context_length` from /api/ps. The
 * session is about to load the same model anyway. Null when Ollama does not say.
 */
export async function ollamaContextWindow(
  model: string,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<number | null> {
  try {
    await fetchImpl(`${OLLAMA_ENDPOINT}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: "" }),
      signal: AbortSignal.timeout(120_000),
    });
    const response = await fetchImpl(`${OLLAMA_ENDPOINT}/api/ps`, {
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json()) as {
      models?: ReadonlyArray<{ name?: string; model?: string; context_length?: unknown }>;
    };
    const loaded = body.models?.find((entry) => entry.name === model || entry.model === model);
    return typeof loaded?.context_length === "number" && loaded.context_length > 0
      ? loaded.context_length
      : null;
  } catch {
    return null;
  }
}

/** Picker entries for downloaded Ollama models under Claude Code or Codex. */
export function ollamaPickerModels(
  installed: ReadonlyArray<LocalInstalledModel>,
): ProviderModelDescriptor[] {
  return installed
    .filter((model) => model.runtime === "ollama")
    .map((model): ProviderModelDescriptor => {
      const descriptor = {
        slug: `${OLLAMA_SLUG_PREFIX}${model.modelId}`,
        name: model.name,
        upstreamProviderId: "ollama",
        upstreamProviderName: "Local (Ollama)",
        processingLocality: "local" as const,
      };
      return model.supportsToolCalls === null
        ? descriptor
        : Object.assign(descriptor, { supportsToolCalls: model.supportsToolCalls });
    });
}

export type ModelBackend =
  | { readonly kind: "default"; readonly model: string | undefined }
  | { readonly kind: "plan"; readonly plan: CodingPlanDefinition; readonly model: string }
  | { readonly kind: "ollama"; readonly model: string };

/** Splits on the first segments only: Ollama ids may themselves contain `/` or `:`. */
export function parseModelBackend(slug: string | undefined): ModelBackend {
  if (slug?.startsWith(CODING_PLAN_SLUG_PREFIX)) {
    const rest = slug.slice(CODING_PLAN_SLUG_PREFIX.length);
    const separator = rest.indexOf("/");
    const plan = separator > 0 ? findCodingPlan(rest.slice(0, separator)) : undefined;
    const model = separator > 0 ? rest.slice(separator + 1) : "";
    if (!plan || !model) throw new Error(`Unknown coding plan model: ${slug}`);
    return { kind: "plan", plan, model };
  }
  if (slug?.startsWith(OLLAMA_SLUG_PREFIX)) {
    const model = slug.slice(OLLAMA_SLUG_PREFIX.length);
    if (!model) throw new Error(`Unknown Ollama model: ${slug}`);
    return { kind: "ollama", model };
  }
  return { kind: "default", model: slug };
}

/** Stable identity of a backend; a running session can only switch models inside one. */
export function modelBackendKey(backend: ModelBackend): string {
  switch (backend.kind) {
    case "default":
      return "default";
    case "plan":
      return `plan:${backend.plan.id}`;
    case "ollama":
      return "ollama";
  }
}

export function modelBackendLabel(backend: ModelBackend): string {
  switch (backend.kind) {
    case "default":
      return "the default provider";
    case "plan":
      return backend.plan.name;
    case "ollama":
      return "Local (Ollama)";
  }
}

/** Readable name for a stored backend key (see `modelBackendKey`). */
export function backendKeyLabel(key: string): string {
  if (key === "ollama") return "Local (Ollama)";
  if (key.startsWith("plan:")) return findCodingPlan(key.slice(5))?.name ?? "a coding plan";
  return "the default provider";
}

// Inherited auth/routing that would otherwise send a plan or Ollama session elsewhere.
const ROUTING_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
] as const;

export interface ClaudeBackendEnv {
  /** Full process env for the Claude Code subprocess. */
  readonly env: Record<string, string | undefined>;
  /**
   * Same routing values for the SDK's flag settings, which outrank an `env` block in the
   * user's ~/.claude/settings.json without writing to it. Cleared keys are sent as "".
   */
  readonly settingsEnv: Record<string, string>;
  /** Measured Ollama window, kept to explain a too-long prompt. */
  readonly ollamaWindow?: OllamaWindow;
}

/**
 * Env for a Claude Code session on a non-default backend. Returns `undefined` for the
 * default backend so normal Anthropic sessions keep the inherited env untouched.
 */
export function buildClaudeBackendEnv(
  baseEnv: Readonly<Record<string, string | undefined>>,
  backend: ModelBackend,
  planKey?: string,
  options: {
    /**
     * Window the backend actually serves. Claude Code assumes 1M tokens for model ids it does
     * not recognize; `CLAUDE_CODE_MAX_CONTEXT_TOKENS` corrects that (verified 2026-11-23:
     * https://code.claude.com/docs/en/model-config#correct-the-window-for-a-gateway-or-custom-model-id).
     */
    readonly contextTokens?: number | null;
    readonly ollamaWindow?: OllamaWindow;
  } = {},
): ClaudeBackendEnv | undefined {
  if (backend.kind === "default") return undefined;
  const routing: Record<string, string> = Object.fromEntries(
    ROUTING_ENV_KEYS.map((key) => [key, ""]),
  );
  if (backend.kind === "plan") {
    if (!planKey)
      throw new Error(`${backend.plan.name} is not connected. Add its key in Accounts.`);
    routing.ANTHROPIC_BASE_URL = backend.plan.baseUrl;
    routing[backend.plan.authEnv] = planKey;
    Object.assign(routing, backend.plan.extraEnv);
  } else {
    // Verified 2026-11-22: https://docs.ollama.com/integrations/claude-code
    routing.ANTHROPIC_BASE_URL = OLLAMA_ENDPOINT;
    routing.ANTHROPIC_AUTH_TOKEN = "ollama";
    routing.ANTHROPIC_API_KEY = "";
  }
  routing.ANTHROPIC_MODEL = backend.model;
  if (options.contextTokens && options.contextTokens > 0)
    routing.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(Math.floor(options.contextTokens));
  const env: Record<string, string | undefined> = { ...baseEnv };
  for (const [key, value] of Object.entries(routing)) {
    if (value === "" && key !== "ANTHROPIC_API_KEY") delete env[key];
    else env[key] = value;
  }
  return options.ollamaWindow
    ? { env, settingsEnv: routing, ollamaWindow: options.ollamaWindow }
    : { env, settingsEnv: routing };
}
