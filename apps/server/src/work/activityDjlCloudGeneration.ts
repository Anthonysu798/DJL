import { Schema } from "effect";
import { ComputerActivitySemanticContent } from "@djl/contracts";
import { CloudUsageTrailer } from "@djl/contracts/cloud";
import { cloudSessionPath } from "../cloud/session";
import { readActivityProviderTextFile } from "./activityProviderWorkspace";
import {
  buildComputerActivitySummaryPrompt,
  ComputerActivityGenerationError,
  type ComputerActivitySummaryGenerationInput,
  type ComputerActivitySummaryGenerationResult,
} from "./computerActivitySummarization";

const MAX_REQUEST_BYTES = 1024 * 1024;
// Token-by-token SSE repeats metadata, including reasoning fields, on each chunk.
// Bound its wire budget separately from the evidence sent to the provider.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_FRAME = 256 * 1024;
const problem = (code: ConstructorParameters<typeof ComputerActivityGenerationError>[0]) =>
  new ComputerActivityGenerationError(code);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw problem("invalid-output");
}

function summaryFromSse(text: string, model: string) {
  let answer = "",
    id: string | undefined,
    finished = false,
    gatewayTerminal = false,
    done = false,
    usage = false;
  const frames = text.replace(/\r\n/g, "\n").split("\n\n");
  if (frames.pop()?.trim()) throw problem("invalid-output");
  for (const frame of frames) {
    if (Buffer.byteLength(frame) > MAX_FRAME) throw problem("invalid-output");
    let event = "message";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const name = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (name === "event") event = value;
      else if (name === "data") data.push(value);
      else throw problem("invalid-output");
    }
    if (!data.length) continue;
    if (done) throw problem("invalid-output");
    const payload = data.join("\n");
    if (payload === "[DONE]") {
      if (event !== "message" || !finished || !usage) throw problem("invalid-output");
      done = true;
      continue;
    }
    const value: unknown = JSON.parse(payload);
    if (event === "djl.usage") {
      if (!finished || usage) throw problem("invalid-output");
      const trailer = Schema.decodeUnknownSync(CloudUsageTrailer)(value, {
        onExcessProperty: "error",
      });
      if (
        trailer.requestId !== id ||
        trailer.model !== model ||
        trailer.cutOff ||
        trailer.inputTokens < 0 ||
        trailer.outputTokens < 0
      )
        throw problem("invalid-output");
      usage = true;
      continue;
    }
    if (event !== "message" || usage || !object(value)) throw problem("invalid-output");
    keys(value, ["id", "object", "created", "model", "choices"]);
    if (
      typeof value.id !== "string" ||
      !value.id ||
      value.id.length > 256 ||
      (id !== undefined && id !== value.id) ||
      value.object !== "chat.completion.chunk" ||
      value.model !== model ||
      !Number.isSafeInteger(value.created) ||
      (value.created as number) < 0 ||
      !Array.isArray(value.choices) ||
      value.choices.length !== 1
    )
      throw problem("invalid-output");
    id = value.id;
    const choice: unknown = value.choices[0];
    if (!object(choice)) throw problem("invalid-output");
    keys(choice, ["index", "delta", "finish_reason"]);
    if (
      choice.index !== 0 ||
      !object(choice.delta) ||
      (choice.finish_reason !== null && choice.finish_reason !== "stop")
    )
      throw problem("invalid-output");
    const delta = choice.delta;
    keys(delta, ["role", "content", "tool_calls", "reasoning", "reasoning_details"]);
    if (
      (delta.role != null && delta.role !== "assistant") ||
      (delta.content != null && typeof delta.content !== "string") ||
      (delta.tool_calls != null &&
        (!Array.isArray(delta.tool_calls) || delta.tool_calls.length !== 0)) ||
      (delta.reasoning != null && typeof delta.reasoning !== "string") ||
      (delta.reasoning_details != null &&
        (!Array.isArray(delta.reasoning_details) || !delta.reasoning_details.every(object)))
    )
      throw problem("invalid-output");
    if (finished) {
      if (
        gatewayTerminal ||
        choice.finish_reason !== "stop" ||
        (delta.content != null && delta.content !== "") ||
        (delta.reasoning != null && delta.reasoning !== "") ||
        (Array.isArray(delta.reasoning_details) && delta.reasoning_details.length !== 0)
      )
        throw problem("invalid-output");
      gatewayTerminal = true;
      continue;
    }
    // Reasoning metadata is bounded by the same frame/body limits and ignored.
    // Only final content is decoded, returned, or persisted; no continuation runs.
    if (typeof delta.content === "string") answer += delta.content;
    if (choice.finish_reason === "stop") finished = true;
  }
  if (!done || !finished || !usage || !answer) throw problem("invalid-output");
  const content: unknown = JSON.parse(answer);
  if (!object(content)) throw problem("invalid-output");
  if (content.suggestion === null) delete content.suggestion;
  return Schema.decodeUnknownSync(ComputerActivitySemanticContent)(content, {
    onExcessProperty: "error",
  });
}

// A single cloud inference request. No provider harness, tool executor or continuation.
export async function generateActivityDjlCloudSummary(
  input: ComputerActivitySummaryGenerationInput & {
    readonly model: string;
    readonly secretsDir: string;
    readonly timeoutMs?: number;
  },
): Promise<ComputerActivitySummaryGenerationResult> {
  const duration = input.timeoutMs ?? 180_000;
  if (
    !Number.isSafeInteger(duration) ||
    duration < 1 ||
    duration > 180_000 ||
    !input.model.trim() ||
    input.model.trim() !== input.model ||
    input.model.length > 256 ||
    /[\r\n]/.test(input.model)
  )
    throw problem("provider-unavailable");
  const lifetime = new AbortController(),
    deadline = performance.now() + duration;
  const timer = setTimeout(() => lifetime.abort(), duration);
  const signal = AbortSignal.any([input.signal, lifetime.signal]);
  const check = () => {
    if (lifetime.signal.aborted || performance.now() >= deadline) throw problem("timeout");
    if (input.signal.aborted) throw problem("generation-failed");
  };
  let cancelReader: (() => Promise<void>) | undefined;
  let response: Response | undefined;
  try {
    check();
    const source = await readActivityProviderTextFile(
      cloudSessionPath(input.secretsDir),
      65_536,
      signal,
    );
    check();
    let account: unknown;
    try {
      account = source === undefined ? undefined : JSON.parse(source);
    } catch {
      throw problem("provider-unavailable");
    }
    if (
      !object(account) ||
      ["apiBaseUrl", "token", "userId", "email", "orgId"].some(
        (key) => typeof account[key] !== "string" || !account[key],
      ) ||
      !/^[!-~]{1,8192}$/.test(account.token as string)
    )
      throw problem("provider-unavailable");
    let endpoint: URL;
    try {
      endpoint = new URL(account.apiBaseUrl as string);
      if (
        (endpoint.protocol !== "https:" &&
          !(endpoint.protocol === "http:" && endpoint.hostname === "127.0.0.1")) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search ||
        endpoint.hash
      )
        throw new Error();
      if (endpoint.href.replace(/\/+$/, "") !== (account.apiBaseUrl as string).replace(/\/+$/, ""))
        throw new Error();
      endpoint.pathname = endpoint.pathname.replace(/\/+$/, "") + "/v1/chat/completions";
    } catch {
      throw problem("provider-unavailable");
    }
    const body = JSON.stringify({
      model: input.model,
      messages: [
        {
          role: "user",
          content:
            buildComputerActivitySummaryPrompt(input.evidence) +
            "\nCitations must come only from the top-level sourceIds array in the supplied evidence. For six-hour input, cite the ten-minute child summary IDs in that array; never copy the children's nested content.citations or sourceIds. Interval boundaries do not prove continuous app activity, a session start, or a session end." +
            '\nReturn one JSON object, without markdown or code fences, using this shape: {"title":"short title","description":"observed facts","applications":["application ID from the supplied evidence"],"memory":"supported facts","recording":"observed activity","citations":["source ID from the supplied evidence"],"suggestion":null}. Replace the example strings with grounded values. applications and citations must be arrays of strings, never objects. Do not add fields. All text fields must be nonempty; title is at most 160 characters, description 2048, memory and recording 8192 each. Use suggestion:null unless a grounded suggestion meets the instructions above.',
        },
      ],
      stream: true,
      store: false,
      tools: [],
      tool_choice: "none",
      max_tokens: 8192,
      // This OpenRouter model can otherwise consume the entire budget before final JSON.
      ...(input.model === "nemotron-3.5-lightning-free" ? { reasoning: { enabled: false } } : {}),
      response_format: { type: "json_object" },
    });
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw problem("provider-unavailable");
    check();
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${account.token}`,
        "content-type": "application/json",
        accept: "text/event-stream",
        "accept-encoding": "identity",
        "x-djl-client": "desktop",
        connection: "close",
      },
      body,
      signal,
      redirect: "error",
    });
    check();
    if (response.status === 401 || response.status === 403) throw problem("authentication");
    if (!response.ok) throw problem("provider-unavailable");
    if (
      !response.body ||
      response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "text/event-stream"
    )
      throw problem("invalid-output");
    if (Number(response.headers.get("content-length") ?? 0) > MAX_RESPONSE_BYTES)
      throw problem("invalid-output");
    const reader = response.body.getReader();
    cancelReader = () => reader.cancel().catch(() => undefined);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "",
      total = 0;
    while (true) {
      const chunk = await reader.read();
      check();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw problem("invalid-output");
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    check();
    const content = summaryFromSse(text, input.model);
    check();
    return { provider: "djlCloud", model: input.model, content };
  } catch (error) {
    check();
    if (error instanceof ComputerActivityGenerationError) throw error;
    if (error instanceof SyntaxError || (error instanceof TypeError && response?.ok))
      throw problem("invalid-output");
    // Schema errors and malformed streams carry no provider text to the UI.
    throw problem(response?.ok ? "invalid-output" : "generation-failed");
  } finally {
    clearTimeout(timer);
    lifetime.abort();
    if (cancelReader) await cancelReader();
    else await response?.body?.cancel().catch(() => undefined);
  }
}
