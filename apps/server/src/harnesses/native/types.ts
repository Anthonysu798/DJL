import type { PluginGatewaySession } from "../../plugins/PluginGateway";
import type { WorkMcpSessionRegistration } from "../../work/Services/WorkMcpServer";
import type {
  CanonicalRequestType,
  ProviderApprovalDecision,
  ProviderListModelsResult,
  ProviderSendTurnInput,
  ProviderSessionStartInput,
  ProviderUserInputAnswers,
} from "@djl/contracts";
export type NativeProvider =
  | "codex"
  | "claudeAgent"
  | "cursor"
  | "gemini"
  | "grok"
  | "kimi"
  | "iflow"
  | "qwen"
  | "codebuddy"
  | "pi"
  | "djlCloud"
  | "group";
export interface NativeSink {
  emit(event: Record<string, unknown>): void;
  request(
    type: CanonicalRequestType,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<ProviderApprovalDecision | ProviderUserInputAnswers>;
  fail(error: Error): void;
}
export interface NativeDriver {
  id: string;
  send(input: ProviderSendTurnInput): Promise<void>;
  /** Adds a message to the running turn; resolves false when no turn can take it. */
  steer?(input: ProviderSendTurnInput): Promise<boolean | void>;
  interrupt(): Promise<void>;
  close(): void;
  models(): Promise<ProviderListModelsResult>;
}
export type NativeDriverFactory = (
  input: ProviderSessionStartInput,
  sink: NativeSink,
  workTools?: WorkMcpSessionRegistration,
  /** The user's connected plugins, reached through DJL's local gateway. */
  plugins?: PluginGatewaySession,
) => Promise<NativeDriver>;
