import { randomUUID } from "node:crypto";
import { buildCursorAgentCommand } from "../../provider/acp/CursorAcpCommand";
import { NativeRpc, object, string } from "./protocol";
import type { NativeDriverFactory } from "./types";
import { nonNegativeInteger, positiveInteger } from "../../provider/tokenUsage";

// https://cursor.com/docs/cli/acp — ACP v1, provider-owned login.
export const createCursorDriver: NativeDriverFactory = async (input, sink) => {
  if (input.approvalPolicy)
    throw new Error(
      "Cursor ACP does not expose the requested Codex approval policy; use native permission prompts",
    );
  if (input.sandboxMode && input.sandboxMode !== "danger-full-access")
    throw new Error("Cursor ACP cannot enforce an OS sandbox; use Codex for sandboxed execution");
  const options = input.providerOptions?.cursor;
  const command = buildCursorAgentCommand(options?.binaryPath, [
    ...(options?.apiEndpoint ? ["-e", options.apiEndpoint] : []),
    "acp",
  ]);
  const rpc = new NativeRpc(command.command, [...command.args], input.cwd!);
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
            decision === "accept" || decision === "acceptForSession" ? "allow_once" : "reject_once";
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
              update.sessionUpdate === "agent_message_chunk" ? "assistant_text" : "reasoning_text",
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
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      }),
    );
    if (init.protocolVersion !== 1) throw new Error("Unsupported Cursor ACP protocol version");
    // ACP uses the existing CLI login. Only the explicit Sign in action may open a browser.
    const resume =
      input.resumeCursor === undefined
        ? undefined
        : string(object(input.resumeCursor).nativeSessionId);
    if (resume && object(init.agentCapabilities ?? {}).loadSession !== true)
      throw new Error("Cursor runtime does not support session resume");
    id = resume ?? "";
    const session = object(
      await rpc.request(resume ? "session/load" : "session/new", {
        ...(resume ? { sessionId: resume } : {}),
        cwd: input.cwd,
        mcpServers: [],
      }),
    );
    id = resume ?? string(session.sessionId);
    if (input.modelSelection?.model)
      await rpc.request("session/set_model", {
        sessionId: id,
        modelId: input.modelSelection.model,
      });
    replaying = false;
    return {
      id,
      async send(turn) {
        assistantOpen = false;
        if (turn.modelSelection?.model)
          await rpc.request("session/set_model", {
            sessionId: id,
            modelId: turn.modelSelection.model,
          });
        await rpc.request("session/set_mode", {
          sessionId: id,
          modeId: turn.interactionMode === "plan" ? "plan" : "agent",
        });
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
          throw new Error(`Cursor turn stopped: ${String(result.stopReason)}`);
      },
      async interrupt() {
        rpc.notify("session/cancel", { sessionId: id });
      },
      close: () => rpc.close(),
      async models() {
        const state = object(session.models ?? {});
        if (!Array.isArray(state.availableModels))
          throw new Error("Cursor runtime did not advertise models");
        return {
          models: state.availableModels.map((entry) => {
            const model = object(entry);
            return { slug: string(model.modelId), name: string(model.name ?? model.modelId) };
          }),
          source: "cursor.acp",
        };
      },
    };
  } catch (error) {
    rpc.close();
    throw error;
  }
};
