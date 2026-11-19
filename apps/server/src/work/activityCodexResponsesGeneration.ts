import {
  Agent as HttpAgent,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
} from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import type { Socket } from "node:net";
import path from "node:path";
import { Schema } from "effect";
import { parse } from "smol-toml";
import { ComputerActivitySemanticContent, type CodexModelOptions } from "@synara/contracts";
import { resolveBaseCodexHomePath } from "../codexHomePaths";
import { resolveActivityCodexAuthentication } from "./activityProviderAuthentication";
import { readActivityProviderTextFile } from "./activityProviderWorkspace";
import { resolveActivityCodexConfig } from "./computerActivityProviderConfig";
import {
  buildComputerActivitySummaryPrompt,
  ComputerActivityGenerationError,
  type ComputerActivitySummaryGenerationInput,
  type ComputerActivitySummaryGenerationResult,
} from "./computerActivitySummarization";

const unavailable = () => new ComputerActivityGenerationError("provider-unavailable");
const failed = () => new ComputerActivityGenerationError("generation-failed");
const invalid = () => new ComputerActivityGenerationError("invalid-output");
const MAX_BODY = 1024 * 1024;
const MAX_HEADERS = 16 * 1024;
const line = (maxLength: number) => ({
  type: "string",
  minLength: 1,
  maxLength,
  pattern: "^[^\\r\\n]+$",
});
const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: line(160),
    description: line(2048),
    applications: {
      type: "array",
      maxItems: 100,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 256,
        pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
      },
    },
    memory: { type: "string", minLength: 1, maxLength: 8192 },
    recording: { type: "string", minLength: 1, maxLength: 8192 },
    citations: {
      type: "array",
      minItems: 1,
      maxItems: 512,
      items: { type: "string", minLength: 1, maxLength: 128 },
    },
    suggestion: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ["skill", "automation"] },
            name: line(120),
            description: line(1024),
          },
          required: ["type", "name", "description"],
        },
      ],
    },
  },
  required: [
    "title",
    "description",
    "applications",
    "memory",
    "recording",
    "citations",
    "suggestion",
  ],
};

type Configuration = ReturnType<typeof resolveActivityCodexConfig>;
type Authentication = Awaited<ReturnType<typeof resolveActivityCodexAuthentication>>;
type Transport = {
  base_url?: string;
  env_key?: string;
  http_headers?: Record<string, string>;
  env_http_headers?: Record<string, string>;
  request_max_retries?: number;
  stream_max_retries?: number;
  stream_idle_timeout_ms?: number;
};
function selectedTransport(configuration: Configuration) {
  const root = parse(configuration.configuration);
  const transport = (root.model_providers as Record<string, Transport> | undefined)?.[
    configuration.provider
  ];
  if (
    (transport?.request_max_retries !== undefined && transport.request_max_retries !== 0) ||
    transport?.stream_max_retries !== undefined ||
    transport?.stream_idle_timeout_ms !== undefined
  )
    throw unavailable();
  const base =
    configuration.provider === "openai"
      ? (root.openai_base_url ?? "https://api.openai.com/v1")
      : transport?.base_url;
  if (typeof base !== "string") throw unavailable();
  return { endpoint: new URL(`${base.replace(/\/+$/, "")}/responses`), transport };
}

// This adapter owns only direct HTTP(S). It cannot preserve selected proxies or
// custom certificate behavior, and must not silently send through another route.
function directEnvironment(environment: Readonly<Record<string, string | undefined>>) {
  for (const name of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "NODE_TLS_REJECT_UNAUTHORIZED",
  ]) {
    if (
      Object.hasOwn(environment, name) &&
      environment[name] !== undefined &&
      environment[name] !== ""
    )
      throw unavailable();
  }
}

const forbiddenHeaders = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "upgrade",
  "expect",
  "proxy-authorization",
  "proxy-authenticate",
  "proxy-connection",
]);
function headersFor(
  endpoint: URL,
  transport: Transport | undefined,
  authentication: Authentication,
  bodyBytes: number,
  authenticationMode: Configuration["authentication"],
): Record<string, string> {
  const headers: Record<string, string> = Object.create(null);
  const add = (name: string, value: string) => {
    const key = name.toLowerCase();
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
      !/^[\t\x20-\x7e]*$/.test(value) ||
      (Object.hasOwn(headers, key) && headers[key] !== value)
    )
      throw unavailable();
    headers[key] = value;
  };
  for (const [name, value] of Object.entries(transport?.http_headers ?? {})) {
    if (forbiddenHeaders.has(name.toLowerCase())) throw unavailable();
    add(name, value);
  }
  for (const [name, variable] of Object.entries(transport?.env_http_headers ?? {})) {
    if (forbiddenHeaders.has(name.toLowerCase())) throw unavailable();
    const value = authentication.environment[variable];
    if (value === undefined) throw unavailable();
    add(name, value);
  }
  const key = transport?.env_key
    ? authentication.environment[transport.env_key]
    : authenticationMode === "api"
      ? (authentication.environment.CODEX_API_KEY ??
        (authentication.authFile
          ? (JSON.parse(authentication.authFile) as { OPENAI_API_KEY: string }).OPENAI_API_KEY
          : undefined))
      : undefined;
  if (key !== undefined) add("authorization", `Bearer ${key}`);
  for (const [name, value] of Object.entries(authentication.accountHeaders ?? {})) add(name, value);
  add("content-type", "application/json");
  add("accept", "application/json");
  add("accept-encoding", "identity");
  add("host", endpoint.host);
  add("connection", "close");
  add("content-length", String(bodyBytes));
  const entries = Object.entries(headers);
  if (
    entries.length > 64 ||
    entries.reduce(
      (bytes, [name, value]) => bytes + Buffer.byteLength(`${name}: ${value}\r\n`),
      2,
    ) > MAX_HEADERS
  )
    throw unavailable();
  return headers;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some((name) => !keys.includes(name))) throw invalid();
}
function identifier(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw invalid();
}
function boundedText(value: unknown, limit: number) {
  if (typeof value !== "string" || Buffer.byteLength(value) > limit) throw invalid();
}
function decodeResponse(value: unknown, model: string): ComputerActivitySemanticContent {
  if (
    !object(value) ||
    value.object !== "response" ||
    value.status !== "completed" ||
    (value.error !== undefined && value.error !== null) ||
    (value.refusal !== undefined && value.refusal !== null) ||
    (value.incomplete_details !== undefined && value.incomplete_details !== null) ||
    (value.model !== undefined && value.model !== model) ||
    !Array.isArray(value.output) ||
    value.output.length < 1 ||
    value.output.length > 64
  )
    throw invalid();
  identifier(value.id);
  let answer: string | undefined;
  for (const item of value.output) {
    if (!object(item)) throw invalid();
    identifier(item.id);
    if (item.type === "reasoning") {
      onlyKeys(item, ["id", "type", "summary", "status", "encrypted_content"]);
      if (
        (item.status !== undefined && item.status !== "completed") ||
        !Array.isArray(item.summary) ||
        item.summary.length > 64
      )
        throw invalid();
      for (const part of item.summary) {
        if (!object(part) || part.type !== "summary_text") throw invalid();
        onlyKeys(part, ["type", "text"]);
        boundedText(part.text, 8192);
      }
      if (item.encrypted_content !== undefined && item.encrypted_content !== null)
        boundedText(item.encrypted_content, 65_536);
      continue;
    }
    // There is deliberately no dispatcher, continuation or tool acknowledgement.
    // Every item is checked, including items preceding a valid assistant result.
    if (item.type !== "message" || answer !== undefined) throw invalid();
    onlyKeys(item, ["id", "type", "status", "role", "content"]);
    if (
      item.status !== "completed" ||
      item.role !== "assistant" ||
      !Array.isArray(item.content) ||
      item.content.length !== 1
    )
      throw invalid();
    const part = item.content[0];
    if (!object(part) || part.type !== "output_text" || typeof part.text !== "string")
      throw invalid();
    onlyKeys(part, ["type", "text", "annotations", "logprobs"]);
    for (const name of ["annotations", "logprobs"]) {
      if (part[name] !== undefined && (!Array.isArray(part[name]) || part[name].length !== 0))
        throw invalid();
    }
    answer = part.text;
  }
  if (answer === undefined) throw invalid();
  try {
    const content: unknown = JSON.parse(answer);
    if (object(content) && content.suggestion === null) delete content.suggestion;
    return Schema.decodeUnknownSync(ComputerActivitySemanticContent)(content, {
      onExcessProperty: "error",
    });
  } catch {
    throw invalid();
  }
}

async function requestOnce(
  endpoint: URL,
  body: Buffer,
  headers: Record<string, string>,
  signal: AbortSignal,
  check: () => void,
): Promise<Buffer> {
  const secure = endpoint.protocol === "https:";
  const agent = secure
    ? new HttpsAgent({ keepAlive: false, maxSockets: 1, proxyEnv: {}, rejectUnauthorized: true })
    : new HttpAgent({ keepAlive: false, maxSockets: 1, proxyEnv: {} });
  let request: ClientRequest | undefined, response: IncomingMessage | undefined;
  let socket: Socket | undefined, socketClosed: Promise<void> | undefined;
  try {
    check();
    return await new Promise<Buffer>((resolve, reject) => {
      const stop = () => reject(failed());
      request = (secure ? httpsRequest : httpRequest)(endpoint, {
        method: "POST",
        agent,
        headers,
        signal,
        maxHeaderSize: MAX_HEADERS,
        // Even if the host enables environment proxy support, this request uses
        // the explicitly owned direct agent, not a global agent/pool.
      });
      request.maxHeadersCount = 65; // Preserve an overflow sentinel, never truncate to 64.
      request.on("socket", (owned) => {
        socket = owned;
        socketClosed = new Promise<void>((done) => owned.once("close", () => done()));
      });
      request.on("error", stop);
      request.on("information", () => reject(unavailable()));
      request.on("upgrade", (_response, owned) => {
        owned.destroy();
        reject(unavailable());
      });
      request.on("connect", (_response, owned) => {
        owned.destroy();
        reject(unavailable());
      });
      request.on("response", (received) => {
        response = received;
        try {
          check();
          if (
            received.rawHeaders.length > 128 ||
            received.rawHeaders.reduce((bytes, part) => bytes + Buffer.byteLength(part) + 2, 2) >
              MAX_HEADERS
          )
            throw unavailable();
          if (received.statusCode === 401 || received.statusCode === 403)
            throw new ComputerActivityGenerationError("authentication");
          if (!received.statusCode || received.statusCode < 200 || received.statusCode >= 300)
            throw unavailable();
          const encoding = received.headers["content-encoding"];
          if (encoding !== undefined && encoding !== "identity") throw unavailable();
          if (
            received.headers["content-length"] !== undefined &&
            Number(received.headers["content-length"]) > MAX_BODY
          )
            throw invalid();
        } catch (error) {
          reject(error);
          return;
        }
        const buffer = Buffer.alloc(MAX_BODY);
        let bytes = 0;
        received.on("data", (chunk: Buffer) => {
          try {
            check();
            if (!Buffer.isBuffer(chunk) || bytes + chunk.length > MAX_BODY) throw invalid();
            chunk.copy(buffer, bytes);
            bytes += chunk.length;
          } catch (error) {
            received.pause();
            reject(error);
          }
        });
        received.on("error", stop);
        received.on("aborted", stop);
        received.on("close", () => {
          if (!received.complete) stop();
        });
        received.on("end", () => {
          try {
            check();
            if (received.rawTrailers.length !== 0) throw unavailable();
            resolve(buffer.subarray(0, bytes));
          } catch (error) {
            reject(error);
          }
        });
      });
      request.end(body);
    });
  } finally {
    // Destruction is terminal on every path; await the owned socket's close
    // before returning success or failure. No unread error body is retained.
    response?.on("error", () => {});
    response?.destroy();
    request?.destroy();
    socket?.destroy();
    agent.destroy();
    await socketClosed;
  }
}

// Internal configured-provider callable. Trusted settings select the model and
// transport; evidence is projected into one untrusted text field only.
export async function generateActivityCodexResponsesSummary(
  input: ComputerActivitySummaryGenerationInput & {
    readonly model: string;
    readonly options?: CodexModelOptions;
    readonly homePath?: string;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly timeoutMs?: number;
  },
): Promise<ComputerActivitySummaryGenerationResult> {
  const duration = input.timeoutMs ?? 180_000;
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 180_000) throw unavailable();
  const deadline = performance.now() + duration,
    lifetime = new AbortController();
  const timer = setTimeout(() => lifetime.abort(), duration);
  const signal = AbortSignal.any([input.signal, lifetime.signal]);
  const check = () => {
    if (lifetime.signal.aborted || performance.now() >= deadline)
      throw new ComputerActivityGenerationError("timeout");
    if (input.signal.aborted) throw failed();
  };
  try {
    check();
    directEnvironment(input.environment);
    if (
      input.options !== undefined &&
      (!object(input.options) ||
        Object.keys(input.options).some((key) => !["reasoningEffort", "fastMode"].includes(key)) ||
        (input.options.fastMode !== undefined && typeof input.options.fastMode !== "boolean") ||
        (input.options.reasoningEffort !== undefined &&
          !["none", "minimal", "low", "medium", "high", "xhigh"].includes(
            input.options.reasoningEffort,
          )))
    )
      throw unavailable();
    const home = resolveBaseCodexHomePath(input.environment, input.homePath);
    const source = await readActivityProviderTextFile(
      path.join(home, "config.toml"),
      MAX_BODY,
      signal,
    );
    check();
    const configuration = resolveActivityCodexConfig({
      ...(source !== undefined ? { source } : {}),
      environment: input.environment,
      model: input.model,
    });
    const { endpoint, transport } = selectedTransport(configuration);
    check();
    const authentication = await resolveActivityCodexAuthentication({
      configuration,
      environment: input.environment,
      signal,
      readAuth: () => readActivityProviderTextFile(path.join(home, "auth.json"), 65_536, signal),
    });
    check();
    const body = Buffer.from(
      JSON.stringify({
        model: input.model,
        input:
          buildComputerActivitySummaryPrompt(input.evidence) +
          "\nFor the structured output, use suggestion:null when there is no grounded suggestion.",
        tools: [],
        tool_choice: "none",
        stream: false,
        store: false,
        background: false,
        text: {
          format: { type: "json_schema", name: "computer_activity_summary", strict: true, schema },
        },
        ...(input.options?.reasoningEffort !== undefined
          ? { reasoning: { effort: input.options.reasoningEffort } }
          : {}),
        ...(input.options?.fastMode === true ? { service_tier: "priority" } : {}),
      }),
    );
    if (body.length > MAX_BODY) throw unavailable();
    const headers = headersFor(
      endpoint,
      transport,
      authentication,
      body.length,
      configuration.authentication,
    );
    check();
    const bytes = await requestOnce(endpoint, body, headers, signal, check);
    check();
    let result: ComputerActivitySemanticContent;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      check();
      result = decodeResponse(JSON.parse(text), input.model);
    } catch (error) {
      check();
      throw error instanceof ComputerActivityGenerationError ? error : invalid();
    }
    check();
    return { provider: "codex", model: input.model, content: result };
  } catch (error) {
    check();
    throw error instanceof ComputerActivityGenerationError ? error : failed();
  } finally {
    clearTimeout(timer);
    lifetime.abort();
  }
}
