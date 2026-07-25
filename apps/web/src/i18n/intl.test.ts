import { describe, expect, it } from "vitest";

import {
  formatLocaleDateTime,
  formatLocaleNumber,
  formatLocaleRelativeTime,
  intlFormatterCacheKey,
} from "./intl";

describe("selected-locale Intl formatting", () => {
  it("includes the selected locale in formatter cache keys", () => {
    const options = { maximumFractionDigits: 1 } as const;
    expect(intlFormatterCacheKey("number", "en", options)).not.toBe(
      intlFormatterCacheKey("number", "fr", options),
    );
  });

  it("formats numbers and dates with the explicit selected locale", () => {
    expect(formatLocaleNumber(12_345.5, "en", { maximumFractionDigits: 1 })).toBe("12,345.5");
    expect(formatLocaleNumber(12_345.5, "fr", { maximumFractionDigits: 1 })).toMatch(
      /^12[\s\u202f]345,5$/,
    );
    expect(
      formatLocaleDateTime("2026-07-15T13:05:00.000Z", "en", {
        hour: "numeric",
        hour12: false,
        minute: "2-digit",
        timeZone: "UTC",
      }),
    ).toBe("13:05");
  });

  it("uses Intl relative-time grammar for each selected locale", () => {
    expect(formatLocaleRelativeTime(-5, "minute", "en", { numeric: "auto" })).toBe("5 minutes ago");
    expect(formatLocaleRelativeTime(-5, "minute", "fr", { numeric: "auto" })).toContain("5");
    expect(formatLocaleRelativeTime(-5, "minute", "fr", { numeric: "auto" })).not.toBe(
      "5 minutes ago",
    );
  });
});
