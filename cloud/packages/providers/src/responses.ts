import type { ChatChunk } from "./types.ts";

export interface ResponseRequest {
  readonly model: string;
  readonly input: string | readonly Record<string, unknown>[];
  readonly instructions?: string;
  readonly tools?: readonly Record<string, unknown>[];
  readonly max_output_tokens?: number;
  readonly stream?: boolean;
  readonly store?: boolean;
  readonly [key: string]: unknown;
}

const FIELDS = new Set([
  "model",
  "input",
  "instructions",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "max_output_tokens",
  "reasoning",
  "include",
  "text",
  "temperature",
  "top_p",
  "stream",
  "store",
  "prompt_cache_key",
  "client_metadata",
]);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const workspaceTool = (tool: unknown): boolean => {
  if (!object(tool)) return false;
  if (["function", "custom"].includes(String(tool.type))) return true;
  return (
    tool.type === "namespace" &&
    typeof tool.name === "string" &&
    Array.isArray(tool.tools) &&
    tool.tools.length <= 128 &&
    tool.tools.every(
      (child) => object(child) && ["function", "custom"].includes(String(child.type)),
    )
  );
};

/** No stored conversations, arbitrary upstream routing, or provider-hosted billable tools. */
export function validateResponseRequest(value: unknown): ResponseRequest {
  if (
    !object(value) ||
    typeof value.model !== "string" ||
    !value.model.trim() ||
    value.model.length > 256
  )
    throw new Error("A model is required.");
  if (
    !(typeof value.input === "string" || (Array.isArray(value.input) && value.input.every(object)))
  )
    throw new Error("input must be text or a list of response items.");
  if (Object.keys(value).some((key) => !FIELDS.has(key)))
    throw new Error("Unsupported Responses parameter.");
  if (value.stream === false || value.store === true)
    throw new Error("Use stream: true and store: false.");
  if (
    value.max_output_tokens !== undefined &&
    (!Number.isSafeInteger(value.max_output_tokens) || Number(value.max_output_tokens) < 1)
  )
    throw new Error("max_output_tokens must be a positive integer.");
  if (value.instructions !== undefined && typeof value.instructions !== "string")
    throw new Error("instructions must be text.");
  if (
    value.tools !== undefined &&
    (!Array.isArray(value.tools) ||
      value.tools.length > 128 ||
      value.tools.some((tool) => !workspaceTool(tool)))
  )
    throw new Error("Only workspace function and custom tools are supported.");
  const { client_metadata: _clientMetadata, ...request } = value;
  return { ...request, stream: true, store: false } as ResponseRequest;
}

/** Keep every native event; normalized fields are used only for gateway metering. */
export function responseChunk(event: Record<string, unknown>): ChatChunk {
  const response = object(event.response) ? event.response : {};
  const type = String(event.type);
  const delta =
    typeof event.delta === "string" && type.endsWith(".delta") ? event.delta : undefined;
  let usage: ChatChunk["usage"];
  if (object(response.usage)) {
    const raw = response.usage;
    const cached = object(raw.input_tokens_details)
      ? (raw.input_tokens_details.cached_tokens ?? 0)
      : 0;
    const counts = [raw.input_tokens, raw.output_tokens, cached];
    if (
      !counts.every((n) => Number.isSafeInteger(n) && Number(n) >= 0) ||
      Number(cached) > Number(raw.input_tokens)
    )
      throw new Error("Invalid upstream Responses usage.");
    usage = {
      input_tokens: Number(raw.input_tokens) - Number(cached),
      output_tokens: Number(raw.output_tokens),
      cached_input_tokens: Number(cached),
    };
  }
  return {
    id: typeof response.id === "string" ? response.id : "",
    delta: delta === undefined ? {} : { content: delta },
    finish_reason:
      type === "response.completed" ? "stop" : type === "response.incomplete" ? "length" : null,
    ...(usage ? { usage } : {}),
    responseEvent: event,
  };
}
