import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse, stringify } from "smol-toml";
import type { CodexModelOptions } from "@djl/contracts";
import { resolveBaseCodexHomePath } from "../codexHomePaths";
import { ActivityCodexOutput } from "./activityCodexOutput";
import { resolveActivityCodexRuntime } from "./activityCodexRuntime";
import { resolveActivityCodexAuthentication } from "./activityProviderAuthentication";
import { buildActivityCodexEnvironment } from "./activityProviderEnvironment";
import { withActivityProviderProcess } from "./activityProviderProcess";
import {
  readActivityProviderTextFile,
  withActivityProviderWorkspace,
} from "./activityProviderWorkspace";
import { resolveActivityCodexConfig } from "./computerActivityProviderConfig";
import {
  buildComputerActivitySummaryPrompt,
  ComputerActivityGenerationError,
  type ComputerActivitySummaryGenerationInput,
  type ComputerActivitySummaryGenerationResult,
} from "./computerActivitySummarization";

const unavailable = () => new ComputerActivityGenerationError("provider-unavailable");
const failed = () => new ComputerActivityGenerationError("generation-failed");
type Configuration = ReturnType<typeof resolveActivityCodexConfig>;
type Authentication = Awaited<ReturnType<typeof resolveActivityCodexAuthentication>>;
type Workspace = Parameters<Parameters<typeof withActivityProviderWorkspace>[1]>[0];
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
const schemaJson = JSON.stringify(schema);
const preflightContent = {
  title: "Compatibility check",
  description: "Only synthetic compatibility evidence was supplied.",
  applications: ["com.djl.fixture"],
  memory: "No personal evidence was supplied.",
  recording: "No user activity was recorded.",
  citations: ["preflight"],
  suggestion: null,
};
function recipe(workspace: Workspace, model: string, options?: CodexModelOptions): string[] {
  if (
    options?.reasoningEffort !== undefined &&
    !/^[a-z][a-z0-9_-]{0,31}$/.test(options.reasoningEffort)
  )
    throw unavailable();
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-rules",
    "--strict-config",
    "--skip-git-repo-check",
    "-C",
    workspace.work,
    "-m",
    model,
    "-c",
    'approval_policy="never"',
    "-s",
    "read-only",
    "-c",
    'web_search="disabled"',
    ...[
      "shell_tool",
      "apps",
      "plugins",
      "memories",
      "multi_agent",
      "request_permissions_tool",
      "hooks",
      "enable_request_compression",
      "view_image",
      "goals",
      "image_generation",
      "sleep_tool",
      "tool_suggest",
    ].flatMap((name) => ["--disable", name]),
    "-c",
    "tools.experimental_request_user_input={enabled=false}",
    "-c",
    "skills.bundled.enabled=false",
    "-c",
    "skills.include_instructions=false",
    ...(options?.reasoningEffort
      ? ["-c", `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`]
      : []),
    ...(options?.fastMode === true ? ["-c", 'service_tier="fast"'] : []),
    "--output-schema",
    path.join(workspace.root, "schema.json"),
    "-",
  ];
}
function synthetic(configuration: Configuration, authentication: Authentication, endpoint: string) {
  const replacements = new Map<string, string>();
  const replace = (value: string) => {
    if (!replacements.has(value))
      replacements.set(value, `djl-preflight-${randomBytes(16).toString("hex")}`);
    return replacements.get(value)!;
  };
  const config = parse(configuration.configuration);
  const providers = config.model_providers as Record<string, Record<string, unknown>>;
  const transport = providers[configuration.provider]!;
  transport.base_url = endpoint;
  if (transport.http_headers)
    for (const name of Object.keys(transport.http_headers)) {
      const headers = transport.http_headers as Record<string, string>;
      headers[name] = replace(headers[name]!);
    }
  return {
    configuration: {
      ...configuration,
      configuration: stringify(config),
      credentialEnvironment: Object.fromEntries(
        Object.entries(configuration.credentialEnvironment).map(([name, value]) => [
          name,
          replace(value),
        ]),
      ),
    },
    authentication: {
      environment: Object.fromEntries(
        Object.entries(authentication.environment).map(([name, value]) => [name, replace(value)]),
      ),
      ...(authentication.authFile
        ? {
            authFile: JSON.stringify({
              auth_mode: "apikey",
              OPENAI_API_KEY: replace(JSON.parse(authentication.authFile).OPENAI_API_KEY),
            }),
          }
        : {}),
    },
  };
}
function responseEvents(model: string): string {
  const answer = JSON.stringify(preflightContent);
  const message = {
    id: "msg_preflight",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: answer, annotations: [] }],
  };
  const response = {
    id: "resp_preflight",
    object: "response",
    created_at: 1,
    status: "completed",
    model,
    output: [message],
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };
  return [
    { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...message, status: "in_progress", content: [] },
    },
    {
      type: "response.content_part.added",
      item_id: message.id,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    },
    {
      type: "response.output_text.delta",
      item_id: message.id,
      output_index: 0,
      content_index: 0,
      delta: answer,
    },
    {
      type: "response.output_text.done",
      item_id: message.id,
      output_index: 0,
      content_index: 0,
      text: answer,
    },
    {
      type: "response.content_part.done",
      item_id: message.id,
      output_index: 0,
      content_index: 0,
      part: message.content[0],
    },
    { type: "response.output_item.done", output_index: 0, item: message },
    { type: "response.completed", response },
  ]
    .map(
      (event, sequence_number) =>
        `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number })}\n\n`,
    )
    .join("");
}
async function withPreflight<T>(
  input: { model: string; options?: CodexModelOptions; signal: AbortSignal },
  use: (
    endpoint: string,
    signal: AbortSignal,
    expectHeaders: (headers: Record<string, string>) => void,
  ) => Promise<T>,
): Promise<T> {
  const route = `/${randomBytes(24).toString("hex")}/v1`,
    controller = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal]);
  const sockets = new Set<Socket>();
  let problem: ComputerActivityGenerationError | undefined,
    requests = 0,
    admitted = false,
    closing = false;
  let expected: Record<string, string> | undefined;
  const fail = () => {
    problem ??= unavailable();
    controller.abort();
  };
  const inspect = async (request: IncomingMessage) => {
    if (
      ++requests !== 1 ||
      request.rawHeaders.length > 128 ||
      request.method !== "POST" ||
      request.url !== `${route}/responses` ||
      !expected ||
      request.headers["content-encoding"] ||
      request.headers["content-type"] !== "application/json"
    )
      throw unavailable();
    for (const [name, value] of Object.entries(expected))
      if (request.headers[name] !== value) throw unavailable();
    if (!Object.hasOwn(expected, "authorization") && request.headers.authorization !== undefined)
      throw unavailable();
    const buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0;
    for await (const chunk of request) {
      if (
        !Buffer.isBuffer(chunk) ||
        signal.aborted ||
        closing ||
        bytes + chunk.length > buffer.length
      )
        throw unavailable();
      chunk.copy(buffer, bytes);
      bytes += chunk.length;
    }
    if (signal.aborted || closing) throw unavailable();
    const body = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes)),
    );
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      body.model !== input.model ||
      // This exact verified runtime omits its empty tool list on the wire.
      (Object.hasOwn(body, "tools") && (!Array.isArray(body.tools) || body.tools.length !== 0)) ||
      ![undefined, "auto", "none"].includes(body.tool_choice) ||
      body.text?.format?.type !== "json_schema" ||
      body.text.format.strict !== true ||
      !isDeepStrictEqual(body.text.format.schema, schema)
    )
      throw unavailable();
    if (
      input.options?.reasoningEffort !== undefined &&
      body.reasoning?.effort !== input.options.reasoningEffort
    )
      throw unavailable();
    if (
      input.options?.fastMode === true
        ? body.service_tier !== "priority"
        : ![undefined, "auto", "default"].includes(body.service_tier)
    )
      throw unavailable();
    admitted = true;
  };
  const server = createServer({ maxHeaderSize: 16 * 1024 }, (request, response) => {
    void inspect(request)
      .then(() => {
        if (closing || signal.aborted) return;
        response.writeHead(200, { "content-type": "text/event-stream", connection: "close" });
        response.end(responseEvents(input.model));
      })
      .catch(() => {
        fail();
        response.destroy();
      });
  });
  // Node truncates rawHeaders here; retain one extra so inspect can reject overflow.
  server.maxHeadersCount = 65;
  server.on("error", fail);
  server.on("clientError", (_error, socket) => {
    fail();
    socket.destroy();
  });
  server.on("upgrade", (_request, socket) => {
    fail();
    socket.destroy();
  });
  server.on("connect", (_request, socket) => {
    fail();
    socket.destroy();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", fail);
    socket.once("close", () => sockets.delete(socket));
    if (sockets.size > 4 || closing || signal.aborted) {
      fail();
      socket.destroy();
    }
  });
  const abort = () => {
    for (const socket of sockets) socket.destroy();
    server.close();
  };
  signal.addEventListener("abort", abort, { once: true });
  let result: T | undefined, error: unknown;
  try {
    if (signal.aborted) throw failed();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener("abort", stopped);
        server.removeListener("error", onError);
      };
      const stopped = () => {
        cleanup();
        reject(failed());
      };
      const onError = () => {
        cleanup();
        reject(unavailable());
      };
      signal.addEventListener("abort", stopped, { once: true });
      server.once("error", onError);
      server.listen({ port: 0, host: "127.0.0.1", signal }, () => {
        cleanup();
        resolve();
      });
    });
    if (signal.aborted) throw failed();
    const address = server.address();
    if (!address || typeof address === "string") throw unavailable();
    result = await use(`http://127.0.0.1:${address.port}${route}`, signal, (headers) => {
      expected = headers;
    });
    if (!admitted || requests !== 1) throw unavailable();
  } catch (caught) {
    error = caught;
  } finally {
    closing = true;
    signal.removeEventListener("abort", abort);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
  if (problem) throw problem;
  if (error) throw unavailable();
  if (input.signal.aborted) throw failed();
  return result as T;
}

// Internal configured-provider operation. The public service supplies only trusted
// settings; neither worker evidence nor generated text can override this material.
export async function generateActivityCodexSummary(
  input: ComputerActivitySummaryGenerationInput & {
    readonly model: string;
    readonly options?: CodexModelOptions;
    readonly binaryPath?: string;
    readonly homePath?: string;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly timeoutMs?: number;
  },
): Promise<ComputerActivitySummaryGenerationResult> {
  const duration = input.timeoutMs ?? 180_000;
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 180_000) throw unavailable();
  const deadline = performance.now() + duration,
    lifetime = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    lifetime.abort();
  }, duration);
  const signal = AbortSignal.any([input.signal, lifetime.signal]);
  const check = () => {
    if (signal.aborted) throw failed();
    if (performance.now() >= deadline) {
      expired = true;
      throw failed();
    }
  };
  const remaining = () => {
    check();
    return Math.max(1, Math.ceil(deadline - performance.now()));
  };
  try {
    check();
    const home = resolveBaseCodexHomePath(input.environment, input.homePath);
    const source = await readActivityProviderTextFile(
      path.join(home, "config.toml"),
      1024 * 1024,
      signal,
    );
    const configuration = resolveActivityCodexConfig({
      ...(source !== undefined ? { source } : {}),
      environment: input.environment,
      model: input.model,
    });
    // The built-in endpoint redirection is not yet proven for this exact runtime.
    if (configuration.provider === "openai") throw unavailable();
    const authentication = await resolveActivityCodexAuthentication({
      configuration,
      environment: input.environment,
      signal,
      readAuth: () => readActivityProviderTextFile(path.join(home, "auth.json"), 65_536, signal),
    });
    const runtimeInput = {
      ...(input.binaryPath !== undefined ? { binaryPath: input.binaryPath } : {}),
      environment: input.environment,
      signal,
    };
    const runtime = await resolveActivityCodexRuntime(runtimeInput);
    const invoke = async (
      workspace: Workspace,
      material: { configuration: Configuration; authentication: Authentication },
      transportEnvironment: Readonly<Record<string, string | undefined>>,
      invocationSignal: AbortSignal,
      prompt: string,
      inspect?: (configuration: string, environment: Readonly<Record<string, string>>) => void,
    ) => {
      check();
      const invocation = buildActivityCodexEnvironment({
        ...material,
        workspace,
        transportEnvironment,
      });
      await writeFile(path.join(workspace.codexHome, "config.toml"), invocation.configuration, {
        mode: 0o600,
        flag: "wx",
      });
      if (material.authentication.authFile)
        await writeFile(
          path.join(workspace.codexHome, "auth.json"),
          material.authentication.authFile,
          { mode: 0o600, flag: "wx" },
        );
      await writeFile(path.join(workspace.root, "schema.json"), schemaJson, {
        mode: 0o600,
        flag: "wx",
      });
      inspect?.(invocation.configuration, invocation.environment);
      const output = new ActivityCodexOutput();
      check();
      return withActivityProviderProcess(
        {
          executable: runtime.executable,
          args: recipe(workspace, input.model, input.options),
          cwd: workspace.work,
          environment: invocation.environment,
          input: prompt,
          signal: invocationSignal,
          timeoutMs: remaining(),
          onStdout: (chunk) => output.write(chunk),
        },
        async (child) => {
          const exit = await child.exited;
          await child.closed;
          return output.finish(exit, child.stderr());
        },
      );
    };
    await withPreflight(
      { model: input.model, ...(input.options ? { options: input.options } : {}), signal },
      async (endpoint, preflightSignal, expectHeaders) =>
        withActivityProviderWorkspace(preflightSignal, async (workspace) => {
          const material = synthetic(configuration, authentication, endpoint);
          await invoke(
            workspace,
            material,
            {},
            preflightSignal,
            "Return the requested canonical JSON for this synthetic compatibility check. Use no tools. Set suggestion to null.",
            (config, env) => {
              const value = parse(config),
                transport = (
                  value.model_providers as Record<
                    string,
                    {
                      http_headers?: Record<string, string>;
                      env_http_headers?: Record<string, string>;
                      env_key?: string;
                    }
                  >
                )[configuration.provider]!;
              const headers: Record<string, string> = Object.create(null);
              for (const [name, value] of Object.entries(transport.http_headers ?? {}))
                headers[name.toLowerCase()] = value;
              for (const [name, value] of Object.entries(transport.env_http_headers ?? {}))
                headers[name.toLowerCase()] = env[value]!;
              const apiKey = transport.env_key
                ? env[transport.env_key]
                : (env.CODEX_API_KEY ??
                  (material.authentication.authFile
                    ? JSON.parse(material.authentication.authFile).OPENAI_API_KEY
                    : undefined));
              if (apiKey) headers.authorization = `Bearer ${apiKey}`;
              expectHeaders(headers);
            },
          );
        }),
    );
    const content = await withActivityProviderWorkspace(signal, async (workspace) => {
      check();
      const current = await resolveActivityCodexRuntime(runtimeInput);
      if (
        current.executable !== runtime.executable ||
        current.sha256 !== runtime.sha256 ||
        current.recipe !== runtime.recipe
      )
        throw unavailable();
      return invoke(
        workspace,
        { configuration, authentication },
        input.environment,
        signal,
        buildComputerActivitySummaryPrompt(input.evidence) +
          "\nFor the structured output, use suggestion:null when there is no grounded suggestion.",
      );
    });
    check();
    return { content, provider: "codex", model: input.model };
  } catch (error) {
    if (expired) throw new ComputerActivityGenerationError("timeout");
    if (input.signal.aborted) throw failed();
    throw error instanceof ComputerActivityGenerationError ? error : failed();
  } finally {
    clearTimeout(timer);
  }
}
