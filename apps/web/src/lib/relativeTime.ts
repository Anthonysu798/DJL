// FILE: relativeTime.ts
// Purpose: Compact relative-time labels ("now", "5m", "3h", "2d") for thread lists.
// Layer: Web UI utility

import { formatLocaleRelativeTime } from "~/i18n/intl";

export function formatRelativeTime(iso: string, locale: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(diff / 60_000);
  const options = { numeric: "auto", style: "short" } as const;
  if (minutes < 1) return formatLocaleRelativeTime(0, "second", locale, options);
  if (minutes < 60) return formatLocaleRelativeTime(-minutes, "minute", locale, options);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatLocaleRelativeTime(-hours, "hour", locale, options);
  return formatLocaleRelativeTime(-Math.floor(hours / 24), "day", locale, options);
}
