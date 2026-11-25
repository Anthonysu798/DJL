import { randomUUID } from "node:crypto";
import { withDjlThreadId } from "./driverEnv";
import { NativeRpc, object, string, type JsonObject } from "./protocol";
import type { NativeDriverFactory } from "./types";
import type { PluginGatewaySession } from "../../plugins/PluginGateway";
import type { ProviderSendTurnInput, ProviderSessionStartInput } from "@djl/contracts";
import { nonNegativeInteger, positiveInteger } from "../../provider/tokenUsage";
import { selectAcpFullAccessPermissionOptionId } from "../../provider/acp/AcpAdapterSupport";

function acpPermissionOptions(params: JsonObject) {
  const kinds = ["allow_once", "allow_always", "reject_once", "reject_always"] as const;
  return (Array.isArray(params.options) ? params.options : []).flatMap((entry) => {
    const option = object(entry);
    const kind = kinds.find((candidate) => candidate === option.kind);
    return kind && typeof option.optionId === "string" ? [{ kind, optionId: option.optionId }] : [];
  });
}

export function readAcpModels(session: JsonObject): Array<{ slug: string; name: string }> {
  const legacy = object(session.models ?? {}).availableModels;
  if (Array.isArray(legacy))
    return legacy.map((entry) => {
      const model = object(entry);
      return { slug: string(model.modelId), name: string(model.name ?? model.modelId) };
    });
  // iFlow advertises its catalog under `_meta.models` with `id` fields.
  const meta = object(object(session._meta ?? {}).models ?? {}).availableModels;
  if (Array.isArray(meta))
    return meta.map((entry) => {
      const model = object(entry);
      return { slug: string(model.id), name: string(model.name ?? model.id) };
    });
  const controls = Array.isArray(session.configOptions) ? session.configOptions.map(object) : [];
  const model = controls.find((control) => control.category === "model" || control.id === "model");
  if (!Array.isArray(model?.options)) throw new Error("ACP runtime did not advertise models");
  const choices = model.options.flatMap((entry) => {
    const option = object(entry);
    return Array.isArray(option.options) ? option.options.map(object) : [option];
  });
  return choices.map((choice) => ({
    slug: string(choice.value),
    name: string(choice.name ?? choice.value),
  }));
}

/**
 * The user's plugins as ACP tool servers. An agent only gets them when it says it can reach a
 * tool server over HTTP; otherwise it starts without plugins rather than failing.
 */
export function acpPluginServers(init: JsonObject, plugins: PluginGatewaySession | undefined) {
  if (!plugins) return [];
  const capabilities = object(object(init.agentCapabilities ?? {}).mcpCapabilities ?? {});
  if (capabilities.http !== true) return [];
  return plugins.servers.map((server) => ({
    type: "http",
    name: server.name,
    url: server.url,
    headers: [{ name: "Authorization", value: `Bearer ${plugins.bearerToken}` }],
  }));
}

// Fresh ACP event/permission bridge shared by official subscription runtimes.
export function createNativeAcpDriver(config: {
  label: string;
  source: string;
  command: (input: ProviderSessionStartInput) => {
    command: string;
    args: readonly string[];
    env?: NodeJS.ProcessEnv;
  };
  authenticate?: (rpc: NativeRpc, init: JsonObject) => Promise<void>;
  modelFilter?: (modelId: string) => boolean;
  /** A DJL-side slug meaning "keep the runtime's own default model"; never sent to the CLI. */
  defaultModelSlug?: string;
  /** Maps a DJL model slug to the exact value the runtime advertises; undefined keeps its own. */
  resolveModelId?: (session: JsonObject, model: string) => string | undefined;
  modeId: (session: JsonObject, turn: ProviderSendTurnInput) => string | undefined;
}): NativeDriverFactory {
  return async (input, sink, _workTools, plugins) => {
    if (input.approvalPolicy)
      throw new Error(
        `${config.label} ACP does not expose the requested Codex approval policy; use native permission prompts`,
      );
    if (input.sandboxMode && input.sandboxMode !== "danger-full-access")
      throw new Error(
        `${config.label} ACP cannot enforce an OS sandbox; use Codex for sandboxed execution`,
      );
    const command = config.command(input);
    const rpc = new NativeRpc(
      command.command,
      [...command.args],
      input.cwd!,
      withDjlThreadId(command.env ?? process.env, input.threadId),
    );
    let id = "";
    let replaying = true;
    let assistantMessageId = randomUUID();
    let assistantOpen = false;
    rpc.onClose = sink.fail;
    rpc.onMessage = (method, params, requestId) => {
      if (requestId !== undefined) {
        if (method !== "session/request_permission" || params.sessionId !== id || replaying) {
          rpc.reject(requestId);
          return;
        }
        // Full access means the user already approved every tool call for this chat.
        if (input.runtimeMode === "full-access") {
          const optionId = selectAcpFullAccessPermissionOptionId(acpPermissionOptions(params));
          if (optionId) {
            rpc.respond(requestId, { outcome: { outcome: "selected", optionId } });
            return;
          }
        }
        const tool = object(params.toolCall ?? {});
        const requestType =
          tool.kind === "edit"
            ? "file_change_approval"
            : tool.kind === "read"
              ? "file_read_approval"
              : "command_execution_approval";
        void sink
          .request(requestType, params)
          .then((decision) => {
            const options = Array.isArray(params.options) ? params.options.map(object) : [];
            const kind =
              decision === "accept" || decision === "acceptForSession"
                ? "allow_once"
                : "reject_once";
            const selected = options.find((option) => option.kind === kind);
            rpc.respond(requestId, {
              outcome: selected
                ? { outcome: "selected", optionId: string(selected.optionId) }
                : { outcome: "cancelled" },
            });
          })
          .catch(() => {
            try {
              rpc.respond(requestId, { outcome: { outcome: "cancelled" } });
            } catch {}
          });
        return;
      }
      if (method !== "session/update" || params.sessionId !== id) return;
      const update = object(params.update);
      if (update.sessionUpdate === "usage_update") {
        const usedTokens = nonNegativeInteger(update.used);
        const maxTokens = positiveInteger(update.size);
        if (usedTokens !== undefined)
          sink.emit({
            type: "thread.token-usage.updated",
            payload: {
              usage: {
                usedTokens,
                ...(maxTokens !== undefined ? { maxTokens } : {}),
                compactsAutomatically: true,
              },
            },
          });
      }
      if (replaying) return;
      if (
        update.sessionUpdate === "agent_message_chunk" ||
        update.sessionUpdate === "agent_thought_chunk"
      ) {
        const content = object(update.content);
        if (!assistantOpen) {
          assistantMessageId = randomUUID();
          assistantOpen = true;
        }
        if (content.type === "text" && typeof content.text === "string")
          sink.emit({
            type: "content.delta",
            itemId: `${update.sessionUpdate === "agent_message_chunk" ? "assistant" : "reasoning"}-${assistantMessageId}`,
            payload: {
              streamKind:
                update.sessionUpdate === "agent_message_chunk"
                  ? "assistant_text"
                  : "reasoning_text",
              delta: content.text,
            },
          });
      }
      if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
        assistantOpen = false;
        const done = update.status === "completed" || update.status === "failed";
        sink.emit({
          type: done ? "item.completed" : "item.started",
          itemId: string(update.toolCallId),
          payload: {
            itemType: "dynamic_tool_call",
            status: done ? update.status : "inProgress",
            ...(typeof update.title === "string" && update.title ? { title: update.title } : {}),
            data: update,
          },
        });
      }
    };
    try {
      const init = object(
        await rpc.request("initialize", {
          protocolVersion: 1,
          clientInfo: { name: "djl_native", version: "1.0.0" },
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
        }),
      );
      if (init.protocolVersion !== 1)
        throw new Error(`Unsupported ${config.label} ACP protocol version`);
      await config.authenticate?.(rpc, init);
      // ACP uses the existing CLI login. Only the explicit Sign in action may open a browser.
      const resume =
        input.resumeCursor === undefined
          ? undefined
          : string(object(input.resumeCursor).nativeSessionId);
      if (resume && object(init.agentCapabilities ?? {}).loadSession !== true)
        throw new Error(`${config.label} runtime does not support session resume`);
      id = resume ?? "";
      const session = object(
        await rpc.request(resume ? "session/load" : "session/new", {
          ...(resume ? { sessionId: resume } : {}),
          cwd: input.cwd,
          mcpServers: acpPluginServers(init, plugins),
        }),
      );
      id = resume ?? string(session.sessionId);
      const resolveModel = (requestedModel?: string) => {
        const requested = requestedModel === config.defaultModelSlug ? undefined : requestedModel;
        if (!config.modelFilter) return requested;
        if (requested && !config.modelFilter(requested))
          throw new Error(`${config.label} requires a subscription model`);
        const selected =
          requested ??
          readAcpModels(session).find((model) => config.modelFilter!(model.slug))?.slug;
        if (!selected)
          throw new Error(`Sign in to ${config.label}; no subscription models are available`);
        return selected;
      };
      const setModel = async (model: string | undefined) => {
        const modelId =
          model && config.resolveModelId ? config.resolveModelId(session, model) : model;
        if (modelId) await rpc.request("session/set_model", { sessionId: id, modelId });
      };
      let initialModel = resolveModel(input.modelSelection?.model);
      await setModel(initialModel);
      replaying = false;
      return {
        id,
        async send(turn) {
          assistantOpen = false;
          const modelId = resolveModel(turn.modelSelection?.model ?? initialModel);
          await setModel(modelId);
          initialModel = modelId;
          const modeId = config.modeId(session, turn);
          if (modeId) await rpc.request("session/set_mode", { sessionId: id, modeId });
          const result = object(
            await rpc.request(
              "session/prompt",
              { sessionId: id, prompt: [{ type: "text", text: turn.input! }] },
              30 * 60_000,
            ),
          );
          if (result.stopReason === "cancelled")
            sink.emit({ type: "turn.completed", payload: { state: "interrupted" } });
          else if (
            result.stopReason !== "end_turn" &&
            result.stopReason !== "max_tokens" &&
            result.stopReason !== "max_turn_requests"
          )
            throw new Error(`${config.label} turn stopped: ${String(result.stopReason)}`);
        },
        async interrupt() {
          rpc.notify("session/cancel", { sessionId: id });
        },
        close: () => rpc.close(),
        async models() {
          return {
            models: readAcpModels(session).filter(
              (model) => !config.modelFilter || config.modelFilter(model.slug),
            ),
            source: config.source,
          };
        },
      };
    } catch (error) {
      rpc.close();
      throw error;
    }
  };
}
