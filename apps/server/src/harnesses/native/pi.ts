import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withDjlThreadId } from "./driverEnv";
import { bounded, object, prepareNativeRpcLaunch, string, type JsonObject } from "./protocol";
import type { NativeDriverFactory } from "./types";

// https://pi.dev/docs/latest/rpc — `pi --mode rpc` speaks JSONL commands with an
// echoed string id and untagged events. Pi has no permission system of its own,
// so approval-required sessions load a DJL extension that routes tool calls
// through Pi's extension UI protocol back to the user.

const APPROVAL_TITLE_PREFIX = "djl-approval:";
const APPROVAL_EXTENSION = `export default function (pi) {
  pi.on("tool_call", async (event, ctx) => {
    const name = String(event.toolName);
    const kind = name === "bash" ? "command" : name === "write" || name === "edit" ? "file" : null;
    if (!kind || !String(process.env.DJL_PI_APPROVE ?? "").split(",").includes(kind)) return;
    const input = event.input && typeof event.input === "object" ? event.input : {};
    const summary = kind === "command" ? String(input.command ?? "") : String(input.path ?? "");
    const allowed = await ctx.ui.confirm(${JSON.stringify(APPROVAL_TITLE_PREFIX)} + kind + ":" + name, summary);
    if (!allowed) return { block: true, reason: "Denied in DJL." };
  });
}
`;

export function piSubscriptionEnvironment(
  base: NodeJS.ProcessEnv = process.env,
  agentDir?: string,
): NodeJS.ProcessEnv {
  // Skip only the pi.dev version notice; full offline mode would also stop Pi
  // fetching its helper binaries. Pi keeps using the credentials in its own auth file.
  const env: NodeJS.ProcessEnv = { ...base, PI_SKIP_VERSION_CHECK: "1" };
  if (agentDir?.trim()) env.PI_CODING_AGENT_DIR = agentDir.trim();
  return env;
}

export function writePiApprovalExtension(dir = join(tmpdir(), "djl-pi")) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "djl-approvals.ts");
  writeFileSync(file, APPROVAL_EXTENSION, { mode: 0o600 });
  return file;
}

/** Minimal JSONL client for Pi's RPC mode. */
export class PiRpc {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, (message: JsonObject) => void>();
  private buffer = "";
  private nextId = 0;
  private closed = false;
  onEvent: (event: JsonObject) => void = () => {};
  onClose: (error: Error) => void = () => {};

  constructor(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    const launch = prepareNativeRpcLaunch(binary, args, cwd, env);
    this.child = spawn(launch.command, launch.args, launch.options);
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (data: string) => {
      this.buffer += data;
      let end: number;
      while ((end = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, end).replace(/\r$/, "");
        this.buffer = this.buffer.slice(end + 1);
        if (!line.startsWith("{")) continue;
        let message: JsonObject;
        try {
          message = object(JSON.parse(line));
        } catch {
          continue;
        }
        if (message.type === "response" && typeof message.id === "string") {
          const waiter = this.pending.get(message.id);
          this.pending.delete(message.id);
          waiter?.(message);
        } else this.onEvent(message);
      }
    });
    this.child.stderr.resume();
    this.child.stdin.on("error", () => this.close(new Error("Pi input closed")));
    this.child.on("error", (error) => this.close(error));
    this.child.on("exit", (code) => this.close(new Error(`Pi exited (${code})`)));
  }

  send(command: JsonObject) {
    if (this.closed) throw new Error("Pi runtime closed");
    this.child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  request(command: JsonObject, milliseconds = 30_000): Promise<JsonObject> {
    const id = `djl-${++this.nextId}`;
    return bounded(
      new Promise<JsonObject>((resolve, reject) => {
        this.pending.set(id, (message) => {
          if (message.success === true) resolve(object(message.data ?? {}));
          else reject(new Error(String(message.error ?? "Pi command failed")));
        });
        try {
          this.send({ id, ...command });
        } catch (error) {
          this.pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
      milliseconds,
    );
  }

  close(error = new Error("Pi runtime closed")) {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.pending.values())
      waiter({ type: "response", success: false, error: error.message });
    this.pending.clear();
    try {
      this.child.stdin.end();
    } catch {}
    this.child.kill();
    this.onClose(error);
  }
}

export function piModelDescriptor(model: JsonObject) {
  const provider = string(model.provider);
  const id = string(model.id);
  return { slug: `${provider}/${id}`, name: string(model.name ?? id) };
}

function splitModel(slug: string) {
  const index = slug.indexOf("/");
  if (index <= 0) throw new Error(`Pi models are named provider/model, not "${slug}"`);
  return { provider: slug.slice(0, index), modelId: slug.slice(index + 1) };
}

export const createPiDriver: NativeDriverFactory = async (input, sink) => {
  if (input.approvalPolicy)
    throw new Error("Pi does not expose the requested Codex approval policy");
  if (input.sandboxMode && input.sandboxMode !== "danger-full-access")
    throw new Error("Pi cannot enforce an OS sandbox; use Codex for sandboxed execution");
  if (input.runtimeMode === "auto-approval")
    throw new Error("Pi does not support automatic approval review");
  if (input.runtimeMode === "bypass-permissions")
    throw new Error("Bypass permissions is a Claude-only mode");
  const options = input.providerOptions?.pi;
  const resume =
    input.resumeCursor === undefined
      ? undefined
      : string(object(input.resumeCursor).nativeSessionId);
  const sessionId = resume ?? randomUUID();
  const args = ["--mode", "rpc", "--session-id", sessionId];
  const approve =
    input.runtimeMode === "approval-required"
      ? "command,file"
      : input.runtimeMode === "accept-edits"
        ? "command"
        : undefined;
  if (approve) args.push("-e", writePiApprovalExtension());
  const rpc = new PiRpc(
    options?.binaryPath?.trim() || "pi",
    args,
    input.cwd!,
    withDjlThreadId(
      {
        ...piSubscriptionEnvironment(process.env, options?.agentDir),
        ...(approve ? { DJL_PI_APPROVE: approve } : {}),
      },
      input.threadId,
    ),
  );
  let assistantMessageId = randomUUID();
  let turn: { settle: () => void; fail: (error: Error) => void } | undefined;
  let aborted = false;
  let failure: Error | undefined;
  rpc.onClose = (error) => {
    turn?.fail(error);
    sink.fail(error);
  };
  rpc.onEvent = (event) => {
    if (event.type === "extension_ui_request") {
      const id = string(event.id);
      const title = typeof event.title === "string" ? event.title : "";
      if (event.method === "confirm" && title.startsWith(APPROVAL_TITLE_PREFIX)) {
        const [kind, toolName] = title.slice(APPROVAL_TITLE_PREFIX.length).split(":");
        void sink
          .request(kind === "file" ? "file_change_approval" : "command_execution_approval", {
            toolName,
            summary: event.message,
          })
          .then((decision) =>
            rpc.send({
              type: "extension_ui_response",
              id,
              confirmed: decision === "accept" || decision === "acceptForSession",
            }),
          )
          .catch(() => {
            try {
              rpc.send({ type: "extension_ui_response", id, cancelled: true });
            } catch {}
          });
      } else if (["select", "confirm", "input", "editor"].includes(String(event.method)))
        rpc.send({ type: "extension_ui_response", id, cancelled: true });
      return;
    }
    if (event.type === "message_start") assistantMessageId = randomUUID();
    if (event.type === "message_update") {
      const update = object(event.assistantMessageEvent ?? {});
      if (
        (update.type === "text_delta" || update.type === "thinking_delta") &&
        typeof update.delta === "string"
      )
        sink.emit({
          type: "content.delta",
          itemId: `${update.type === "text_delta" ? "assistant" : "reasoning"}-${assistantMessageId}`,
          payload: {
            streamKind: update.type === "text_delta" ? "assistant_text" : "reasoning_text",
            delta: update.delta,
          },
        });
    }
    if (event.type === "message_end") {
      const message = object(event.message ?? {});
      if (message.role === "assistant" && message.stopReason === "error")
        failure = new Error(String(message.errorMessage ?? "Pi turn failed"));
    }
    if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
      const done = event.type === "tool_execution_end";
      sink.emit({
        type: done ? "item.completed" : "item.started",
        itemId: string(event.toolCallId),
        payload: {
          itemType: "dynamic_tool_call",
          status: done ? (event.isError ? "failed" : "completed") : "inProgress",
          title: string(event.toolName),
          data: event,
        },
      });
    }
    if (event.type === "agent_settled") {
      if (aborted) {
        sink.emit({ type: "turn.completed", payload: { state: "interrupted" } });
        turn?.settle();
      } else if (failure) turn?.fail(failure);
      else turn?.settle();
    }
  };
  try {
    const state = await rpc.request({ type: "get_state" }, 20_000);
    const id = string(state.sessionId);
    let currentModel = object(state.model ?? {});
    const selectModel = async (slug?: string) => {
      if (slug) {
        currentModel = await rpc.request({ type: "set_model", ...splitModel(slug) });
        return;
      }
      if (currentModel.provider === "unknown" || !currentModel.provider)
        throw new Error("Sign in to Pi with /login in the official CLI; no models are available");
    };
    await selectModel(input.modelSelection?.model);
    return {
      id,
      async send(request) {
        aborted = false;
        failure = undefined;
        const selection = request.modelSelection;
        if (selection?.model && `${currentModel.provider}/${currentModel.id}` !== selection.model)
          await selectModel(selection.model);
        const level = selection?.provider === "pi" ? selection.options?.thinkingLevel : undefined;
        if (level) await rpc.request({ type: "set_thinking_level", level });
        const settled = new Promise<void>((settle, fail) => {
          turn = { settle, fail };
        });
        await rpc.request({ type: "prompt", message: request.input! });
        try {
          await bounded(settled, 30 * 60_000);
        } finally {
          turn = undefined;
        }
      },
      async interrupt() {
        aborted = true;
        rpc.send({ type: "abort" });
      },
      close: () => rpc.close(),
      async models() {
        const result = await rpc.request({ type: "get_available_models" });
        const models = Array.isArray(result.models) ? result.models.map(object) : [];
        return { models: models.map(piModelDescriptor), source: "pi.rpc" };
      },
    };
  } catch (error) {
    rpc.close();
    throw error;
  }
};

export async function probePiSubscriptionAccount(binary: string, cwd: string, agentDir?: string) {
  const rpc = new PiRpc(
    binary,
    ["--mode", "rpc", "--no-session"],
    cwd,
    piSubscriptionEnvironment(process.env, agentDir),
  );
  try {
    const result = await rpc.request({ type: "get_available_models" }, 20_000);
    return Array.isArray(result.models) && result.models.length > 0
      ? ("ready" as const)
      : ("required" as const);
  } catch {
    return "unknown" as const;
  } finally {
    rpc.close();
  }
}
