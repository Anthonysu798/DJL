import { SOURCE_APP_LOCALE } from "@synara/contracts";
import { useTranslation } from "react-i18next";

type IntlFormatterKind = "date-time" | "number" | "relative-time";

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();
const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function selectedLocale(locale: string | null | undefined): string {
  return locale?.trim() || SOURCE_APP_LOCALE;
}

function stableOptions(options: object): string {
  return JSON.stringify(
    Object.entries(options)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function intlFormatterCacheKey(
  kind: IntlFormatterKind,
  locale: string,
  options: object,
): string {
  return `${kind}:${selectedLocale(locale)}:${stableOptions(options)}`;
}

export function formatLocaleDateTime(
  value: string | number | Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const key = intlFormatterCacheKey("date-time", locale, options);
  let formatter = dateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(selectedLocale(locale), options);
    dateTimeFormatters.set(key, formatter);
  }
  return formatter.format(value instanceof Date ? value : new Date(value));
}

export function formatLocaleNumber(
  value: number | bigint,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): string {
  const key = intlFormatterCacheKey("number", locale, options);
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(selectedLocale(locale), options);
    numberFormatters.set(key, formatter);
  }
  return formatter.format(value);
}

export function formatLocaleRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  locale: string,
  options: Intl.RelativeTimeFormatOptions = {},
): string {
  const key = intlFormatterCacheKey("relative-time", locale, options);
  let formatter = relativeTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(selectedLocale(locale), options);
    relativeTimeFormatters.set(key, formatter);
  }
  return formatter.format(value, unit);
}

/** Subscribes a component to i18next language changes and returns the resolved app locale. */
export function useSelectedLocale(): string {
  const { i18n } = useTranslation();
  return selectedLocale(i18n.resolvedLanguage || i18n.language);
}
