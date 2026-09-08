import type {
  CanonicalItemType,
  ProviderSessionStartInput,
  ProviderModelDescriptor,
} from "@synara/contracts";
import { bounded, NativeRpc, object, string } from "./protocol";
import type { NativeDriverFactory } from "./types";
import { codexContextUsage } from "./usage";
import { nativePermissionModes } from "./permissionCapabilities";

// https://developers.openai.com/codex/app-server/ — stable v2 stdio protocol.
export function codexPermissions(input: ProviderSessionStartInput) {
  const autoReview = input.runtimeMode === "auto-approval";
  if (input.runtimeMode === "bypass-permissions")
    throw new Error("Bypass permissions is a Claude-only mode");
  const approval =
    input.approvalPolicy ??
    (autoReview ? "on-request" : input.runtimeMode === "full-access" ? "never" : "untrusted");
  const sandbox =
    input.sandboxMode ??
    (input.runtimeMode === "full-access" ? "danger-full-access" : "workspace-write");
  // Verified against the installed official CLI-generated v2 schema.
  if (approval === "on-failure")
    throw new Error("Codex no longer supports on-failure approval policy");
  if (autoReview && (approval !== "on-request" || sandbox === "danger-full-access"))
    throw new Error(
      "Approve for me requires on-request approval and a workspace or read-only sandbox",
    );
  return {
    approvalPolicy: approval,
    sandbox: sandbox,
    approvalsReviewer: autoReview ? ("auto_review" as const) : ("user" as const),
  };
}
export const createCodexDriver: NativeDriverFactory = async (input, sink) => {
  if (input.runtimeMode === "auto-approval") {
    const modes = await nativePermissionModes("codex", input.providerOptions ?? {});
    const automatic = modes.find((entry) => entry.mode === "auto-approval");
    if (!automatic?.available)
      throw new Error(automatic?.reason ?? "Native automatic review is unavailable");
  }
  const options = input.providerOptions?.codex;
  const rpc = new NativeRpc(
    options?.binaryPath ?? "codex",
    ["app-server"],
    input.cwd!,
    options?.homePath ? { ...process.env, CODEX_HOME: options.homePath } : undefined,
  );
  let id = "";
  let activeTurn = "";
  const items = new Map<string, Record<string, unknown>>();
  let finish: (() => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  rpc.onClose = (error) => {
    fail?.(error);
    sink.fail(error);
  };
  rpc.onMessage = (method, params, requestId) => {
    if (params.threadId !== undefined && params.threadId !== id) {
      if (requestId !== undefined) rpc.reject(requestId);
      return;
    }
    if (requestId !== undefined) {
      const type =
        method === "item/commandExecution/requestApproval"
          ? "command_execution_approval"
          : method === "item/fileChange/requestApproval"
            ? "file_change_approval"
            : method === "item/tool/requestUserInput"
              ? "tool_user_input"
              : undefined;
      if (!type || !id || params.turnId !== activeTurn) {
        rpc.reject(requestId);
        return;
      }
      void sink
        .request(type, {
          ...params,
          ...(typeof params.itemId === "string" && items.has(params.itemId)
            ? { item: items.get(params.itemId) }
            : {}),
        })
        .then((answer) => {
          if (type === "tool_user_input") {
            if (typeof answer === "string") {
              rpc.respond(requestId, { answers: {} });
              return;
            }
            rpc.respond(requestId, {
              answers: Object.fromEntries(
                Object.entries(answer).map(([key, value]) => [
                  key,
                  { answers: Array.isArray(value) ? value : value === null ? [] : [value] },
                ]),
              ),
            });
          } else rpc.respond(requestId, { decision: answer });
        })
        .catch(() => {
          try {
            rpc.respond(
              requestId,
              type === "tool_user_input" ? { answers: {} } : { decision: "cancel" },
            );
          } catch {}
        });
      return;
    }
    if (method === "turn/started") activeTurn = string(object(params.turn).id);
    if (
      method === "item/autoApprovalReview/started" ||
      method === "item/autoApprovalReview/completed"
    ) {
      const review = object(params.review ?? {});
      const completed = method.endsWith("/completed");
      sink.emit({
        type: completed ? "item.completed" : "item.started",
        itemId: `auto-review-${string(params.reviewId)}`,
        payload: {
          itemType: "approval_review",
          status: completed ? "completed" : "inProgress",
          title: completed
            ? `Codex automatic review: ${String(review.status)}`
            : "Codex reviewing approval",
          ...(typeof review.rationale === "string" && review.rationale.trim()
            ? { detail: review.rationale.trim() }
            : {}),
          data: { review, action: params.action, targetItemId: params.targetItemId },
        },
      });
    }
    if (method === "thread/tokenUsage/updated") {
      const usage = codexContextUsage(params.tokenUsage);
      if (usage) sink.emit({ type: "thread.token-usage.updated", payload: { usage } });
    }
    if (method === "turn/completed") {
      const turn = object(params.turn);
      if (turn.status === "failed")
        fail?.(new Error(String(object(turn.error ?? {}).message ?? "Codex turn failed")));
      else {
        if (turn.status === "interrupted")
          sink.emit({ type: "turn.completed", payload: { state: "interrupted" } });
        finish?.();
      }
    }
    const streams: Record<string, string> = {
      "item/agentMessage/delta": "assistant_text",
      "item/reasoning/textDelta": "reasoning_text",
      "item/reasoning/summaryTextDelta": "reasoning_summary_text",
      "item/commandExecution/outputDelta": "command_output",
    };
    if (streams[method] && typeof params.delta === "string")
      sink.emit({
        type: "content.delta",
        itemId: params.itemId,
        payload: { streamKind: streams[method], delta: params.delta },
      });
    if (method === "item/started" || method === "item/completed") {
      const item = object(params.item);
      items.set(string(item.id), item);
      const types: Record<string, CanonicalItemType> = {
        agentMessage: "assistant_message",
        reasoning: "reasoning",
        commandExecution: "command_execution",
        fileChange: "file_change",
        mcpToolCall: "mcp_tool_call",
        webSearch: "web_search",
      };
      sink.emit({
        type: method === "item/started" ? "item.started" : "item.completed",
        itemId: string(item.id),
        payload: {
          itemType: types[String(item.type)] ?? "unknown",
          status:
            method === "item/started"
              ? "inProgress"
              : item.status === "failed"
                ? "failed"
                : item.status === "declined"
                  ? "declined"
                  : "completed",
          data: item,
        },
      });
    }
  };
  try {
    await rpc.request("initialize", {
      clientInfo: { name: "djl_native", title: "DJL", version: "1.0.0" },
    });
    rpc.notify("initialized");
    const resume =
      input.resumeCursor === undefined
        ? undefined
        : string(object(input.resumeCursor).nativeSessionId);
    const result = object(
      await rpc.request(resume ? "thread/resume" : "thread/start", {
        ...(resume ? { threadId: resume } : {}),
        cwd: input.cwd,
        model: input.modelSelection?.model,
        ...codexPermissions(input),
      }),
    );
    const requestedPermissions = codexPermissions(input);
    const reportedReviewer =
      result.approvalsReviewer === "guardian_subagent" ? "auto_review" : result.approvalsReviewer;
    if (
      (reportedReviewer !== undefined &&
        reportedReviewer !== requestedPermissions.approvalsReviewer) ||
      (result.approvalPolicy !== undefined &&
        result.approvalPolicy !== requestedPermissions.approvalPolicy)
    )
      throw new Error(
        "Codex permission mode is unavailable: the CLI did not activate the requested approval policy and reviewer",
      );
    if (
      input.runtimeMode === "auto-approval" &&
      ((result.approvalsReviewer !== "auto_review" &&
        result.approvalsReviewer !== "guardian_subagent") ||
        result.approvalPolicy !== "on-request" ||
        !["workspaceWrite", "readOnly"].includes(String(object(result.sandbox ?? {}).type)))
    )
      throw new Error(
        "Codex automatic review is unavailable: the CLI did not activate the requested reviewer and sandbox",
      );
    id = string(object(result.thread).id);
    return {
      id,
      async send(turn) {
        items.clear();
        const completed = new Promise<void>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        });
        // Attach the completion handler before submitting: notifications can precede the response.
        const result = Promise.all([
          bounded(completed, 30 * 60_000),
          rpc.request("turn/start", {
            threadId: id,
            input: [{ type: "text", text: turn.input! }],
            model: turn.modelSelection?.model,
            ...(turn.modelSelection?.provider === "codex"
              ? {
                  ...(turn.modelSelection.options?.reasoningEffort
                    ? { effort: turn.modelSelection.options.reasoningEffort }
                    : {}),
                  ...(turn.modelSelection.options?.fastMode !== undefined
                    ? { serviceTier: turn.modelSelection.options.fastMode ? "fast" : null }
                    : {}),
                }
              : {}),
          }),
        ]);
        try {
          const [, started] = await result;
          activeTurn = string(object(object(started).turn).id);
        } finally {
          finish = undefined;
          fail = undefined;
          activeTurn = "";
        }
      },
      async interrupt() {
        if (activeTurn) await rpc.request("turn/interrupt", { threadId: id, turnId: activeTurn });
      },
      close: () => rpc.close(),
      async models() {
        const models: ProviderModelDescriptor[] = [];
        let cursor: string | undefined;
        do {
          const result = object(
            await rpc.request("model/list", { limit: 100, ...(cursor ? { cursor } : {}) }),
          );
          if (!Array.isArray(result.data)) throw new Error("Invalid Codex model list");
          for (const entry of result.data) {
            const model = object(entry);
            const efforts = Array.isArray(model.supportedReasoningEfforts)
              ? model.supportedReasoningEfforts.flatMap((entry) => {
                  const effort =
                    typeof entry === "string" ? { reasoningEffort: entry } : object(entry);
                  const value = effort.reasoningEffort ?? effort.value;
                  return typeof value === "string" && value.trim()
                    ? [
                        {
                          value,
                          ...(typeof effort.description === "string"
                            ? { description: effort.description }
                            : {}),
                        },
                      ]
                    : [];
                })
              : undefined;
            const fastMode =
              typeof model.supportsFastMode === "boolean"
                ? model.supportsFastMode
                : Array.isArray(model.additionalSpeedTiers)
                  ? model.additionalSpeedTiers.includes("fast")
                  : undefined;
            models.push({
              slug: string(model.model),
              name: string(model.displayName ?? model.model),
              ...(efforts ? { supportedReasoningEfforts: efforts } : {}),
              ...(typeof model.defaultReasoningEffort === "string"
                ? { defaultReasoningEffort: model.defaultReasoningEffort }
                : {}),
              ...(fastMode !== undefined ? { supportsFastMode: fastMode } : {}),
            });
          }
          cursor = typeof result.nextCursor === "string" ? result.nextCursor : undefined;
          if (models.length > 1000) throw new Error("Codex model pagination limit exceeded");
        } while (cursor);
        return { models, source: "codex.app-server" };
      },
    };
  } catch (error) {
    rpc.close();
    throw error;
  }
};
