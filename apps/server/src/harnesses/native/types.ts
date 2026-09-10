import type {
  CanonicalRequestType,
  ProviderApprovalDecision,
  ProviderListModelsResult,
  ProviderSendTurnInput,
  ProviderSessionStartInput,
  ProviderUserInputAnswers,
} from "@synara/contracts";
export type NativeProvider =
  | "codex"
  | "claudeAgent"
  | "cursor"
  | "grok"
  | "kimi"
  | "iflow"
  | "qwen"
  | "codebuddy"
  | "pi";
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
  interrupt(): Promise<void>;
  close(): void;
  models(): Promise<ProviderListModelsResult>;
}
export type NativeDriverFactory = (
  input: ProviderSessionStartInput,
  sink: NativeSink,
) => Promise<NativeDriver>;
