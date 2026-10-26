import type { AgentOutcome, TaskHarnessInput } from "../AgentRunner.ts";
import { ApiError } from "../../http/errors.ts";
import { ScopedGateway } from "./ScopedGateway.ts";
import type { RequestFacts } from "../../gateway/GatewayService.ts";

export interface CodexHostOptions {
  readonly baseUrl: string;
  readonly controlToken: string;
  readonly gateway: ScopedGateway;
  /** Re-check membership, ban, and ownership for every model call. */
  readonly authorize: (facts: RequestFacts) => Promise<RequestFacts>;
  readonly resolveModel: (requested: string) => Promise<string>;
  readonly allowedOrgs: ReadonlySet<string>;
  readonly fetchImpl?: typeof fetch;
}

interface Frame {
  readonly seq: number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

/** App Server orchestration only. The broker owns isolated workspaces, never the worker. */
export class CodexHost {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: CodexHostOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }
  resolveModel(requested: string): Promise<string> {
    return this.options.resolveModel(requested);
  }
  accepts(facts: RequestFacts): boolean {
    return this.options.allowedOrgs.has(facts.principal.orgId);
  }

  private async request(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.controlToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new ApiError(
        503,
        "codex_host_unavailable",
        "The cloud coding workspace is unavailable.",
      );
    return record(await response.json());
  }

  async execute(input: TaskHarnessInput): Promise<AgentOutcome> {
    if (!this.accepts(input.facts))
      throw new ApiError(
        403,
        "codex_pilot_only",
        "Cloud coding is not enabled for this organization.",
      );
    await this.options.authorize(input.facts);
    const abort = new AbortController();
    const signal = AbortSignal.any([
      input.signal,
      abort.signal,
      AbortSignal.timeout(Math.max(1, input.deadline - Date.now())),
    ]);
    let spent = input.run.spentMicro;
    const state: { gatewayError: { code: string; message: string } | null } = {
      gatewayError: null,
    };
    let session: string | undefined;
    let cancelled = false;
    let retain = false;
    let tools = input.run.toolCalls;
    const scope = this.options.gateway.open({
      model: input.run.model,
      expiresAt: input.deadline,
      signal,
      facts: () => this.options.authorize(input.facts),
      beginStep: input.beginStep,
      budget: () => input.cap - spent,
      settled: async (result) => {
        if (result.usage) spent += BigInt(result.usage.settled);
        state.gatewayError = result.error;
        await input.recordUsage(result);
      },
    });
    const poll = setInterval(() => {
      void input
        .cancelRequested()
        .then((requested) => {
          if (requested) {
            cancelled = true;
            abort.abort();
          }
        })
        .catch(() => abort.abort());
    }, 250);
    let cursor = 0;
    const texts = new Map<string, string>();
    try {
      const started = await this.request(
        "/runs/start",
        { runId: input.run.id, gatewayToken: scope.token, model: input.run.model },
        signal,
      );
      session = String(started.sessionId);
      const rpc = (method: string, params: unknown) =>
        this.request(`/runs/${session}/rpc`, { method, params }, signal);
      await rpc("initialize", {
        clientInfo: { name: "djl_cloud", title: "DJL Cloud", version: "0.1.0" },
        capabilities: {},
      });
      await rpc("initialized", {});
      const threads = await rpc("thread/list", { limit: 1, archived: false });
      const prior = Array.isArray(threads.data) ? record(threads.data[0]) : {};
      const thread = await rpc(typeof prior.id === "string" ? "thread/resume" : "thread/start", {
        ...(typeof prior.id === "string" ? { threadId: prior.id } : {}),
        model: input.run.model,
        modelProvider: "djl",
        cwd: "/workspace",
        approvalPolicy: "never",
        sandbox: "danger-full-access",
      });
      const threadId = String(record(thread.thread).id);
      const prompt = input.messages
        .map(
          (message) =>
            `${message.role}: ${typeof message.content === "string" ? message.content : JSON.stringify(message.content)}`,
        )
        .join("\n\n");
      await rpc("turn/start", {
        threadId,
        input: [
          {
            type: "text",
            text:
              typeof prior.id === "string"
                ? "Continue the interrupted DJL task. Use the existing conversation and workspace state; do not repeat operations that already succeeded."
                : prompt,
            text_elements: [],
          },
        ],
      });
      while (!signal.aborted) {
        const batch = await this.request(`/runs/${session}/events`, { after: cursor }, signal);
        for (const frame of (batch.events ?? []) as Frame[]) {
          cursor = frame.seq;
          const params = frame.params ?? {};
          const item = record(params.item);
          const id = String(item.id ?? params.itemId ?? "");
          if (frame.method === "item/agentMessage/delta") {
            const text = typeof params.delta === "string" ? params.delta : "";
            texts.set(id, (texts.get(id) ?? "") + text);
            await input.log.append("text.delta", { messageId: input.run.messageId, text });
          }
          if (
            frame.method === "item/started" &&
            ["commandExecution", "fileChange"].includes(String(item.type))
          ) {
            tools += 1;
            if (tools > input.limits.maxToolCalls)
              throw new ApiError(400, "tool_limit", "The task reached its tool call limit.");
            await input.recordToolCall(tools);
            await input.addParts([
              {
                type: "tool_call",
                toolCallId: id,
                name: String(item.type),
                arguments: JSON.stringify(item.command ?? item.changes ?? {}),
              },
            ]);
          }
          if (frame.method === "item/completed") {
            if (item.type === "agentMessage") {
              const text = typeof item.text === "string" ? item.text : (texts.get(id) ?? "");
              if (text) await input.addParts([{ type: "text", text }]);
              texts.delete(id);
            }
            if (["commandExecution", "fileChange"].includes(String(item.type)))
              await input.addParts([
                {
                  type: "tool_result",
                  toolCallId: id,
                  name: String(item.type),
                  content: String(item.aggregatedOutput ?? item.status ?? "").slice(0, 32_000),
                  isError: item.status === "failed",
                },
              ]);
          }
          if (state.gatewayError)
            throw new ApiError(402, state.gatewayError.code, state.gatewayError.message);
          if (frame.method === "turn/completed") {
            if (record(params.turn).status !== "completed")
              throw new ApiError(
                502,
                "codex_turn_failed",
                "The cloud coding task did not complete.",
              );
            return { status: "succeeded" };
          }
          if (frame.method === "error")
            throw new ApiError(502, "codex_error", "The cloud coding engine returned an error.");
        }
      }
      throw new Error("Codex interrupted");
    } catch (error) {
      if (cancelled) return { status: "cancelled" };
      if (input.signal.aborted) throw error;
      const api =
        state.gatewayError ??
        (error instanceof ApiError
          ? error
          : {
              code: signal.aborted ? "time_limit" : "codex_error",
              message: signal.aborted
                ? "The task ran out of time."
                : "The cloud coding task failed.",
            });
      retain = ["insufficient_credits", "usage_window_exhausted", "usage_window_cut"].includes(
        api.code,
      );
      return {
        status: retain ? "blocked_on_usage" : "failed",
        error: { code: api.code, message: api.message },
      };
    } finally {
      clearInterval(poll);
      abort.abort();
      scope.close();
      if (session)
        await this.request(`/runs/${session}/stop`, {
          retain: input.signal.aborted || retain,
        }).catch(() => undefined);
    }
  }
}
