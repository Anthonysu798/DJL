import { randomUUID } from "node:crypto";
import { withDjlThreadId } from "./driverEnv";
import type { PermissionMode, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { bounded, object, string } from "./protocol";
import type { NativeDriverFactory } from "./types";
import { resolveClaudeExecutable } from "./claudeExecutable";
import {
  getDefaultAutoCompactWindow,
  getDefaultEffort,
  getEffectiveClaudeCodeEffort,
  getModelCapabilities,
} from "@synara/shared/model";
import { claudeContextUsage } from "./usage";
import { CLAUDE_CODE_EFFORT_OPTIONS, effectiveRuntimeMode } from "@synara/contracts";

const compactTokens = (value: string | undefined) =>
  value === "200k" ? 200_000 : value === "1m" ? 1_000_000 : null;

// Official Agent SDK; the CLI owns ~/.claude credentials throughout.
// https://code.claude.com/docs/en/agent-sdk/permissions
export const createClaudeDriver: NativeDriverFactory = async (input, sink) => {
  if (input.approvalPolicy)
    throw new Error(
      "Claude SDK does not expose the requested Codex approval policy; use native permission modes",
    );
  if (input.sandboxMode && input.sandboxMode !== "danger-full-access")
    throw new Error("Claude native bridge does not implement the requested OS sandbox");
  const configured = input.providerOptions?.claudeAgent;
  const executable = await resolveClaudeExecutable(configured?.binaryPath || "claude");
  const selection =
    input.modelSelection?.provider === "claudeAgent" ? input.modelSelection : undefined;
  const caps = getModelCapabilities("claudeAgent", selection?.model);
  const effort = CLAUDE_CODE_EFFORT_OPTIONS.find(
    (value) => value === (selection?.options?.effort ?? getDefaultEffort(caps)),
  );
  const apiEffort = getEffectiveClaudeCodeEffort(effort);

  let autoCompactWindow = compactTokens(
    selection?.options?.autoCompactWindow ??
      selection?.options?.contextWindow ??
      getDefaultAutoCompactWindow(caps) ??
      undefined,
  );
  let lastCallUsage: Record<string, unknown> | undefined;
  let activeModel = selection?.model;
  let contextLimit = caps.contextWindowTokens;
  const emitUsage = () => {
    const usage = claudeContextUsage(lastCallUsage, contextLimit);
    if (usage) sink.emit({ type: "thread.token-usage.updated", payload: { usage } });
  };
  const mode = effectiveRuntimeMode("claudeAgent", input.runtimeMode);
  const selectedMode =
    mode === "bypass-permissions"
      ? "bypassPermissions"
      : mode === "auto-approval"
        ? "auto"
        : mode === "accept-edits"
          ? "acceptEdits"
          : "default";
  const permissionMode = configured?.permissionMode ?? selectedMode;
  if (
    permissionMode !== selectedMode &&
    (selectedMode !== "default" || !["dontAsk", "plan"].includes(permissionMode))
  )
    throw new Error(
      "Conflicting Claude permission settings. Select the desired mode in DJL before retrying.",
    );
  if (
    permissionMode !== "default" &&
    permissionMode !== "acceptEdits" &&
    permissionMode !== "plan" &&
    permissionMode !== "dontAsk" &&
    permissionMode !== "auto" &&
    permissionMode !== "bypassPermissions"
  )
    throw new Error("Unsupported native Claude permission mode");
  let expectedPermissionMode: PermissionMode = permissionMode;
  const id =
    input.resumeCursor === undefined
      ? randomUUID()
      : string(object(input.resumeCursor).nativeSessionId);
  let next: ((value: IteratorResult<SDKUserMessage>) => void) | undefined;
  let queued: SDKUserMessage | undefined;
  let closed = false;
  const prompt: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (closed) return Promise.resolve({ done: true as const, value: undefined });
          if (queued) {
            const value = queued;
            queued = undefined;
            return Promise.resolve({ done: false as const, value });
          }
          return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
            next = resolve;
          });
        },
      };
    },
  };
  const abort = new AbortController();
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const runtime = query({
    prompt,
    options: {
      cwd: input.cwd!,
      ...(input.modelSelection ? { model: input.modelSelection.model } : {}),
      ...(input.resumeCursor === undefined ? { sessionId: id } : { resume: id }),
      pathToClaudeCodeExecutable: executable,
      ...(apiEffort ? { effort: apiEffort } : {}),
      settings: {
        ultracode: effort === "ultracode",
        fastMode: selection?.options?.fastMode === true,
        ...(selection?.options?.thinking !== undefined
          ? { alwaysThinkingEnabled: selection.options.thinking }
          : {}),
        ...(autoCompactWindow !== null ? { autoCompactWindow } : {}),
      },
      permissionMode,
      ...(permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
      abortController: abort,
      includePartialMessages: true,
      settingSources: ["user", "project", "local"],
      env: withDjlThreadId(process.env, input.threadId),
      canUseTool: async (tool, args, context) => {
        // Required user interaction still reaches this callback in native bypass mode.
        if (tool === "AskUserQuestion") {
          const answers = await sink.request("tool_user_input", args, context.signal);
          return typeof answers === "string"
            ? { behavior: "deny", message: "User cancelled input", interrupt: true }
            : {
                behavior: "allow",
                updatedInput: {
                  ...args,
                  answers: Object.fromEntries(
                    Object.entries(answers).map(([key, value]) => [
                      key,
                      Array.isArray(value) ? value.join(", ") : (value ?? ""),
                    ]),
                  ),
                },
              };
        }
        const requestType =
          tool === "Read"
            ? "file_read_approval"
            : tool === "Edit" || tool === "Write"
              ? "file_change_approval"
              : "command_execution_approval";
        const decision = await sink.request(
          requestType,
          { tool, input: args, toolUseId: context.toolUseID },
          context.signal,
        );
        return decision === "accept" || decision === "acceptForSession"
          ? { behavior: "allow", updatedInput: args }
          : {
              behavior: "deny",
              message: "User declined permission",
              interrupt: decision === "cancel",
            };
      },
    },
  });
  let assistantMessageId: string = randomUUID();
  let finish: (() => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const pump = (async () => {
    try {
      for await (const message of runtime) {
        if (closed) break;
        if (message.type === "system" && message.subtype === "permission_denied") {
          sink.emit({
            type: "item.completed",
            itemId: `permission-${message.tool_use_id}`,
            payload: {
              itemType: "approval_review",
              status: "declined",
              title: `Claude denied ${message.tool_name}`,
              detail:
                message.decision_reason?.trim() ||
                message.message.trim() ||
                "Permission denied by Claude",
              data: { decisionReasonType: message.decision_reason_type ?? null },
            },
          });
        }
        if (
          message.type === "system" &&
          (message.subtype === "init" || message.subtype === "status") &&
          message.permissionMode &&
          message.permissionMode !== expectedPermissionMode
        ) {
          throw new Error(
            `Claude permission mode ${expectedPermissionMode} is unavailable: the runtime selected ${message.permissionMode}. Choose a supported mode in DJL.`,
          );
        }
        if (message.type === "stream_event") {
          const event = message.event;
          if (event.type === "message_start" && !message.parent_tool_use_id) {
            activeModel = event.message.model;
            lastCallUsage = { ...event.message.usage };
            emitUsage();
          }
          if (event.type === "message_delta" && lastCallUsage && !message.parent_tool_use_id) {
            lastCallUsage = {
              ...lastCallUsage,
              ...Object.fromEntries(
                Object.entries(event.usage).filter(
                  ([, value]) => value !== null && value !== undefined,
                ),
              ),
            };
            emitUsage();
          }
          if (event.type === "message_start") assistantMessageId = event.message.id;
          if (event.type === "content_block_delta" && event.delta.type === "text_delta")
            sink.emit({
              type: "content.delta",
              itemId: `assistant-${assistantMessageId}-${event.index}`,
              payload: { streamKind: "assistant_text", delta: event.delta.text },
            });
          if (event.type === "content_block_delta" && event.delta.type === "thinking_delta")
            sink.emit({
              type: "content.delta",
              itemId: `reasoning-${assistantMessageId}-${event.index}`,
              payload: { streamKind: "reasoning_text", delta: event.delta.thinking },
            });
        }
        if (message.type === "assistant") {
          for (const block of message.message.content)
            if (block.type === "tool_use")
              sink.emit({
                type: "item.started",
                itemId: block.id,
                payload: {
                  itemType: "dynamic_tool_call",
                  status: "inProgress",
                  title: block.name,
                  data: block,
                },
              });
        }
        if (message.type === "user" && Array.isArray(message.message.content)) {
          for (const block of message.message.content)
            if (block.type === "tool_result")
              sink.emit({
                type: "item.completed",
                itemId: block.tool_use_id,
                payload: {
                  itemType: "dynamic_tool_call",
                  status: block.is_error ? "failed" : "completed",
                  data: block,
                },
              });
        }
        if (message.type === "result") {
          const modelUsages = Object.values(message.modelUsage ?? {});
          const usageModel =
            (activeModel ? message.modelUsage?.[activeModel] : undefined) ??
            (modelUsages.length === 1 ? modelUsages[0] : undefined);
          if (usageModel?.contextWindow && usageModel.contextWindow > 0)
            contextLimit = usageModel.contextWindow;
          emitUsage();
          if (message.is_error || message.subtype !== "success")
            fail?.(
              new Error(
                "errors" in message
                  ? message.errors.join("; ")
                  : message.result || "Claude turn failed",
              ),
            );
          else finish?.();
        }
      }
      if (!closed) throw new Error("Claude runtime stream ended");
    } catch (error) {
      if (!closed) {
        const failure = error instanceof Error ? error : new Error("Claude runtime failed");
        fail?.(failure);
        sink.fail(failure);
      }
    }
  })();
  const close = () => {
    if (closed) return;
    closed = true;
    next?.({ done: true, value: undefined });
    next = undefined;
    queued = undefined;
    fail?.(new Error("Claude session stopped"));
    abort.abort();
    runtime.close();
  };
  try {
    await bounded(runtime.initializationResult());
  } catch (error) {
    close();
    await bounded(pump, 2000).catch(() => {});
    throw error;
  }
  return {
    id,
    async send(turn) {
      assistantMessageId = randomUUID();
      const nextWindow =
        turn.modelSelection?.provider === "claudeAgent"
          ? compactTokens(
              turn.modelSelection.options?.autoCompactWindow ??
                turn.modelSelection.options?.contextWindow ??
                getDefaultAutoCompactWindow(
                  getModelCapabilities("claudeAgent", turn.modelSelection.model),
                ) ??
                undefined,
            )
          : autoCompactWindow;
      if (nextWindow !== autoCompactWindow) {
        await bounded(runtime.applyFlagSettings({ autoCompactWindow: nextWindow }));
        autoCompactWindow = nextWindow;
      }
      if (turn.modelSelection?.model) {
        if (turn.modelSelection.model !== activeModel) {
          contextLimit = getModelCapabilities(
            "claudeAgent",
            turn.modelSelection.model,
          ).contextWindowTokens;
        }
        await bounded(runtime.setModel(turn.modelSelection.model));
      }
      expectedPermissionMode = turn.interactionMode === "plan" ? "plan" : permissionMode;
      await bounded(runtime.setPermissionMode(expectedPermissionMode));
      const completed = new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      const message: SDKUserMessage = {
        type: "user",
        session_id: id,
        parent_tool_use_id: null,
        message: { role: "user", content: turn.input! },
      };
      if (next) {
        const resolve = next;
        next = undefined;
        resolve({ done: false, value: message });
      } else queued = message;
      try {
        await bounded(completed, 30 * 60_000);
      } finally {
        finish = undefined;
        fail = undefined;
      }
    },
    async interrupt() {
      await bounded(runtime.interrupt());
    },
    close,
    async models() {
      return {
        models: (await bounded(runtime.supportedModels())).map((model) =>
          Object.assign(
            { slug: model.resolvedModel ?? model.value, name: model.displayName },
            model.description ? { description: model.description } : {},
            model.supportedEffortLevels
              ? {
                  supportedReasoningEfforts: model.supportedEffortLevels.map((value) => ({
                    value,
                  })),
                }
              : model.supportsEffort === false
                ? { supportedReasoningEfforts: [] }
                : {},
            model.supportsAutoMode !== undefined
              ? { supportsAutoMode: model.supportsAutoMode }
              : {},
            model.supportsFastMode !== undefined
              ? { supportsFastMode: model.supportsFastMode }
              : {},
          ),
        ),
        source: "claude.agent-sdk",
      };
    },
  };
};
