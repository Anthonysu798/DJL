import type {
  CanonicalItemType,
  ProviderSessionStartInput,
  ProviderModelDescriptor,
} from "@synara/contracts";
import { withDjlThreadId } from "./driverEnv";
import { bounded, NativeRpc, object, string } from "./protocol";
import type { NativeDriverFactory } from "./types";
import { codexContextUsage } from "./usage";
import { nativePermissionModes } from "./permissionCapabilities";
import { execFileSync } from "node:child_process";

/** Read connector names through the CLI; never inspect its credential store. */
function codexQaMcpOverrides(binary: string, cwd: string, env: NodeJS.ProcessEnv) {
  try {
    const metadata: unknown = JSON.parse(
      execFileSync(binary, ["mcp", "list", "--json"], {
        cwd,
        env,
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 2 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    if (!Array.isArray(metadata)) throw new Error();
    const servers: Record<string, Record<string, unknown>> = {};
    const args = metadata.flatMap((entry) => {
      const name = string(object(entry).name);
      if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error();
      // External connector metadata may have no transport in config.toml.
      // Supply an inert, disabled entry instead of creating an invalid partial table.
      const type = string(object(object(entry).transport).type);
      const transport =
        type === "stdio"
          ? `command=${JSON.stringify(process.execPath)},args=["--version"]`
          : type === "streamable_http"
            ? 'url="http://127.0.0.1:9"'
            : undefined;
      if (!transport) throw new Error();
      servers[name] =
        type === "stdio"
          ? { command: process.execPath, args: ["--version"], enabled: false }
          : { url: "http://127.0.0.1:9", enabled: false };
      return ["-c", `mcp_servers.${name}={${transport},enabled=false}`];
    });
    return { args, servers };
  } catch {
    throw new Error(
      "Codex QA could not isolate configured MCP connectors; no model turn was started",
    );
  }
}

const COMPUTER_QA_DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "apps",
  "plugins",
  "remote_plugin",
  "memories",
  "multi_agent",
  "hooks",
  "view_image",
  "computer_use",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "code_mode",
  "workspace_dependencies",
  "skill_search",
  "chronicle",
  "request_permissions_tool",
  "goals",
  "image_generation",
  "sleep_tool",
  "tool_suggest",
] as const;

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
export const createCodexDriver: NativeDriverFactory = async (input, sink, workTools, plugins) => {
  if (input.runtimeMode === "auto-approval") {
    const modes = await nativePermissionModes("codex", input.providerOptions ?? {});
    const automatic = modes.find((entry) => entry.mode === "auto-approval");
    if (!automatic?.available)
      throw new Error(automatic?.reason ?? "Native automatic review is unavailable");
  }
  const options = input.providerOptions?.codex;
  const computerQa = process.env.DJL_COMPUTER_QA_PROFILE === "1";
  // The QA profile runs with DJL's own tool server only.
  const pluginServers = computerQa ? [] : (plugins?.servers ?? []);
  const permissions = computerQa
    ? { approvalPolicy: "untrusted", sandbox: "read-only", approvalsReviewer: "user" }
    : codexPermissions(input);
  const verifyQaContext = (context: Record<string, unknown>) => {
    if (
      computerQa &&
      (context.modelProvider !== "openai" ||
        context.approvalPolicy !== "untrusted" ||
        object(context.sandbox ?? {}).type !== "readOnly")
    )
      throw new Error(
        "Codex QA did not confirm the official provider and read-only policy; no model turn was started",
      );
  };
  let qaMcpServers: Record<string, Record<string, unknown>> = {};
  const workConfig = () => {
    const names = workTools?.computer?.toolNames();
    return {
      ...(computerQa
        ? {
            project_doc_max_bytes: 0,
            web_search: "disabled",
            skills: { bundled: { enabled: false }, include_instructions: false },
            features: {
              ...Object.fromEntries(COMPUTER_QA_DISABLED_FEATURES.map((name) => [name, false])),
              skip_host_skill_discovery: true,
              code_mode_only_strict_3p_tools: true,
            },
          }
        : {}),
      mcp_servers: {
        ...qaMcpServers,
        ...Object.fromEntries(
          pluginServers.map((server) => [
            server.name,
            { url: server.url, bearer_token_env_var: "DJL_PLUGIN_MCP_TOKEN" },
          ]),
        ),
        ...(workTools?.multipost
          ? {
              [workTools.multipost.name]: {
                url: workTools.multipost.url,
                bearer_token_env_var: "DJL_MULTIPOST_MCP_TOKEN",
                required: true,
              },
            }
          : {}),
        ...(workTools
          ? {
              [workTools.name]: {
                url: workTools.url,
                bearer_token_env_var: "DJL_WORK_MCP_TOKEN",
                ...(names
                  ? {
                      enabled: names.length > 0,
                      enabled_tools: names,
                      http_headers: workTools.computer!.requestHeaders(),
                      required: true,
                      tool_timeout_sec: 360,
                    }
                  : {}),
              },
            }
          : {}),
      },
    };
  };
  const environment = withDjlThreadId(
    {
      ...(options?.homePath ? { ...process.env, CODEX_HOME: options.homePath } : process.env),
      ...(workTools ? { DJL_WORK_MCP_TOKEN: workTools.bearerToken } : {}),
      ...(workTools?.multipost ? { DJL_MULTIPOST_MCP_TOKEN: workTools.multipost.bearerToken } : {}),
      ...(plugins && pluginServers.length > 0 ? { DJL_PLUGIN_MCP_TOKEN: plugins.bearerToken } : {}),
    },
    input.threadId,
  );
  const createRpc = () => {
    const isolation = computerQa
      ? codexQaMcpOverrides(options?.binaryPath ?? "codex", input.cwd!, environment)
      : { args: [], servers: {} };
    qaMcpServers = isolation.servers;
    return new NativeRpc(
      options?.binaryPath ?? "codex",
      [
        "app-server",
        ...(computerQa
          ? [
              "--strict-config",
              "-c",
              "project_doc_max_bytes=0",
              "-c",
              'web_search="disabled"',
              "-c",
              "skills.bundled.enabled=false",
              "-c",
              "skills.include_instructions=false",
              "--enable",
              "skip_host_skill_discovery",
              "--enable",
              "code_mode_only_strict_3p_tools",
              ...isolation.args,
              ...COMPUTER_QA_DISABLED_FEATURES.flatMap((name) => ["--disable", name]),
            ]
          : []),
      ],
      input.cwd!,
      environment,
    );
  };
  let rpc = createRpc();
  let id = "";
  let activeTurn = "";
  const items = new Map<string, Record<string, unknown>>();
  let finish: (() => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const onClose: NativeRpc["onClose"] = (error) => {
    fail?.(error);
    sink.fail(error);
  };
  const onMessage: NativeRpc["onMessage"] = (method, params, requestId) => {
    const sourceRpc = rpc;
    if (params.threadId !== undefined && params.threadId !== id) {
      if (requestId !== undefined) sourceRpc.reject(requestId);
      return;
    }
    if (requestId !== undefined) {
      if (method === "mcpServer/elicitation/request") {
        // Tool-call approvals are only taken from servers DJL itself handed to this session.
        const approvalServer = [
          workTools?.name,
          ...pluginServers.map((server) => server.name),
        ].find((name) => name !== undefined && name === params.serverName);
        const ownToolApproval =
          approvalServer &&
          params.turnId === activeTurn &&
          !!activeTurn &&
          params.mode === "form" &&
          object(params._meta ?? {}).codex_approval_kind === "mcp_tool_call";
        if (!ownToolApproval || (computerQa && !workTools?.computer?.toolNames().length)) {
          sourceRpc.respond(requestId, { action: "decline" });
        } else if (computerQa) {
          // This accepts only the native proxy. Cua still requires its separate
          // task/window consent and immutable turn authority before any input.
          sourceRpc.respond(requestId, { action: "accept", content: {} });
        } else {
          void sink
            .request("command_execution_approval", { ...params, tool: approvalServer })
            .then((answer) =>
              sourceRpc.respond(requestId, {
                action:
                  sourceRpc !== rpc || params.turnId !== activeTurn
                    ? "cancel"
                    : answer === "accept" || answer === "acceptForSession"
                      ? "accept"
                      : answer === "cancel"
                        ? "cancel"
                        : "decline",
                content: {},
              }),
            )
            .catch(() => {
              try {
                sourceRpc.respond(requestId, { action: "cancel" });
              } catch {}
            });
        }
        return;
      }
      if (computerQa && method !== "item/tool/requestUserInput") {
        sourceRpc.respond(requestId, { decision: "decline" });
        return;
      }
      const type =
        method === "item/commandExecution/requestApproval"
          ? "command_execution_approval"
          : method === "item/fileChange/requestApproval"
            ? "file_change_approval"
            : method === "item/tool/requestUserInput"
              ? "tool_user_input"
              : undefined;
      if (!type || !id || params.turnId !== activeTurn) {
        sourceRpc.reject(requestId);
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
              sourceRpc.respond(requestId, { answers: {} });
              return;
            }
            sourceRpc.respond(requestId, {
              answers: Object.fromEntries(
                Object.entries(answer).map(([key, value]) => [
                  key,
                  { answers: Array.isArray(value) ? value : value === null ? [] : [value] },
                ]),
              ),
            });
          } else sourceRpc.respond(requestId, { decision: answer });
        })
        .catch(() => {
          try {
            sourceRpc.respond(
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
    // Rolling subscription limits; same payload the Codex adapter emitted.
    if (method === "account/rateLimits/updated")
      sink.emit({ type: "account.rate-limits.updated", payload: { rateLimits: params } });
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
  rpc.onClose = onClose;
  rpc.onMessage = onMessage;
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
        ...(computerQa ? { modelProvider: "openai" } : {}),
        ...permissions,
        ...(workTools || computerQa || pluginServers.length > 0
          ? {
              config: workConfig(),
            }
          : {}),
      }),
    );
    verifyQaContext(result);
    const requestedPermissions = permissions;
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
    if (!resume && workTools?.computer) {
      // Codex persists a new empty rollout on this metadata write, allowing
      // the first turn to refresh MCP without creating a replacement thread.
      await rpc.request("thread/name/set", { threadId: id, name: "DJL Computer Use" });
    }
    return {
      id,
      async send(turn) {
        items.clear();
        if (workTools?.computer) {
          // Loaded Codex threads retain their MCP connection configuration.
          // Reopen the same persisted thread in a fresh client for this turn's
          // immutable header/catalog; never replay an in-flight model request.
          rpc.onClose = () => {};
          rpc.onMessage = () => {};
          rpc.close();
          rpc = createRpc();
          rpc.onClose = onClose;
          rpc.onMessage = onMessage;
          await rpc.request("initialize", {
            clientInfo: { name: "djl_native", title: "DJL", version: "1.0.0" },
          });
          rpc.notify("initialized");
          const resumed = object(
            await rpc.request("thread/resume", {
              threadId: id,
              cwd: input.cwd,
              ...(computerQa ? { modelProvider: "openai" } : {}),
              ...permissions,
              config: workConfig(),
            }),
          );
          if (string(object(resumed.thread).id) !== id)
            throw new Error("Codex Computer refresh changed the owning thread");
          verifyQaContext(resumed);
          if (computerQa) {
            const status = object(
              await rpc.request("mcpServerStatus/list", { threadId: id, limit: 100 }),
            );
            if (
              !Array.isArray(status.data) ||
              status.nextCursor ||
              status.data.some((entry) => {
                const server = object(entry);
                return server.name !== workTools.name && server.runtimeStatus !== "disabled";
              })
            )
              throw new Error("Codex QA found an unscoped connector; no model turn was started");
          }
        }
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
            ...(computerQa
              ? { approvalPolicy: "untrusted", sandboxPolicy: { type: "readOnly" } }
              : {}),
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
