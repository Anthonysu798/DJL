import { MULTIPOST_TOOLS } from "../../multipost/mcp";
import { computerToolInstructions } from "../../agentGateway/computerGuidance";
import { MARKETING_TOOLS } from "../../marketing/chatTools";
import { COMPUTER_TOOLS } from "../../work/computerTools";
import { BUILT_IN_PLUGINS, pluginServerName } from "@synara/contracts";
import { runMarketingConversation } from "../../marketing/cloudConversation";
/**
 * DJL Cloud native driver: streams OpenAI-compatible chat completions from
 * the DJL Cloud gateway using the stored account session. Text prompts only
 * in this cut; tool execution arrives with the cloud runner.
 */
import type { ProviderListModelsResult, ProviderModelDescriptor } from "@synara/contracts";
import { randomUUID } from "node:crypto";

import { CloudApiError, createCloudClient, type FetchLike } from "../../cloud/api";
import { readCloudSession, type CloudSession } from "../../cloud/session";
import { callPluginGatewayTool, listPluginGatewayTools } from "./pluginGatewayTools";
import type { NativeDriver, NativeDriverFactory, NativeSink } from "./types";

interface CloudModel {
  id: string;
  provider: string;
  displayName: string;
  capabilities: string[];
  contextWindow: number | null;
  maxOutputTokens: number | null;
  status: "active" | "degraded" | "disabled";
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DjlCloudDriverDeps {
  readonly secretsDir: string;
  readonly fetchImpl?: FetchLike;
}

const SYSTEM_PROMPT =
  "You are DJL, a helpful assistant inside the DJL desktop app. Answer directly and concisely.";

export function toModelDescriptor(model: CloudModel): ProviderModelDescriptor {
  return {
    slug: model.id,
    name: model.displayName,
    upstreamProviderId: model.provider,
    supportsToolCalls: model.capabilities.includes("tools"),
    supportsVision: model.capabilities.includes("vision"),
    supportsAttachments: false,
    processingLocality: "remote",
    ...(model.contextWindow ? { contextLimitTokens: model.contextWindow } : {}),
  };
}

async function requireSession(secretsDir: string): Promise<CloudSession> {
  const session = await readCloudSession(secretsDir);
  if (!session) throw new Error("Sign in to DJL Cloud in Settings → Accounts to use cloud models.");
  return session;
}

export const createDjlCloudDriverFactory =
  (deps: DjlCloudDriverDeps): NativeDriverFactory =>
  async (input, sink: NativeSink, workTools, plugins): Promise<NativeDriver> => {
    const session = await requireSession(deps.secretsDir);
    const client = createCloudClient(session.apiBaseUrl, deps.fetchImpl);
    const history: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
    const marketingSystem: Record<string, unknown>[] = [
      {
        role: "system",
        content:
          "Use DJL multipost mcp for new social publishing. Inspect capabilities, accounts and real media before drafting. Prepare a versioned draft and show it for review. Submit only a user-approved revision or one covered by a valid UI-created standing grant. Never grant consent yourself. Report publication only from actual provider evidence; retain uncertain states.",
      },
    ];
    let model = input.modelSelection?.model ?? "claude-sonnet-5";
    let controller: AbortController | null = null;
    let computerToolsActive = false;
    let computerHistory: Record<string, unknown>[] | null = null;
    // Plugin tools act on the user's real accounts, so outside full access each call waits for
    // the user, unless they approved that tool for the rest of this chat.
    const askBeforePluginTools = input.runtimeMode !== "full-access";
    const pluginToolsApprovedForSession = new Set<string>();

    return {
      id: randomUUID(),
      async send(request) {
        const computerRequestHeaders = workTools?.computer?.requestHeaders() ?? {};
        if (request.modelSelection?.model) model = request.modelSelection.model;
        let computerTools = COMPUTER_TOOLS;
        let computerRequest: boolean;
        if (workTools?.computer) {
          const response = await fetch(workTools.url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${workTools.bearerToken}`,
              ...computerRequestHeaders,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "tools/list" }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!response.ok) throw new Error("The local Computer tools are unavailable.");
          const rpc = (await response.json()) as { result?: { tools?: typeof COMPUTER_TOOLS } };
          computerTools = (rpc.result?.tools ?? []).filter(
            (tool) =>
              tool.name.startsWith("computer_") ||
              tool.name === "djl_computer_activity" ||
              tool.name === "djl_computer_history",
          );
          computerRequest = computerTools.length > 0;
        } else {
          computerToolsActive ||= request.input?.includes("djl_computer_status") === true;
          computerRequest = computerToolsActive;
        }
        // Plugin tools only on a turn that @-mentions a plugin, and only that plugin's: every
        // other turn keeps plain streaming and does not pay for tool definitions.
        // Matched by plugin id: a name prefix would also take in another plugin whose id merely
        // starts with this one's. A server that does not say its plugin matches only by exact name.
        const mentioned = new Set(request.djlPluginIds ?? []);
        const pluginServers = (plugins?.servers ?? []).filter((server) =>
          server.pluginId !== undefined
            ? mentioned.has(server.pluginId)
            : [...mentioned].some((id) => server.name === pluginServerName(id)),
        );
        const pluginTools =
          plugins && pluginServers.length > 0
            ? await listPluginGatewayTools(
                { ...plugins, servers: pluginServers },
                AbortSignal.timeout(10_000),
              )
            : [];
        const runPluginTool = async (name: string, args: unknown, signal: AbortSignal) => {
          const tool = pluginTools.find((entry) => entry.name === name)!;
          if (askBeforePluginTools && !pluginToolsApprovedForSession.has(name)) {
            const decision = await sink.request(
              "command_execution_approval",
              { tool: name, input: args },
              signal,
            );
            if (decision === "acceptForSession") pluginToolsApprovedForSession.add(name);
            else if (decision !== "accept")
              throw new Error("The user declined this plugin action. Do not retry it.");
          }
          return callPluginGatewayTool(plugins!, tool, args, signal);
        };
        const isPluginTool = (name: string) => pluginTools.some((entry) => entry.name === name);
        const emitToolResult = (name: string, id: string, result: unknown) =>
          sink.emit({
            type: "item.completed",
            itemId: id,
            payload: {
              itemType: "dynamic_tool_call",
              status:
                result && typeof result === "object" && "error" in result ? "failed" : "completed",
              title: name,
              data: { tool: name, output: result },
            },
          });
        if (workTools && (request.workTurnPolicy?.route === "marketing" || computerRequest)) {
          controller = new AbortController();
          const marketingHistory: Record<string, unknown>[] =
            computerRequest && computerHistory
              ? [...computerHistory, { role: "user", content: request.input! }]
              : [
                  ...(computerRequest
                    ? [
                        {
                          role: "system",
                          content: workTools.computer
                            ? computerToolInstructions()
                            : BUILT_IN_PLUGINS.find(
                                (entry) => entry.plugin.id === "djl-computer-use",
                              )!.instructions,
                        },
                      ]
                    : marketingSystem),
                  ...history
                    .slice(1)
                    .map((message) => ({ role: message.role, content: message.content })),
                  { role: "user", content: request.input! },
                ];
          try {
            const reply = await runMarketingConversation({
              messages: marketingHistory,
              ...(computerRequest
                ? {
                    tools:
                      request.workTurnPolicy?.route === "marketing"
                        ? [...computerTools, ...MARKETING_TOOLS]
                        : computerTools,
                  }
                : {}),
              tools: [
                ...(computerRequest
                  ? request.workTurnPolicy?.route === "marketing"
                    ? [
                        ...computerTools,
                        ...MARKETING_TOOLS,
                        ...(workTools.multipost ? MULTIPOST_TOOLS : []),
                      ]
                    : computerTools
                  : [...MARKETING_TOOLS, ...(workTools.multipost ? MULTIPOST_TOOLS : [])]),
                ...pluginTools,
              ],
              model,
              signal: controller.signal,
              stream: (body, signal) =>
                client.stream("/v1/chat/completions", body, session.token, signal),
              execute: async (name, args) => {
                if (isPluginTool(name)) return runPluginTool(name, args, controller!.signal);
                const endpoint =
                  name.startsWith("djl_multipost_") && workTools.multipost
                    ? workTools.multipost
                    : workTools;
                const response = await fetch(endpoint.url, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${endpoint.bearerToken}`,
                    ...computerRequestHeaders,
                    "Content-Type": "application/json",
                    Accept: "application/json, text/event-stream",
                  },
                  body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: randomUUID(),
                    method: "tools/call",
                    params: { name, arguments: args },
                  }),
                  signal: controller!.signal,
                });
                if (!response.ok) throw new Error("The local marketing tools are unavailable.");
                const rpc = (await response.json()) as {
                  result?: {
                    structuredContent?: unknown;
                    isError?: boolean;
                    content?: { type?: string; text?: string; data?: string; mimeType?: string }[];
                  };
                  error?: unknown;
                };
                if (rpc.error || rpc.result?.isError)
                  throw new Error(rpc.result?.content?.[0]?.text ?? "Campaign preparation failed.");
                const samples = computerRequest
                  ? (rpc.result?.content ?? []).flatMap((item) =>
                      item.type === "image" &&
                      typeof item.data === "string" &&
                      typeof item.mimeType === "string"
                        ? [{ data: item.data, mimeType: item.mimeType }]
                        : [],
                    )
                  : [];
                return samples.length
                  ? {
                      ...(rpc.result?.structuredContent as Record<string, unknown>),
                      computerVisualSamples: samples,
                    }
                  : rpc.result?.structuredContent;
              },
              onTool: emitToolResult,
            });
            if (computerRequest) computerHistory = marketingHistory;
            sink.emit({
              type: "content.delta",
              itemId: `assistant-${randomUUID()}`,
              payload: { streamKind: "assistant_text", delta: reply },
            });
            history.push(
              { role: "user", content: request.input! },
              { role: "assistant", content: reply },
            );
          } finally {
            controller = null;
          }
          return;
        }
        // An ordinary chat with plugins connected runs DJL's tool loop over the plugin tools.
        if (pluginTools.length > 0) {
          const pluginController = new AbortController();
          controller = pluginController;
          try {
            const reply = await runMarketingConversation({
              messages: [
                ...history.map((message) => ({ role: message.role, content: message.content })),
                { role: "user", content: request.input! },
              ],
              tools: pluginTools,
              model,
              signal: pluginController.signal,
              stream: (body, signal) =>
                client.stream("/v1/chat/completions", body, session.token, signal),
              execute: (name, args) => runPluginTool(name, args, pluginController.signal),
              onTool: emitToolResult,
            });
            sink.emit({
              type: "content.delta",
              itemId: `assistant-${randomUUID()}`,
              payload: { streamKind: "assistant_text", delta: reply },
            });
            history.push(
              { role: "user", content: request.input! },
              { role: "assistant", content: reply },
            );
          } catch (error) {
            if (!pluginController.signal.aborted) throw error;
            sink.emit({ type: "turn.completed", payload: { state: "interrupted" } });
          } finally {
            if (controller === pluginController) controller = null;
          }
          return;
        }
        history.push({ role: "user", content: request.input! });
        const requestController = new AbortController();
        controller = requestController;
        let releaseReader: (() => void) | undefined;
        let reachedEof = false;
        const itemId = `assistant-${randomUUID()}`;
        let reply = "";
        let cutOff = false;
        let errorMessage: string | null = null;
        try {
          const response = await client.stream(
            "/v1/chat/completions",
            { model, messages: history, stream: true, max_tokens: 4096 },
            session.token,
            requestController.signal,
          );
          if (!response.body) throw new Error("DJL Cloud returned an empty stream.");
          const reader = response.body.getReader();
          releaseReader = () => reader.releaseLock();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              reachedEof = true;
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            let index: number;
            while ((index = buffer.indexOf("\n\n")) >= 0) {
              const block = buffer.slice(0, index);
              buffer = buffer.slice(index + 2);
              const event = block.match(/^event: (.+)$/m)?.[1] ?? null;
              const data = block.match(/^data: (.+)$/m)?.[1] ?? "";
              if (!data || data === "[DONE]") continue;
              if (event === "error") {
                const parsed = JSON.parse(data) as { error?: { code?: string; message?: string } };
                if (parsed.error?.code === "insufficient_credits") cutOff = true;
                else errorMessage = parsed.error?.message ?? "DJL Cloud returned an error.";
                continue;
              }
              if (event === "djl.usage") {
                const usage = JSON.parse(data) as {
                  settled: string;
                  remaining: string;
                  cutOff: boolean;
                };
                sink.emit({
                  type: "item.completed",
                  itemId: `usage-${itemId}`,
                  payload: {
                    itemType: "dynamic_tool_call",
                    status: "completed",
                    title: "DJL Cloud usage",
                    data: usage,
                  },
                });
                continue;
              }
              const chunk = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) {
                reply += delta;
                sink.emit({
                  type: "content.delta",
                  itemId,
                  payload: { streamKind: "assistant_text", delta },
                });
              }
            }
          }
        } catch (error) {
          if (requestController.signal.aborted) {
            sink.emit({ type: "turn.completed", payload: { state: "interrupted" } });
            if (reply) history.push({ role: "assistant", content: reply });
            return;
          }
          if (error instanceof CloudApiError) {
            const code = error.detail.code;
            if (code === "insufficient_credits")
              throw new Error(
                "You are out of DJL Cloud credits. Add credits in Settings → Accounts.",
              );
            if (error.detail.status === 401)
              throw new Error(
                "Your DJL Cloud session expired. Sign in again in Settings → Accounts.",
              );
            if (code === "gateway_paused")
              throw new Error("DJL Cloud is temporarily paused. Try again shortly.");
            throw new Error(error.detail.message);
          }
          throw error;
        } finally {
          if (!reachedEof) requestController.abort();
          releaseReader?.();
          if (controller === requestController) controller = null;
        }
        if (reply) history.push({ role: "assistant", content: reply });
        if (cutOff)
          throw new Error("DJL Cloud credits ran out during this reply. Add credits to continue.");
        if (errorMessage) throw new Error(errorMessage);
      },
      async interrupt() {
        controller?.abort();
      },
      close() {
        controller?.abort();
      },
      async models(): Promise<ProviderListModelsResult> {
        const result = await client.get<{ models: CloudModel[] }>("/v1/models", session.token);
        return {
          models: result.models
            .filter((m) => m.status !== "disabled" && m.capabilities.includes("text.chat"))
            .map(toModelDescriptor),
          source: "djl-cloud",
        };
      },
    };
  };

/** Model listing without an active session, used by discovery when signed in. */
export async function listDjlCloudModels(
  deps: DjlCloudDriverDeps,
): Promise<ProviderListModelsResult> {
  const session = await requireSession(deps.secretsDir);
  const client = createCloudClient(session.apiBaseUrl, deps.fetchImpl);
  const result = await client.get<{ models: CloudModel[] }>("/v1/models", session.token);
  return {
    models: result.models.filter((m) => m.status !== "disabled").map(toModelDescriptor),
    source: "djl-cloud",
  };
}
