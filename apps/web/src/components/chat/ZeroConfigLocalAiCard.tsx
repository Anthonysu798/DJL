// FILE: ZeroConfigLocalAiCard.tsx
// Purpose: Props-driven composer card for preparing a recommended local AI without exposing
//          runtimes, model parameters, or other advanced setup concepts.
// Layer: Chat composer UI
// Exports: ZeroConfigLocalAiCard, ZeroConfigLocalAiCardProps, ZeroConfigLocalAiStatus

import type { LocalModelUseCase } from "@synara/contracts";
import { memo, useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "~/components/ui/button";
import { DeviceLaptopIcon, Loader2Icon, LockIcon, RefreshCwIcon, SparklesIcon } from "~/lib/icons";
import { LOCAL_MODEL_USE_CASES } from "~/lib/localModelUseCaseStore";
import { cn } from "~/lib/utils";

export type ZeroConfigLocalAiStatus =
  | "idle"
  | "checking"
  | "preparing"
  | "testing"
  | "falling_back"
  | "failed";

export interface ZeroConfigLocalAiCardProps {
  readonly status: ZeroConfigLocalAiStatus;
  readonly selectedUseCase: LocalModelUseCase;
  readonly recommendedModelName?: string | undefined;
  readonly estimatedDownloadLabel?: string | undefined;
  readonly deviceSummary?: string | undefined;
  readonly progressPercent?: number | undefined;
  readonly errorMessage?: string | undefined;
  readonly onUseCaseChange: (useCase: LocalModelUseCase) => void;
  readonly onPrepare: () => void;
  readonly onRetry: () => void;
}

const BUSY_STATUS_KEYS = {
  checking: "composer.zeroConfig.checking",
  preparing: "composer.zeroConfig.preparing",
  testing: "composer.zeroConfig.testing",
  falling_back: "composer.zeroConfig.fallingBack",
} as const;

export const ZeroConfigLocalAiCard = memo(function ZeroConfigLocalAiCard({
  status,
  selectedUseCase,
  recommendedModelName,
  estimatedDownloadLabel,
  deviceSummary,
  progressPercent,
  errorMessage,
  onUseCaseChange,
  onPrepare,
  onRetry,
}: ZeroConfigLocalAiCardProps) {
  const { t } = useTranslation("chat");
  const headingId = useId();
  const useCaseLabelId = useId();
  const useCaseGroupName = useId();
  const isFailed = status === "failed";
  const isBusy = status !== "idle" && !isFailed;
  const statusLabel = isBusy ? t(BUSY_STATUS_KEYS[status]) : null;
  const normalizedProgress =
    isBusy && typeof progressPercent === "number" && Number.isFinite(progressPercent)
      ? Math.max(0, Math.min(100, Math.round(progressPercent)))
      : null;

  return (
    <section
      data-onboarding-target="local-ai-card"
      className={cn(
        "w-full overflow-hidden rounded-xl border px-4 py-4",
        isFailed
          ? "border-destructive/25 bg-destructive/[0.025]"
          : "border-primary/20 bg-primary/[0.035]",
      )}
      aria-labelledby={headingId}
      aria-busy={isBusy}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl",
            isFailed ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
          )}
        >
          {isBusy ? (
            <Loader2Icon className="size-4.5 animate-spin" aria-hidden />
          ) : isFailed ? (
            <RefreshCwIcon className="size-4.5" aria-hidden />
          ) : (
            <SparklesIcon className="size-4.5" aria-hidden />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-sm font-medium text-foreground">
            {t("composer.zeroConfig.placeholder")}
          </h2>

          {isBusy && statusLabel ? (
            <p
              className="mt-1 text-xs font-medium text-primary"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {statusLabel}
              {normalizedProgress !== null ? ` · ${normalizedProgress}%` : null}
            </p>
          ) : isFailed ? (
            <div className="mt-1" role="alert">
              <p className="text-xs font-medium text-destructive">
                {t("composer.zeroConfig.failed")}
              </p>
              {errorMessage ? (
                <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                  {errorMessage}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <p id={useCaseLabelId} className="text-xs font-medium text-foreground">
          {t("composer.zeroConfig.useCaseLabel")}
        </p>
        <div
          data-onboarding-target="local-ai-purpose"
          className="mt-2 grid grid-cols-2 gap-2"
          role="radiogroup"
          aria-labelledby={useCaseLabelId}
          aria-disabled={isBusy}
        >
          {LOCAL_MODEL_USE_CASES.map((useCase) => {
            const isSelected = selectedUseCase === useCase;
            const optionId = `${useCaseGroupName}-${useCase}`;
            return (
              <div
                key={useCase}
                className={cn(
                  "min-w-0 rounded-lg border bg-background/55 transition-colors",
                  "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                  isSelected
                    ? "border-primary/55 bg-primary/10"
                    : "border-border/70 bg-background/55 hover:border-primary/30 hover:bg-background",
                  isBusy && "cursor-not-allowed opacity-65",
                )}
              >
                <input
                  id={optionId}
                  className="sr-only"
                  type="radio"
                  name={useCaseGroupName}
                  value={useCase}
                  checked={isSelected}
                  disabled={isBusy}
                  onChange={() => onUseCaseChange(useCase)}
                />
                <label
                  htmlFor={optionId}
                  className={cn(
                    "block px-3 py-2.5 text-left",
                    isBusy ? "cursor-not-allowed" : "cursor-pointer",
                  )}
                >
                  <span className="block truncate text-xs font-medium text-foreground">
                    {t(`composer.zeroConfig.useCases.${useCase}.label`)}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    {t(`composer.zeroConfig.useCases.${useCase}.description`)}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      </div>

      {deviceSummary || recommendedModelName || estimatedDownloadLabel ? (
        <ul
          data-onboarding-target="local-ai-device"
          className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2"
        >
          {deviceSummary ? (
            <li className="flex min-w-0 items-start gap-2 rounded-lg bg-background/55 px-2.5 py-2">
              <DeviceLaptopIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                {t("composer.zeroConfig.device", { summary: deviceSummary })}
              </span>
            </li>
          ) : null}
          {recommendedModelName ? (
            <li className="flex min-w-0 items-start gap-2 rounded-lg bg-background/55 px-2.5 py-2">
              <SparklesIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words text-foreground/80">
                {t("composer.zeroConfig.recommended", {
                  category: t(`composer.zeroConfig.useCases.${selectedUseCase}.label`),
                  model: recommendedModelName,
                })}
              </span>
            </li>
          ) : null}
          {estimatedDownloadLabel ? (
            <li className="min-w-0 rounded-lg bg-background/55 px-2.5 py-2 sm:col-span-2">
              {t("composer.zeroConfig.download", { size: estimatedDownloadLabel })}
            </li>
          ) : null}
        </ul>
      ) : null}

      {isBusy ? (
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={statusLabel ?? undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={normalizedProgress ?? undefined}
        >
          <div
            className={cn(
              "h-full rounded-full bg-primary transition-[width]",
              normalizedProgress === null && "w-1/3 animate-pulse",
            )}
            style={normalizedProgress === null ? undefined : { width: `${normalizedProgress}%` }}
          />
        </div>
      ) : null}

      <div
        data-onboarding-target="local-ai-prepare"
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="flex min-w-0 items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <LockIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>{t("composer.zeroConfig.privacy")}</span>
        </p>

        {isFailed ? (
          <Button type="button" size="sm" className="w-full sm:w-auto" onClick={onRetry}>
            <RefreshCwIcon aria-hidden />
            {t("composer.zeroConfig.retry")}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="w-full sm:w-auto"
            disabled={isBusy}
            onClick={onPrepare}
          >
            {isBusy ? (
              <Loader2Icon className="animate-spin" aria-hidden />
            ) : (
              <SparklesIcon aria-hidden />
            )}
            {statusLabel ?? t("composer.zeroConfig.action")}
          </Button>
        )}
      </div>
    </section>
  );
});
