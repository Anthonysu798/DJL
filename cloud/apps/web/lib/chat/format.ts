import type { CloudUsageWindow } from "@synara/contracts/cloud";

import type { Locale } from "@/lib/i18n";

const intlLocale = (locale: Locale) => (locale === "zh-Hans" ? "zh-CN" : "en-US");

/** "in 2 hours (5:00 PM)", or with a weekday when it's more than a day away. */
export function formatWhen(iso: string, locale: Locale, now = Date.now()): string {
  const at = Date.parse(iso);
  const diff = at - now;
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  const minutes = Math.round(diff / 60_000);
  const relative =
    Math.abs(minutes) < 60
      ? rtf.format(Math.max(1, minutes), "minute")
      : Math.abs(minutes) < 48 * 60
        ? rtf.format(Math.round(minutes / 60), "hour")
        : rtf.format(Math.round(minutes / (24 * 60)), "day");
  const clock = new Intl.DateTimeFormat(intlLocale(locale), {
    ...(diff > 24 * 3_600_000 ? { weekday: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
  return locale === "zh-Hans" ? `${relative}（${clock}）` : `${relative} (${clock})`;
}

export function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(
    Date.parse(iso),
  );
}

/** Share of the window spent, 0–100. Microcredit strings can exceed 2^53, so this divides as BigInt. */
export function percentUsed(window: CloudUsageWindow): number {
  const limit = BigInt(window.limit);
  if (limit <= 0n) return 0;
  const pct = Number((BigInt(window.used) * 1000n) / limit) / 10;
  return Math.min(100, Math.max(0, pct));
}
