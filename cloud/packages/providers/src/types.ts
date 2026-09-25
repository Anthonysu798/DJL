/**
 * Provider adapter contract. The gateway speaks OpenAI's chat-completions
 * shape to clients; adapters translate to and from each upstream.
 * Nothing here logs or stores prompt content.
 */
export type ProviderId = "openai" | "anthropic" | "openrouter";

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string | readonly ContentPart[] | null;
  readonly name?: string;
  readonly tool_call_id?: string;
  readonly tool_calls?: readonly ToolCall[];
}

export type ContentPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image_url";
      readonly image_url: { readonly url: string; readonly detail?: "auto" | "low" | "high" };
    };

export interface ToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

export interface ToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: Record<string, unknown>;
  };
}

export interface ChatRequest {
  readonly model: string; // upstream model id
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly tool_choice?:
    | "auto"
    | "none"
    | "required"
    | { readonly type: "function"; readonly function: { readonly name: string } };
  readonly max_tokens?: number;
  readonly temperature?: number;
  readonly top_p?: number;
  readonly stop?: readonly string[];
  readonly response_format?: {
    readonly type: "text" | "json_object" | "json_schema";
    readonly json_schema?: Record<string, unknown>;
  };
  readonly user?: string; // opaque org hash for provider abuse attribution
}

/** OpenAI-style streaming chunk, normalized. */
export interface ChatChunk {
  readonly id: string;
  readonly delta: {
    readonly role?: "assistant";
    readonly content?: string;
    readonly tool_calls?: readonly {
      readonly index: number;
      readonly id?: string;
      readonly type?: "function";
      readonly function?: { readonly name?: string; readonly arguments?: string };
    }[];
  };
  readonly finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  readonly usage?: Usage;
}

export interface Usage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cached_input_tokens: number;
}

export interface ImageRequest {
  readonly model: string;
  readonly prompt: string;
  readonly n: number;
  readonly size?: string;
  readonly quality?: string;
  readonly user?: string;
}

export interface ImageResult {
  readonly images: readonly {
    readonly b64_json?: string;
    readonly url?: string;
    readonly revised_prompt?: string;
  }[];
  readonly count: number;
}

export interface EmbeddingRequest {
  readonly model: string;
  readonly input: readonly string[];
  readonly user?: string;
}

export interface EmbeddingResult {
  readonly embeddings: readonly (readonly number[])[];
  readonly usage: { readonly input_tokens: number };
}

export class ProviderError extends Error {
  readonly _tag = "ProviderError";
  constructor(
    readonly provider: ProviderId,
    readonly status: number,
    readonly code: "rate_limited" | "auth" | "bad_request" | "refused" | "unavailable" | "unknown",
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly chatStream: (request: ChatRequest, signal: AbortSignal) => AsyncIterable<ChatChunk>;
  readonly generateImage: (request: ImageRequest, signal: AbortSignal) => Promise<ImageResult>;
  readonly embed: (request: EmbeddingRequest, signal: AbortSignal) => Promise<EmbeddingResult>;
}
