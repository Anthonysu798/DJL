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
  | "copilot"
  | "codebuddy"
  | "pi"
  | "muse"
  | "doubao"
  | "deepseek"
  | "djlCloud"
  | "group";
const NATIVE_PROVIDERS: Record<NativeProvider, true> = {
  codex: true,
  claudeAgent: true,
  cursor: true,
  gemini: true,
  grok: true,
  kimi: true,
  iflow: true,
  qwen: true,
  copilot: true,
  codebuddy: true,
  pi: true,
  muse: true,
  doubao: true,
  deepseek: true,
  djlCloud: true,
  group: true,
};
/** Whether a native driver in this folder serves the provider (everything but OpenCode). */
export const isNativeProvider = (provider: string): provider is NativeProvider =>
  Object.hasOwn(NATIVE_PROVIDERS, provider);
/** Native harnesses that run on this computer and open attached files themselves. */
export const isLocalHarness = (provider: string): boolean =>
  isNativeProvider(provider) && provider !== "djlCloud";
export interface NativeSink {
  emit(event: Record<string, unknown>): void;
  request(
    type: CanonicalRequestType,
    args: unknown,
    signal?: AbortSignal,
  ): Promise<ProviderApprovalDecision | ProviderUserInputAnswers>;
  fail(error: Error): void;
}
/** An attachment at its saved path. */
export interface NativeTurnFile {
  readonly path: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** An image, which a driver may show to the model directly when its protocol can. */
  readonly image: boolean;
  /** Plain text DJL extracted from a PDF or Office file, for a runtime that cannot open one. */
  readonly textPath?: string;
}
/** A turn as a driver receives it: `input` already lists every file's saved path. */
export type NativeTurn = ProviderSendTurnInput & {
  readonly files?: ReadonlyArray<NativeTurnFile>;
};
export interface NativeDriver {
  id: string;
  send(input: NativeTurn): Promise<void>;
  /** Adds a message to the running turn; resolves false when no turn can take it. */
  steer?(input: NativeTurn): Promise<boolean | void>;
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
