import { type TimestampFormat } from "./appSettings";
import { formatLocaleDateTime } from "./i18n/intl";

export function getTimestampFormatOptions(
  timestampFormat: TimestampFormat,
  includeSeconds: boolean,
): Intl.DateTimeFormatOptions {
  const baseOptions: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
  };

  if (timestampFormat === "locale") {
    return baseOptions;
  }

  return {
    ...baseOptions,
    hour12: timestampFormat === "12-hour",
  };
}

export function formatTimestamp(
  isoDate: string,
  timestampFormat: TimestampFormat,
  locale: string,
  timeZone?: string,
): string {
  return formatLocaleDateTime(isoDate, locale, {
    ...getTimestampFormatOptions(timestampFormat, true),
    timeZone,
  });
}

export function formatShortTimestamp(
  isoDate: string,
  timestampFormat: TimestampFormat,
  locale: string,
  timeZone?: string,
): string {
  return formatLocaleDateTime(isoDate, locale, {
    ...getTimestampFormatOptions(timestampFormat, false),
    timeZone,
  });
}
