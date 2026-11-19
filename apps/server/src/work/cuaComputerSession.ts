import { randomUUID } from "node:crypto";
import type {
  ComputerTurnControl,
  ProviderApprovalDecision,
  ProviderKind,
} from "@synara/contracts";
import { Effect } from "effect";
import { ComputerManager } from "../computer/ComputerManager";
import { computerApprovalGate } from "../computer/ComputerApprovalGate";
import {
  makeAgentGatewayComputerTools,
  type AgentGatewayComputerToolsOptions,
} from "../agentGateway/computerTools";
import { makeAgentGatewayComputerBrowserTools } from "../agentGateway/computerBrowserTools";
import { GatewayToolError, type ToolContext, type ToolEntry } from "../agentGateway/toolRuntime";

export type ComputerApprovalRequest = (
  input: {
    readonly tool: string;
    readonly arguments: Record<string, unknown>;
    readonly foreground: boolean;
  },
  signal: AbortSignal,
) => Promise<ProviderApprovalDecision>;

interface ActiveTurn {
  readonly id: string;
  readonly control: ComputerTurnControl;
  readonly abort: AbortController;
  admitted: boolean;
  activityHistory: boolean;
  presentation?: Promise<void>;
}

/** Binds DJL's existing MCP credential to one immutable, explicitly admitted Cua turn. */
export class CuaComputerSession {
  private active: ActiveTurn | undefined;
  private admission = 0;
  private readonly tools: readonly ToolEntry[];
  constructor(
    private readonly options: {
      readonly manager: ComputerManager;
      readonly threadId: string;
      readonly sessionKey: string;
      readonly provider: ProviderKind;
      readonly workspaceRoot: string;
      readonly allowedTools?: readonly string[];
      readonly requireSemanticTextTarget?: boolean;
      readonly requestApproval?: ComputerApprovalRequest;
      readonly publishApproval?: (input: {
        readonly requestId: string;
        readonly tool: string;
        readonly arguments: Record<string, unknown>;
        readonly foreground: boolean;
        readonly decision?: ProviderApprovalDecision;
      }) => Promise<void>;
    },
  ) {
    const toolOptions: AgentGatewayComputerToolsOptions = {
      manager: options.manager,
      resolveWorkspaceRoot: () => Effect.succeed(options.workspaceRoot),
      authorizeAction: (name, args, context, signal) => {
        const input = this.approvalInput(name, args, context, signal, false);
        return name === "computer_read_clipboard"
          ? computerApprovalGate.request(input)
          : computerApprovalGate.requestTask(input);
      },
      resolveForegroundAuthorization: async (context) => ({
        userRequestedVisibleUse:
          context.callerTurnId !== null &&
          computerApprovalGate.hasForegroundGrant(options.threadId, context.callerTurnId),
      }),
      requestForegroundConsent: async (name, args, context, signal) => {
        const result = await computerApprovalGate.requestForegroundTask(
          this.approvalInput(name, args, context, signal, true),
        );
        return result === "accept" ? "authorized" : result === "decline" ? "declined" : "cancelled";
      },
    };
    this.tools = [
      ...makeAgentGatewayComputerTools(toolOptions),
      ...(options.manager.supportsBrowser ? makeAgentGatewayComputerBrowserTools(toolOptions) : []),
    ];
  }

  private approvalInput(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
    signal: AbortSignal,
    foreground: boolean,
  ) {
    return {
      threadId: this.options.threadId,
      turnId: context.callerTurnId!,
      signal,
      publish: async (requestId: string, decision?: ProviderApprovalDecision) => {
        if (this.options.publishApproval) {
          await this.options.publishApproval({
            requestId,
            tool: name,
            arguments: args,
            foreground,
            ...(decision !== undefined ? { decision } : {}),
          });
          return;
        }
        if (decision !== undefined) return;
        if (!this.options.requestApproval) {
          computerApprovalGate.respond(this.options.threadId, requestId, "decline");
          return;
        }
        const reply = await this.options.requestApproval(
          { tool: name, arguments: args, foreground },
          signal,
        );
        // A task grant is bounded to this turn even if a provider's generic card offers session acceptance.
        computerApprovalGate.respond(
          this.options.threadId,
          requestId,
          reply === "acceptForSession" ? "accept" : reply,
        );
      },
    };
  }

  async begin(
    control: ComputerTurnControl | undefined,
    activityHistory = false,
  ): Promise<string | undefined> {
    const admission = ++this.admission;
    const previous = this.active;
    this.active = undefined;
    await this.retire(previous);
    if (admission !== this.admission) return undefined;
    const resolved = control ?? { mode: "off" as const, generation: 0, explicitInvocation: false };
    const turn: ActiveTurn = {
      id: randomUUID(),
      control: Object.freeze({ ...resolved }),
      abort: new AbortController(),
      admitted: false,
      activityHistory,
    };
    this.active = turn;
    if (resolved.mode === "off") return turn.id;
    const { manager, threadId } = this.options;
    if (resolved.mode === "chat")
      await manager.admitControl(threadId, "request", resolved.generation, true);
    const admitted = await manager.admitControl(
      threadId,
      resolved.mode,
      resolved.generation,
      resolved.explicitInvocation,
    );
    if (this.active !== turn || turn.abort.signal.aborted) return undefined;
    turn.admitted = admitted;
    return turn.id;
  }

  async end(expectedTurnId?: string): Promise<void> {
    const turn = this.active;
    if (expectedTurnId !== undefined && turn?.id !== expectedTurnId) return;
    ++this.admission;
    this.active = undefined;
    await this.retire(turn);
  }
  private async retire(turn: ActiveTurn | undefined): Promise<void> {
    if (!turn) return;
    turn.abort.abort(
      new GatewayToolError(
        "computer_turn_ended",
        "This Computer turn ended; no further actions may run.",
      ),
    );
    computerApprovalGate.cancelThread(this.options.threadId, turn.id);
    try {
      if (turn.presentation)
        await this.options.manager.endAgentPresentation(this.options.threadId, turn.id);
    } finally {
      await this.options.manager.releaseDesktopControl(this.options.threadId, turn.id);
    }
  }

  private isActive(turn: ActiveTurn | undefined): turn is ActiveTurn {
    return (
      turn !== undefined &&
      turn === this.active &&
      turn.admitted &&
      !turn.abort.signal.aborted &&
      this.options.manager.canActivateControl(this.options.threadId, turn.control.generation)
    );
  }
  isCurrentTurn(turnId: string | undefined): boolean {
    return (
      this.active !== undefined && !this.active.abort.signal.aborted && this.active.id === turnId
    );
  }
  canReadActivityHistory(turnId: string | undefined): boolean {
    return this.isCurrentTurn(turnId) && this.active?.activityHistory === true;
  }
  requestHeaders(): Readonly<Record<string, string>> {
    const turn = this.active;
    return turn && !turn.abort.signal.aborted ? { "x-djl-computer-turn": turn.id } : {};
  }
  requestDefinitions(turnId: string | undefined) {
    return this.isActive(this.active) && this.active.id === turnId ? this.definitions() : [];
  }
  definitions() {
    return this.isActive(this.active)
      ? this.tools
          .filter((tool) =>
            this.options.allowedTools
              ? this.options.allowedTools.includes(tool.definition.name)
              : !tool.discoveryOnly,
          )
          .map((tool) => {
            const definition = tool.definition;
            if (!this.options.requireSemanticTextTarget || definition.name !== "computer_type_text")
              return definition;
            const previous = Array.isArray(definition.inputSchema.required)
              ? definition.inputSchema.required.filter(
                  (field): field is string => typeof field === "string",
                )
              : [];
            return {
              ...definition,
              inputSchema: {
                ...definition.inputSchema,
                required: [...new Set([...previous, "window_id", "ref"])],
              },
            };
          })
      : [];
  }
  async execute(name: string, args: Record<string, unknown>, expectedTurnId?: string) {
    const turn = this.active;
    if (!this.isActive(turn))
      throw new GatewayToolError(
        "computer_turn_inactive",
        "An active Computer turn is required; no action was dispatched.",
      );
    if (expectedTurnId !== turn.id)
      throw new GatewayToolError(
        "computer_turn_mismatch",
        "This request belongs to a different Computer turn; no action was dispatched.",
      );
    const tool = this.tools.find((entry) => entry.definition.name === name);
    if (!tool || (this.options.allowedTools && !this.options.allowedTools.includes(name)))
      throw new GatewayToolError("unknown_computer_tool", "Unknown Computer tool.");
    if (
      this.options.requireSemanticTextTarget &&
      name === "computer_type_text" &&
      (typeof args.window_id !== "string" ||
        !Number.isSafeInteger(args.ref) ||
        Number(args.ref) < 0)
    )
      throw new GatewayToolError(
        "qa_semantic_target_required",
        "QA typing requires the exact window_id and a writable ref from a fresh observation.",
      );
    if (name !== "computer_help") {
      turn.presentation ??= this.options.manager.beginAgentPresentation(
        this.options.threadId,
        turn.id,
      );
      try {
        await turn.presentation;
      } catch (error) {
        if (this.active === turn) this.active = undefined;
        await this.retire(turn);
        throw error;
      }
      if (!this.isActive(turn))
        throw new GatewayToolError(
          "computer_turn_inactive",
          "This Computer turn ended before input was dispatched.",
        );
    }
    const { threadId, sessionKey, provider } = this.options;
    const context: ToolContext = {
      principal: { kind: "provider-session", sessionKey, threadId, provider, turnId: turn.id },
      callerThreadId: threadId,
      callerThreadLabel: null,
      callerSessionKey: sessionKey,
      callerProvider: provider,
      callerCapabilities: new Set(["computer:control"]),
      callerTurnId: turn.id,
      jsonRpcRequestId: randomUUID(),
      assertCallerTurnActive: () =>
        this.isActive(turn)
          ? Effect.void
          : Effect.fail(
              new GatewayToolError(
                "computer_turn_inactive",
                "This Computer turn ended; no action was dispatched.",
              ),
            ),
    };
    return Effect.runPromise(tool.handler(args, context), { signal: turn.abort.signal });
  }
}
