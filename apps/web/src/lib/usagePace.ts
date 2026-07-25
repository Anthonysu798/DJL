// FILE: usagePace.ts
// Purpose: Derive OpenUsage-style quota pace indicators from percent-used windows.
// Used by Settings usage meters to show reserve/deficit and projected run-out timing.

import type { TFunction } from "i18next";
import englishCatalog from "~/i18n/locales/en.json";
import { formatLocaleNumber } from "~/i18n/intl";

export type UsagePaceStatus = "ahead" | "on-track" | "behind";

export interface UsagePaceSummary {
  status: UsagePaceStatus;
  expectedRemainingPercent: number;
  amountText: string | null;
  etaText: string | null;
}

const MIN_PROJECTION_ELAPSED_FRACTION = 0.05;

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

type PaceCopyKey = Exclude<keyof typeof englishCatalog.settings.usage.pace, "status">;

function paceText(
  key: PaceCopyKey,
  values: Record<string, string | number> = {},
  t?: TFunction,
): string {
  const defaultValue = englishCatalog.settings.usage.pace[key];
  if (t) return t(`usage.pace.${key}`, { ns: "settings", defaultValue, ...values });
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
    defaultValue,
  );
}

function compactDuration(deltaMs: number, t?: TFunction): string | null {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return null;
  }
  const totalMinutes = Math.floor(deltaMs / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return paceText("durationDaysHours", { days, hours }, t);
  }
  if (hours > 0) {
    return paceText("durationHoursMinutes", { hours, minutes }, t);
  }
  if (minutes > 0) {
    return paceText("durationMinutes", { minutes }, t);
  }
  return paceText("durationLessThanMinute", {}, t);
}

function paceStatus(usedPercent: number, projectedUsedPercent: number): UsagePaceStatus {
  if (usedPercent >= 100) {
    return "behind";
  }
  if (usedPercent === 0 || projectedUsedPercent <= 80) {
    return "ahead";
  }
  if (projectedUsedPercent <= 100) {
    return "on-track";
  }
  return "behind";
}

function reserveOrDeficitText(deltaPercent: number, locale?: string, t?: TFunction): string | null {
  const rounded = Math.round(Math.abs(deltaPercent));
  if (rounded <= 0) {
    return null;
  }
  const percent = formatLocaleNumber(rounded / 100, locale ?? "en", {
    style: "percent",
    maximumFractionDigits: 0,
  });
  return paceText(deltaPercent > 0 ? "inDeficit" : "inReserve", { percent }, t);
}

export function deriveUsagePace(input: {
  nowMs?: number | undefined;
  remainingPercent: number;
  resetsAt?: string | undefined;
  windowDurationMins?: number | undefined;
  locale?: string | undefined;
  t?: TFunction | undefined;
}): UsagePaceSummary | null {
  if (!input.resetsAt || input.windowDurationMins === undefined) {
    return null;
  }
  const resetMs = Date.parse(input.resetsAt);
  const durationMs = input.windowDurationMins * 60_000;
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(resetMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }

  const periodStartMs = resetMs - durationMs;
  const elapsedMs = nowMs - periodStartMs;
  if (elapsedMs <= 0 || nowMs >= resetMs) {
    return null;
  }

  const usedPercent = clampPercent(100 - input.remainingPercent);
  const elapsedFraction = Math.max(elapsedMs / durationMs, MIN_PROJECTION_ELAPSED_FRACTION);

  const expectedUsedPercent = clampPercent(elapsedFraction * 100);
  const expectedRemainingPercent = clampPercent(100 - expectedUsedPercent);
  const projectedUsedPercent = usedPercent === 0 ? 0 : usedPercent / elapsedFraction;
  const status = paceStatus(usedPercent, projectedUsedPercent);
  const deltaPercent = usedPercent - expectedUsedPercent;
  const amountText = reserveOrDeficitText(deltaPercent, input.locale, input.t);

  let etaText = status === "behind" ? null : paceText("lastsUntilReset", {}, input.t);
  if (status === "behind") {
    const ratePercentPerMs = projectedUsedPercent / durationMs;
    const etaMs = ratePercentPerMs > 0 ? (100 - usedPercent) / ratePercentPerMs : 0;
    const remainingMs = resetMs - nowMs;
    const durationText = etaMs > 0 && etaMs < remainingMs ? compactDuration(etaMs, input.t) : null;
    etaText =
      usedPercent >= 100
        ? paceText("limitReached", {}, input.t)
        : durationText
          ? paceText("runsOutIn", { duration: durationText }, input.t)
          : null;
  }

  return {
    status,
    expectedRemainingPercent,
    amountText,
    etaText,
  };
}
