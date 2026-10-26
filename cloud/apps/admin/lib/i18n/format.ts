import type { AdminLocale } from "./locale";

export function formatCredits(micro: string | bigint, locale: AdminLocale): string {
  const value = BigInt(micro);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  const parts = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 }).formatToParts(1);
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  return `${negative ? "-" : ""}${new Intl.NumberFormat(locale).format(whole)}${decimal}${fraction}`;
}

export const formatNumber = (
  value: number | bigint,
  locale: AdminLocale,
  options?: Intl.NumberFormatOptions,
) => new Intl.NumberFormat(locale, options).format(value);
export const formatDate = (
  value: Date | string,
  locale: AdminLocale,
  options?: Intl.DateTimeFormatOptions,
) => new Intl.DateTimeFormat(locale, options ?? { dateStyle: "medium" }).format(new Date(value));
export const formatTime = (value: Date | string, locale: AdminLocale) =>
  formatDate(value, locale, { timeStyle: "short" });
export const formatCurrency = (value: number, currency: string, locale: AdminLocale) =>
  formatNumber(value, locale, { style: "currency", currency });
export const formatPercent = (value: number, locale: AdminLocale) =>
  formatNumber(value, locale, { style: "percent", maximumFractionDigits: 1 });
export function formatBytes(value: number, locale: AdminLocale): string {
  const exponent =
    value > 0 ? Math.min(4, Math.max(0, Math.floor(Math.log(value) / Math.log(1024)))) : 0;
  return `${formatNumber(value / 1024 ** exponent, locale, { maximumFractionDigits: 1 })} ${["B", "KiB", "MiB", "GiB", "TiB"][exponent]}`;
}
