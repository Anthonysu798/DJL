/**
 * Adapter for OpenAI and OpenAI-compatible upstreams (OpenRouter). Streams
 * chat completions, requests images, and embeddings using plain fetch so the
 * exact wire format is visible and the SDK version cannot drift under us.
 */
import { KeyRing } from "./keys.ts";
import { parseSse } from "./sse.ts";
import {
  ProviderError,
  type ChatChunk,
  type ChatRequest,
  type EmbeddingRequest,
  type EmbeddingResult,
  type ImageEditRequest,
  type ImageRequest,
  type ImageResult,
  type ProviderAdapter,
  type ProviderId,
} from "./types.ts";

export interface OpenAiCompatibleOptions {
  readonly id: ProviderId;
  readonly baseUrl: string; // https://api.openai.com/v1 or https://openrouter.ai/api/v1
  readonly keys: KeyRing;
  readonly extraHeaders?: Record<string, string>;
  readonly fetchImpl?: typeof fetch;
  readonly onKeySwitched?: (provider: ProviderId) => void;
}

function classify(status: number): { code: ProviderError["code"]; retryable: boolean } {
  if (status === 401 || status === 403) return { code: "auth", retryable: false };
  if (status === 429) return { code: "rate_limited", retryable: true };
  if (status === 400 || status === 404 || status === 413 || status === 422)
    return { code: "bad_request", retryable: false };
  if (status >= 500) return { code: "unavailable", retryable: true };
  return { code: "unknown", retryable: false };
}

async function imageResult(response: Response): Promise<ImageResult> {
  const json = (await response.json()) as {
    data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
  };
  const images = json.data ?? [];
  return { images, count: images.length };
}

export function createOpenAiCompatibleAdapter(options: OpenAiCompatibleOptions): ProviderAdapter {
  const fetchImpl = options.fetchImpl ?? fetch;

  /** JSON bodies are serialized; a FormData body goes out as multipart with its own boundary. */
  async function request(
    path: string,
    body: unknown,
    signal: AbortSignal,
    stream: boolean,
  ): Promise<Response> {
    const multipart = body instanceof FormData;
    const attempt = async (): Promise<Response> =>
      fetchImpl(`${options.baseUrl}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.keys.current()}`,
          ...(multipart ? {} : { "content-type": "application/json" }),
          ...(stream ? { accept: "text/event-stream" } : {}),
          ...options.extraHeaders,
        },
        body: multipart ? body : JSON.stringify(body),
        signal,
      });
    let response = await attempt();
    if (response.status === 401 && options.keys.markInvalid()) {
      options.onKeySwitched?.(options.id);
      response = await attempt();
    }
    if (!response.ok) {
      const { code, retryable } = classify(response.status);
      const text = (await response.text().catch(() => "")).slice(0, 300);
      throw new ProviderError(
        options.id,
        response.status,
        code,
        `${options.id} ${response.status}: ${text}`,
        retryable,
      );
    }
    return response;
  }

  return {
    id: options.id,
    async *chatStream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk> {
      const response = await request(
        "/chat/completions",
        { ...req, stream: true, stream_options: { include_usage: true } },
        signal,
        true,
      );
      if (!response.body)
        throw new ProviderError(options.id, 502, "unavailable", "empty stream body", true);
      for await (const { data } of parseSse(response.body, signal)) {
        if (data === "[DONE]") return;
        let json: {
          id?: string;
          choices?: { delta?: ChatChunk["delta"]; finish_reason?: ChatChunk["finish_reason"] }[];
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
          } | null;
          error?: { message?: string };
        };
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        if (json.error)
          throw new ProviderError(
            options.id,
            502,
            "unavailable",
            json.error.message ?? "stream error",
            true,
          );
        const choice = json.choices?.[0];
        yield {
          id: json.id ?? "",
          delta: choice?.delta ?? {},
          finish_reason: choice?.finish_reason ?? null,
          ...(json.usage
            ? {
                usage: {
                  input_tokens: json.usage.prompt_tokens ?? 0,
                  output_tokens: json.usage.completion_tokens ?? 0,
                  cached_input_tokens: json.usage.prompt_tokens_details?.cached_tokens ?? 0,
                },
              }
            : {}),
        };
      }
    },
    async generateImage(req: ImageRequest, signal: AbortSignal): Promise<ImageResult> {
      const response = await request(
        "/images/generations",
        {
          model: req.model,
          prompt: req.prompt,
          n: req.n,
          size: req.size,
          quality: req.quality,
          user: req.user,
        },
        signal,
        false,
      );
      return imageResult(response);
    },
    async editImage(req: ImageEditRequest, signal: AbortSignal): Promise<ImageResult> {
      const form = new FormData();
      form.set("model", req.model);
      form.set("prompt", req.prompt);
      form.set("n", String(req.n));
      if (req.size) form.set("size", req.size);
      if (req.user) form.set("user", req.user);
      const extension = req.image.mimeType.split("/")[1] ?? "png";
      form.set(
        "image",
        new Blob([req.image.bytes as BlobPart], { type: req.image.mimeType }),
        `image.${extension}`,
      );
      return imageResult(await request("/images/edits", form, signal, false));
    },
    async embed(req: EmbeddingRequest, signal: AbortSignal): Promise<EmbeddingResult> {
      const response = await request(
        "/embeddings",
        { model: req.model, input: req.input, user: req.user },
        signal,
        false,
      );
      const json = (await response.json()) as {
        data?: { embedding: number[] }[];
        usage?: { prompt_tokens?: number };
      };
      return {
        embeddings: (json.data ?? []).map((d) => d.embedding),
        usage: { input_tokens: json.usage?.prompt_tokens ?? 0 },
      };
    },
  };
}
