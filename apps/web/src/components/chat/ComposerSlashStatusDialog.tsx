import type { ResolvedThreadWorkspaceState } from "@synara/shared/threadEnvironment";
import type { ProviderInteractionMode } from "@synara/contracts";
import type { DraftThreadEnvMode } from "../../composerDraftStore";
import type { TimestampFormat } from "../../appSettings";
import { formatLocaleDateTime } from "../../i18n/intl";
import { getTimestampFormatOptions } from "../../timestampFormat";
import {
  type ContextWindowSnapshot,
  formatContextWindowTokens,
  formatCostUsd,
} from "../../lib/contextWindow";
import type { RateLimitStatus } from "./RateLimitBanner";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { ContextWindowMeter } from "./ContextWindowMeter";
import { useTranslation } from "react-i18next";

function formatRateLimitMessage(
  rateLimitStatus: RateLimitStatus,
  language: string,
  timestampFormat: TimestampFormat,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const resetSuffix = rateLimitStatus.resetsAt
    ? t("health.rateLimit.resetsAt", {
        time: formatLocaleDateTime(
          rateLimitStatus.resetsAt,
          language,
          getTimestampFormatOptions(timestampFormat, false),
        ),
      })
    : "";
  if (rateLimitStatus.status === "rejected") {
    return t("health.rateLimit.reached", { reset: resetSuffix });
  }
  const utilizationSuffix =
    typeof rateLimitStatus.utilization === "number"
      ? t("health.rateLimit.utilization", {
          percent: Math.round(rateLimitStatus.utilization * 100),
        })
      : "";
  return t("health.rateLimit.approaching", {
    utilization: utilizationSuffix,
    reset: resetSuffix,
  });
}

function formatEnvironmentLabel(
  envMode: DraftThreadEnvMode,
  envState: ResolvedThreadWorkspaceState,
  t: (key: string) => string,
): string {
  if (envMode === "local") {
    return t("status.environment.local");
  }
  return envState === "worktree-pending"
    ? t("status.environment.pendingWorktree")
    : t("status.environment.worktree");
}

export function ComposerSlashStatusDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedModel: string | null | undefined;
  fastModeEnabled: boolean;
  selectedPromptEffort: string | null;
  interactionMode: ProviderInteractionMode;
  envMode: DraftThreadEnvMode;
  envState: ResolvedThreadWorkspaceState;
  branch: string | null;
  contextWindow: ContextWindowSnapshot | null;
  cumulativeCostUsd: number | null;
  rateLimitStatus: RateLimitStatus | null;
  activeContextWindowLabel?: string | null;
  pendingContextWindowLabel?: string | null;
  timestampFormat: TimestampFormat;
}) {
  const { t, i18n } = useTranslation(["chat", "common"]);
  const {
    open,
    onOpenChange,
    selectedModel,
    fastModeEnabled,
    selectedPromptEffort,
    interactionMode,
    envMode,
    envState,
    branch,
    contextWindow,
    cumulativeCostUsd,
    rateLimitStatus,
    activeContextWindowLabel,
    pendingContextWindowLabel,
  } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("status.title", { ns: "chat" })}</DialogTitle>
          <DialogDescription>{t("status.description", { ns: "chat" })}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("status.model", { ns: "chat" })}</p>
              <p className="font-medium text-foreground">{selectedModel}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {t("status.fastMode", { ns: "chat" })}
              </p>
              <p className="font-medium text-foreground">
                {fastModeEnabled ? t("status.on", { ns: "chat" }) : t("status.off", { ns: "chat" })}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {t("status.reasoning", { ns: "chat" })}
              </p>
              <p className="font-medium text-foreground">
                {selectedPromptEffort ?? t("traits.default", { ns: "chat" })}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("status.mode", { ns: "chat" })}</p>
              <p className="font-medium text-foreground">
                {interactionMode === "plan"
                  ? t("composer.plan.label", { ns: "chat" })
                  : t("traits.default", { ns: "chat" })}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {t("environment.title", { ns: "chat" })}
              </p>
              <p className="font-medium text-foreground">
                {formatEnvironmentLabel(envMode, envState, (key) => t(key, { ns: "chat" }))}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("status.branch", { ns: "chat" })}</p>
              <p className="font-medium text-foreground">
                {branch ?? t("context.unknown", { ns: "chat" })}
              </p>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border/60 bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("context.title", { ns: "chat" })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("status.contextDescription", { ns: "chat" })}
                </p>
                {pendingContextWindowLabel ? (
                  <p className="text-sm text-muted-foreground">
                    {t("context.windowTransition", {
                      ns: "chat",
                      current: activeContextWindowLabel ?? t("context.unknown", { ns: "chat" }),
                      next: pendingContextWindowLabel,
                    })}
                  </p>
                ) : null}
              </div>
              {contextWindow ? (
                <ContextWindowMeter
                  usage={contextWindow}
                  cumulativeCostUsd={cumulativeCostUsd}
                  activeWindowLabel={activeContextWindowLabel}
                  pendingWindowLabel={pendingContextWindowLabel}
                />
              ) : null}
            </div>
            {contextWindow ? (
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">{t("status.used", { ns: "chat" })}</p>
                  <p className="font-medium text-foreground">
                    {formatContextWindowTokens(contextWindow.usedTokens)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t("status.remaining", { ns: "chat" })}</p>
                  <p className="font-medium text-foreground">
                    {formatContextWindowTokens(contextWindow.remainingTokens)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t("status.window", { ns: "chat" })}</p>
                  <p className="font-medium text-foreground">
                    {formatContextWindowTokens(contextWindow.maxTokens)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">{t("status.cost", { ns: "chat" })}</p>
                  <p className="font-medium text-foreground">
                    {cumulativeCostUsd !== null
                      ? formatCostUsd(cumulativeCostUsd)
                      : t("status.notAvailable", { ns: "chat" })}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("status.noContext", { ns: "chat" })}
              </p>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">
              {t("status.rateLimits", { ns: "chat" })}
            </p>
            {rateLimitStatus ? (
              <p className="text-sm text-foreground">
                {formatRateLimitMessage(
                  rateLimitStatus,
                  i18n.resolvedLanguage ?? i18n.language,
                  props.timestampFormat,
                  (key, options) => t(key, { ns: "chat", ...options }),
                )}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("status.noRateLimit", { ns: "chat" })}
              </p>
            )}
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            {t("actions.close", { ns: "common" })}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
