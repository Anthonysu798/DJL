/**
 * Anthropic Messages API adapter. Translates OpenAI-shaped requests (system
 * message, tools, image parts) to Anthropic's format and streams back
 * OpenAI-shaped chunks so the gateway has one output format.
 */
import { KeyRing } from "./keys.ts";
import { parseSse } from "./sse.ts";
import {
  ProviderError,
  type ChatChunk,
  type ChatMessage,
  type ChatRequest,
  type ContentPart,
  type ProviderAdapter,
} from "./types.ts";

export interface AnthropicOptions {
  readonly keys: KeyRing;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly onKeySwitched?: () => void;
}

type AnthropicContent =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "url"; url: string } | { type: "base64"; media_type: string; data: string };
    }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

function toAnthropicParts(content: ChatMessage["content"]): AnthropicContent[] {
  if (content === null) return [];
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  return content.map((part: ContentPart): AnthropicContent => {
    if (part.type === "text") return { type: "text", text: part.text };
    const url = part.image_url.url;
    const match = /^data:([^;]+);base64,(.+)$/.exec(url);
    return match
      ? { type: "image", source: { type: "base64", media_type: match[1]!, data: match[2]! } }
      : { type: "image", source: { type: "url", url } };
  });
}

export function toAnthropicRequest(req: ChatRequest) {
  const system: string[] = [];
  const messages: { role: "user" | "assistant"; content: AnthropicContent[] }[] = [];
  for (const m of req.messages) {
    if (m.role === "system") {
      system.push(
        typeof m.content === "string"
          ? m.content
          : (m.content ?? []).map((p) => (p.type === "text" ? p.text : "")).join("\n"),
      );
      continue;
    }
    if (m.role === "tool") {
      const part: AnthropicContent = {
        type: "tool_result",
        tool_use_id: m.tool_call_id ?? "",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      };
      const last = messages.at(-1);
      if (last && last.role === "user") last.content.push(part);
      else messages.push({ role: "user", content: [part] });
      continue;
    }
    if (m.role === "assistant") {
      const parts = toAnthropicParts(m.content);
      for (const call of m.tool_calls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(call.function.arguments || "{}");
        } catch {
          input = { _raw: call.function.arguments };
        }
        parts.push({ type: "tool_use", id: call.id, name: call.function.name, input });
      }
      messages.push({ role: "assistant", content: parts });
      continue;
    }
    messages.push({ role: "user", content: toAnthropicParts(m.content) });
  }
  const tools = req.tools?.map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));
  let tool_choice: unknown;
  if (req.tool_choice === "required") tool_choice = { type: "any" };
  else if (req.tool_choice === "none") tool_choice = undefined;
  else if (typeof req.tool_choice === "object")
    tool_choice = { type: "tool", name: req.tool_choice.function.name };
  else if (tools?.length) tool_choice = { type: "auto" };
  return {
    model: req.model,
    max_tokens: req.max_tokens ?? 4096,
    ...(system.length ? { system: system.join("\n\n") } : {}),
    messages,
    ...(tools?.length && req.tool_choice !== "none" ? { tools, tool_choice } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.top_p !== undefined ? { top_p: req.top_p } : {}),
    ...(req.stop?.length ? { stop_sequences: req.stop } : {}),
    ...(req.user ? { metadata: { user_id: req.user } } : {}),
    stream: true,
  };
}

export function createAnthropicAdapter(options: AnthropicOptions): ProviderAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? "https://api.anthropic.com/v1";

  async function post(body: unknown, signal: AbortSignal): Promise<Response> {
    const attempt = () =>
      fetchImpl(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": options.keys.current(),
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        signal,
      });
    let response = await attempt();
    if (response.status === 401 && options.keys.markInvalid()) {
      options.onKeySwitched?.();
      response = await attempt();
    }
    if (!response.ok) {
      const text = (await response.text().catch(() => "")).slice(0, 300);
      const code: ProviderError["code"] =
        response.status === 429
          ? "rate_limited"
          : response.status === 401
            ? "auth"
            : response.status >= 500 || response.status === 529
              ? "unavailable"
              : "bad_request";
      throw new ProviderError(
        "anthropic",
        response.status,
        code,
        `anthropic ${response.status}: ${text}`,
        code === "rate_limited" || code === "unavailable",
      );
    }
    return response;
  }

  return {
    id: "anthropic",
    async *chatStream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
      const response = await post(toAnthropicRequest(req), signal);
      if (!response.body)
        throw new ProviderError("anthropic", 502, "unavailable", "empty stream body", true);
      let id = "";
      let inputTokens = 0;
      let cached = 0;
      let outputTokens = 0;
      const toolIndexByBlock = new Map<number, number>();
      let toolCount = 0;
      for await (const { event, data } of parseSse(response.body, signal)) {
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        switch (event ?? json.type) {
          case "message_start": {
            const message = json.message as {
              id?: string;
              usage?: { input_tokens?: number; cache_read_input_tokens?: number };
            };
            id = message.id ?? "";
            inputTokens = message.usage?.input_tokens ?? 0;
            cached = message.usage?.cache_read_input_tokens ?? 0;
            yield { id, delta: { role: "assistant" }, finish_reason: null };
            break;
          }
          case "content_block_start": {
            const index = json.index as number;
            const block = json.content_block as { type: string; id?: string; name?: string };
            if (block.type === "tool_use") {
              const toolIndex = toolCount++;
              toolIndexByBlock.set(index, toolIndex);
              yield {
                id,
                delta: {
                  tool_calls: [
                    {
                      index: toolIndex,
                      ...(block.id ? { id: block.id } : {}),
                      type: "function",
                      function: { name: block.name ?? "", arguments: "" },
                    },
                  ],
                },
                finish_reason: null,
              };
            }
            break;
          }
          case "content_block_delta": {
            const index = json.index as number;
            const delta = json.delta as { type: string; text?: string; partial_json?: string };
            if (delta.type === "text_delta" && delta.text)
              yield { id, delta: { content: delta.text }, finish_reason: null };
            else if (delta.type === "input_json_delta") {
              const toolIndex = toolIndexByBlock.get(index) ?? 0;
              yield {
                id,
                delta: {
                  tool_calls: [
                    { index: toolIndex, function: { arguments: delta.partial_json ?? "" } },
                  ],
                },
                finish_reason: null,
              };
            }
            break;
          }
          case "message_delta": {
            const delta = json.delta as { stop_reason?: string };
            const usage = json.usage as { output_tokens?: number } | undefined;
            outputTokens = usage?.output_tokens ?? outputTokens;
            const reason = delta.stop_reason;
            yield {
              id,
              delta: {},
              finish_reason:
                reason === "tool_use"
                  ? "tool_calls"
                  : reason === "max_tokens"
                    ? "length"
                    : reason === "refusal"
                      ? "content_filter"
                      : "stop",
              usage: {
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                cached_input_tokens: cached,
              },
            };
            break;
          }
          case "error": {
            const error = json.error as { message?: string; type?: string };
            throw new ProviderError(
              "anthropic",
              502,
              error.type === "overloaded_error" ? "unavailable" : "unknown",
              error.message ?? "stream error",
              error.type === "overloaded_error",
            );
          }
          default:
            break;
        }
      }
    },
    async generateImage() {
      throw new ProviderError(
        "anthropic",
        400,
        "bad_request",
        "Anthropic does not generate images",
        false,
      );
    },
    async editImage() {
      throw new ProviderError(
        "anthropic",
        400,
        "bad_request",
        "Anthropic does not edit images",
        false,
      );
    },
    async embed() {
      throw new ProviderError(
        "anthropic",
        400,
        "bad_request",
        "Anthropic does not provide embeddings",
        false,
      );
    },
  };
}
