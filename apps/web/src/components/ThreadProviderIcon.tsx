import { PROVIDER_DISPLAY_NAMES, type ProviderKind, type ThreadId } from "@synara/contracts";
import { useComposerDraftStore } from "../composerDraftStore";
import { ProviderIcon } from "./ProviderIcon";

export function ThreadProviderIcon({
  threadId,
  provider,
  sessionProvider,
  isDraft = false,
}: {
  threadId: ThreadId;
  provider: ProviderKind;
  sessionProvider?: ProviderKind | null | undefined;
  isDraft?: boolean;
}) {
  const draftProvider = useComposerDraftStore((store) =>
    isDraft ? store.draftsByThreadId[threadId]?.activeProvider : null,
  );
  const effectiveProvider = sessionProvider ?? draftProvider ?? provider;
  const label =
    effectiveProvider === "opencode"
      ? "OpenCode"
      : effectiveProvider === "claudeAgent"
        ? "Claude Code"
        : PROVIDER_DISPLAY_NAMES[effectiveProvider];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex size-3.5 shrink-0 items-center justify-center"
    >
      <ProviderIcon provider={effectiveProvider} className="size-3.5" />
    </span>
  );
}
