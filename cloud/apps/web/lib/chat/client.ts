/**
 * Typed client for the DJL Cloud chat API. Request and response types come
 * from `@synara/contracts/cloud`; paths follow the route comments in those
 * contract modules. `fetch` is injected so the same client runs against the
 * real API, the in-browser mock (NEXT_PUBLIC_DJL_MOCK_API=true), and tests.
 *
 * The web app is signed in with a session cookie, so every mutation carries
 * the double-submit token from GET /v1/csrf in CLOUD_CSRF_HEADER.
 */
import {
  CLOUD_CSRF_HEADER,
  type CloudConversationDetailResponse,
  type CloudConversationListResponse,
  type CloudConversationSearchResponse,
  type CloudCreateConversationInput,
  type CloudCreateConversationResponse,
  type CloudCreateShareInput,
  type CloudCreateShareResponse,
  type CloudCsrfResponse,
  type CloudFile,
  type CloudFileDownloadResponse,
  type CloudFilePresignInput,
  type CloudFilePresignResponse,
  type CloudMeResponse,
  type CloudModelsResponse,
  type CloudPublicShareResponse,
  type CloudRedeemBankResponse,
  type CloudRegenerateInput,
  type CloudRegenerateResponse,
  type CloudRevokeShareResponse,
  type CloudRunEvent,
  type CloudRunEventsResponse,
  type CloudRunResponse,
  type CloudSendMessageInput,
  type CloudSendMessageResponse,
  type CloudShareListResponse,
  type CloudUpdateConversationInput,
  type CloudUpdateConversationResponse,
  type CloudUsageWindowsResponse,
} from "@synara/contracts/cloud";

import { parseSse } from "./sse";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ChatApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly traceId: string | null,
    /** Set with `usage_window_exhausted`. */
    readonly resetsAt: string | null = null,
  ) {
    super(message);
    this.name = "ChatApiError";
  }
}

/** True for failures worth retrying with the same idempotency key: no response, or a 5xx/429 overload. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ChatApiError)
    return error.status >= 500 || error.code === "overloaded" || error.code === "rate_limited";
  return error instanceof TypeError; // fetch's network failure
}

export interface ChatClientOptions {
  readonly baseUrl: string;
  readonly fetch: FetchLike;
}

export type ChatClient = ReturnType<typeof createChatClient>;

const enc = encodeURIComponent;

export function createChatClient({ baseUrl, fetch }: ChatClientOptions) {
  let csrfToken: Promise<string> | null = null;
  const csrf = () =>
    (csrfToken ??= fetch(`${baseUrl}/v1/csrf`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw await toError(res);
        return ((await res.json()) as CloudCsrfResponse).token;
      })
      .catch((error: unknown) => {
        csrfToken = null;
        throw error;
      }));

  async function send(
    method: string,
    path: string,
    body?: unknown,
    init: { signal?: AbortSignal; accept?: string; auth?: boolean } = {},
    retried = false,
  ): Promise<Response> {
    const headers = new Headers({ accept: init.accept ?? "application/json" });
    if (body !== undefined) headers.set("content-type", "application/json");
    if (method !== "GET") headers.set(CLOUD_CSRF_HEADER, await csrf());
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      credentials: init.auth === false ? "omit" : "include",
      body: body === undefined ? null : JSON.stringify(body),
      ...(init.signal ? { signal: init.signal } : {}),
    });
    if (res.ok) return res;
    const error = await toError(res);
    // The token cookie can rotate (a new browser session): fetch a fresh one once.
    if (error.code === "csrf_token" && !retried) {
      csrfToken = null;
      return send(method, path, body, init, true);
    }
    throw error;
  }

  async function json<T>(
    method: string,
    path: string,
    body?: unknown,
    init?: { signal?: AbortSignal; auth?: boolean },
  ): Promise<T> {
    const res = await send(method, path, body, init);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    // Account, models, usage -------------------------------------------------
    getMe: () => json<CloudMeResponse>("GET", "/v1/me"),
    listModels: () => json<CloudModelsResponse>("GET", "/v1/models"),
    getUsage: () => json<CloudUsageWindowsResponse>("GET", "/v1/usage/windows"),
    redeemBank: (idempotencyKey: string) =>
      json<CloudRedeemBankResponse>("POST", "/v1/usage/resets/redeem", { idempotencyKey }),

    // Conversations -----------------------------------------------------------
    listConversations: (opts: { archived?: boolean; cursor?: string } = {}) => {
      const q = new URLSearchParams();
      if (opts.archived !== undefined) q.set("archived", String(opts.archived));
      if (opts.cursor) q.set("cursor", opts.cursor);
      const qs = q.toString();
      return json<CloudConversationListResponse>("GET", `/v1/conversations${qs ? `?${qs}` : ""}`);
    },
    createConversation: (input: CloudCreateConversationInput) =>
      json<CloudCreateConversationResponse>("POST", "/v1/conversations", input),
    updateConversation: (id: string, input: CloudUpdateConversationInput) =>
      json<CloudUpdateConversationResponse>("PATCH", `/v1/conversations/${enc(id)}`, input),
    deleteConversation: (id: string) => json<void>("DELETE", `/v1/conversations/${enc(id)}`),
    getConversation: (id: string, signal?: AbortSignal) =>
      json<CloudConversationDetailResponse>(
        "GET",
        `/v1/conversations/${enc(id)}`,
        undefined,
        signal ? { signal } : {},
      ),
    searchConversations: (q: string, signal?: AbortSignal) =>
      json<CloudConversationSearchResponse>(
        "GET",
        `/v1/conversations/search?q=${enc(q)}`,
        undefined,
        signal ? { signal } : {},
      ),

    // Messages and runs ---------------------------------------------------------
    sendMessage: (conversationId: string, input: CloudSendMessageInput) =>
      json<CloudSendMessageResponse>(
        "POST",
        `/v1/conversations/${enc(conversationId)}/messages`,
        input,
      ),
    /** `messageId` is the assistant reply to redo; the new reply is its sibling. */
    regenerate: (conversationId: string, messageId: string, input: CloudRegenerateInput) =>
      json<CloudRegenerateResponse>(
        "POST",
        `/v1/conversations/${enc(conversationId)}/messages/${enc(messageId)}/regenerate`,
        input,
      ),
    getRun: (runId: string) => json<CloudRunResponse>("GET", `/v1/runs/${enc(runId)}`),
    cancelRun: (runId: string) => json<CloudRunResponse>("POST", `/v1/runs/${enc(runId)}/cancel`),
    listRunEvents: (runId: string, after: number) =>
      json<CloudRunEventsResponse>("GET", `/v1/runs/${enc(runId)}/events?after=${after}`),
    /** Opens the SSE stream of events with seq > `after`. Ends when the server closes it. */
    async *streamRunEvents(
      runId: string,
      after: number,
      signal: AbortSignal,
    ): AsyncGenerator<CloudRunEvent> {
      const res = await send("GET", `/v1/runs/${enc(runId)}/events?after=${after}`, undefined, {
        signal,
        accept: "text/event-stream",
      });
      if (!res.body) return;
      // Heartbeats are SSE comments, which the parser drops.
      for await (const message of parseSse(res.body))
        yield JSON.parse(message.data) as CloudRunEvent;
    },

    // Files -----------------------------------------------------------------------
    presignFile: (input: CloudFilePresignInput) =>
      json<CloudFilePresignResponse>("POST", "/v1/files", input),
    /** PUTs the bytes straight to storage with exactly the headers the presign pinned. */
    async putToStorage(presign: CloudFilePresignResponse, body: Blob, signal?: AbortSignal) {
      const headers = new Headers(presign.upload.headers);
      // Browsers set content-length themselves and refuse to send it by hand.
      headers.delete("content-length");
      const res = await fetch(presign.upload.url, {
        method: presign.upload.method,
        headers,
        body,
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) throw new ChatApiError(res.status, "upload_failed", "Upload failed", null);
    },
    completeFile: (fileId: string) => json<CloudFile>("POST", `/v1/files/${enc(fileId)}/complete`),
    fileUrl: (fileId: string) =>
      json<CloudFileDownloadResponse>("GET", `/v1/files/${enc(fileId)}/url`),

    // Shares ----------------------------------------------------------------------
    createShare: (conversationId: string, input: CloudCreateShareInput) =>
      json<CloudCreateShareResponse>(
        "POST",
        `/v1/conversations/${enc(conversationId)}/shares`,
        input,
      ),
    listShares: () => json<CloudShareListResponse>("GET", "/v1/shares"),
    revokeShare: (shareId: string) =>
      json<CloudRevokeShareResponse>("DELETE", `/v1/shares/${enc(shareId)}`),
    getPublicShare: (token: string) =>
      json<CloudPublicShareResponse>("GET", `/v1/public/shares/${enc(token)}`, undefined, {
        auth: false,
      }),
  };
}

async function toError(res: Response): Promise<ChatApiError> {
  let body: {
    error?: { code?: string; message?: string; traceId?: string; resetsAt?: string };
  } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* not JSON */
  }
  return new ChatApiError(
    res.status,
    body.error?.code ?? "http_error",
    body.error?.message ?? `Request failed (${res.status})`,
    body.error?.traceId ?? null,
    body.error?.resetsAt ?? null,
  );
}

/**
 * Sends a message, retrying transient failures. The same input (and so the
 * same clientMessageId) is resent every time, so the server returns the
 * original message and run instead of creating a duplicate.
 */
export async function sendMessageIdempotent(
  client: Pick<ChatClient, "sendMessage">,
  conversationId: string,
  input: CloudSendMessageInput,
  { attempts = 3, delay = (n: number) => 400 * 2 ** n } = {},
): Promise<CloudSendMessageResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.sendMessage(conversationId, input);
    } catch (error) {
      if (attempt + 1 >= attempts || !isRetryable(error)) throw error;
      await new Promise((r) => setTimeout(r, delay(attempt)));
    }
  }
}
