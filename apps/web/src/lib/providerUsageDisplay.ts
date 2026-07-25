// FILE: providerUsageDisplay.ts
// Purpose: Single source of truth for provider usage rows shown in Settings,
// the chat header usage chip, and compact environment/Local popovers.

import {
  deriveVisibleRateLimitRows,
  formatRateLimitRemainingPercent,
  formatRateLimitResetCountdown,
  formatRateLimitWindowLabel,
  type ProviderRateLimit,
  type VisibleRateLimitRow,
} from "~/lib/rateLimits";
import type { TFunction } from "i18next";
import englishCatalog from "~/i18n/locales/en.json";
import { deriveUsagePace, type UsagePaceSummary } from "~/lib/usagePace";

export type ProviderUsageTone = "healthy" | "warning" | "danger";

export interface ProviderUsageDisplayRow extends VisibleRateLimitRow {
  remainingLabel: string;
  leftText: string;
  resetText: string | null;
  pace: UsagePaceSummary | null;
  markerPercent: number | null;
  remainingTone: ProviderUsageTone;
  paceTone: ProviderUsageTone;
}

export interface ProviderUsageProgressTrackProps {
  label: string;
  remainingPercent: number;
  markerPercent: number | null;
  fillClassName: string;
  markerClassName: string;
}

export interface ProviderUsagePaceDetails {
  amountText: string | null;
  etaText: string | null;
}

export const PROVIDER_USAGE_TONE_CLASS_NAME: Record<ProviderUsageTone, string> = {
  healthy: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
};

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function remainingTone(remainingPercent: number): ProviderUsageTone {
  if (remainingPercent <= 10) return "danger";
  if (remainingPercent <= 25) return "warning";
  return "healthy";
}

function paceTone(status: UsagePaceSummary["status"]): ProviderUsageTone {
  switch (status) {
    case "behind":
      return "danger";
    case "on-track":
      return "warning";
    case "ahead":
      return "healthy";
  }
}

function windowDurationMinsForRow(row: VisibleRateLimitRow): number | undefined {
  if (row.windowDurationMins !== undefined) {
    return row.windowDurationMins;
  }
  if (row.label === "5h") {
    return 300;
  }
  if (row.label === "Weekly") {
    return 10_080;
  }
  return undefined;
}

export function providerUsageToneClassName(tone: ProviderUsageTone): string {
  return PROVIDER_USAGE_TONE_CLASS_NAME[tone];
}

export function providerUsageProgressTrackProps(
  row: ProviderUsageDisplayRow,
  t?: TFunction,
): ProviderUsageProgressTrackProps {
  const defaultValue = englishCatalog.settings.usage.remainingAriaLabel;
  return {
    label: t
      ? t("usage.remainingAriaLabel", {
          ns: "settings",
          defaultValue,
          label: row.label,
          remaining: row.remainingLabel,
        })
      : defaultValue
          .replaceAll("{{label}}", row.label)
          .replaceAll("{{remaining}}", row.remainingLabel),
    remainingPercent: row.remainingPercent,
    markerPercent: row.markerPercent,
    fillClassName: providerUsageToneClassName(row.remainingTone),
    markerClassName: providerUsageToneClassName(row.paceTone),
  };
}

export function providerUsagePaceDetails(
  row: ProviderUsageDisplayRow,
): ProviderUsagePaceDetails | null {
  if (!row.pace?.amountText && !row.pace?.etaText) {
    return null;
  }
  return {
    amountText: row.pace.amountText,
    etaText: row.pace.etaText,
  };
}

export function deriveProviderUsageDisplayRow(
  row: VisibleRateLimitRow,
  options: { t?: TFunction; locale?: string } = {},
): ProviderUsageDisplayRow {
  const remainingPercent = clampPercent(row.remainingPercent);
  const pace = deriveUsagePace({
    remainingPercent,
    resetsAt: row.resetsAt,
    windowDurationMins: windowDurationMinsForRow(row),
    locale: options.locale,
    t: options.t,
  });
  const remainingLabel = formatRateLimitRemainingPercent(remainingPercent, options.locale);
  const defaultLeft = englishCatalog.settings.usage.left;
  const leftText = options.t
    ? options.t("usage.left", {
        ns: "settings",
        defaultValue: defaultLeft,
        remaining: remainingLabel,
      })
    : defaultLeft.replaceAll("{{remaining}}", remainingLabel);
  const usageRemainingTone = remainingTone(remainingPercent);
  const usagePaceTone = pace ? paceTone(pace.status) : usageRemainingTone;

  return {
    ...row,
    label: formatRateLimitWindowLabel(row.label, options.t),
    remainingPercent,
    remainingLabel,
    leftText,
    resetText: row.resetsAt ? formatRateLimitResetCountdown(row.resetsAt, options.t) : null,
    pace,
    markerPercent: pace ? clampPercent(pace.expectedRemainingPercent) : null,
    remainingTone: usageRemainingTone,
    paceTone: usagePaceTone,
  };
}

export function deriveProviderUsageDisplayRows(
  rateLimits: ReadonlyArray<ProviderRateLimit>,
  options: { t?: TFunction; locale?: string } = {},
): ProviderUsageDisplayRow[] {
  return deriveVisibleRateLimitRows(rateLimits).map((row) =>
    deriveProviderUsageDisplayRow(row, options),
  );
}

export function selectPrimaryProviderUsageDisplayRow(
  rows: ReadonlyArray<ProviderUsageDisplayRow>,
): ProviderUsageDisplayRow | null {
  return rows.reduce<ProviderUsageDisplayRow | null>((selected, row) => {
    if (!selected || row.remainingPercent < selected.remainingPercent) {
      return row;
    }
    return selected;
  }, null);
}
