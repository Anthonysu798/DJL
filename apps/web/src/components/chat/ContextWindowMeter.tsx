import {
  type ContextWindowSnapshot,
  deriveContextWindowMeterDisplay,
  formatContextWindowTokens,
  formatCostUsd,
} from "~/lib/contextWindow";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { useTranslation } from "react-i18next";

export function ContextWindowMeter(props: {
  usage: ContextWindowSnapshot;
  cumulativeCostUsd?: number | null | undefined;
  activeWindowLabel?: string | null | undefined;
  pendingWindowLabel?: string | null | undefined;
}) {
  const { t } = useTranslation("chat");
  const { usage, cumulativeCostUsd, activeWindowLabel, pendingWindowLabel } = props;
  const display = deriveContextWindowMeterDisplay(usage);
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (display.normalizedPercentage / 100) * circumference;

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className="group inline-flex shrink-0 items-center justify-center rounded-full p-0.5 transition-opacity hover:opacity-80"
            aria-label={t("context.ariaLabel", {
              usage: display.usedPercentageLabel ?? display.tokenUsageLabel,
            })}
          >
            <span className="relative flex h-4 w-4 items-center justify-center">
              <svg
                viewBox="0 0 16 16"
                className="-rotate-90 absolute inset-0 h-full w-full transform-gpu"
                aria-hidden="true"
              >
                <circle
                  cx="8"
                  cy="8"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-muted-foreground/25 dark:text-muted-foreground/40"
                />
                <circle
                  cx="8"
                  cy="8"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="text-primary transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none dark:text-[var(--color-text-foreground)]"
                />
              </svg>
            </span>
          </button>
        }
      />
      <PopoverPopup tooltipStyle side="top" align="end" className="w-max max-w-none px-3 py-2">
        <div className="space-y-1.5 leading-tight">
          <div className="text-[11px] font-medium text-muted-foreground">{t("context.title")}</div>
          {pendingWindowLabel ? (
            <div className="text-xs text-muted-foreground">
              {t("context.currentSession", { window: activeWindowLabel ?? t("context.unknown") })}
            </div>
          ) : null}
          {display.usedPercentageLabel ? (
            <div className="whitespace-nowrap text-xs font-medium text-foreground">
              <span>{display.usedPercentageLabel}</span>
              {display.hasReliableTokenRatio ? (
                <>
                  <span className="mx-1">⋅</span>
                  <span>{display.tokenUsageLabel}</span>
                  <span>/</span>
                  <span>
                    {t("context.usedWithMaximum", {
                      maximum: formatContextWindowTokens(usage.maxTokens),
                    })}
                  </span>
                </>
              ) : (
                <span className="ml-1">{t("context.used")}</span>
              )}
            </div>
          ) : (
            <div className="text-sm text-foreground">
              {t("context.tokensUsed", { tokens: display.tokenUsageLabel })}
            </div>
          )}
          {usage.maxTokens !== null ? (
            <div className="text-xs text-muted-foreground">
              {t("context.modelWindow", {
                tokens: formatContextWindowTokens(usage.maxTokens),
              })}
            </div>
          ) : null}
          {pendingWindowLabel ? (
            <div className="text-xs text-muted-foreground">
              {t("context.nextTurn", { window: pendingWindowLabel })}
            </div>
          ) : null}
          {(usage.totalProcessedTokens ?? null) !== null &&
          (usage.totalProcessedTokens ?? 0) > usage.usedTokens ? (
            <div className="text-xs text-muted-foreground">
              {t("context.totalProcessed", {
                tokens: formatContextWindowTokens(usage.totalProcessedTokens ?? null),
              })}
            </div>
          ) : null}
          {usage.compactsAutomatically ? (
            <div className="text-xs text-muted-foreground">{t("context.autoCompact")}</div>
          ) : null}
          {cumulativeCostUsd !== null && cumulativeCostUsd !== undefined ? (
            <div className="text-xs text-muted-foreground">
              {t("context.sessionCost", { cost: formatCostUsd(cumulativeCostUsd) })}
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
