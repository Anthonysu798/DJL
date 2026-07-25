import { describe, expect, it } from "vitest";

import { formatCompact, formatNumber, formatShortDate } from "./profileFormatting";

describe("profileFormatting", () => {
  it("uses the selected locale for compact and full numbers", () => {
    expect(formatCompact(1_200, "en")).toBe("1.2K");
    expect(formatCompact(1_200, "fr")).toBe("1,2 k");
    expect(formatNumber(4_934, "en")).toBe("4,934");
    expect(formatNumber(4_934, "fr")).toBe("4 934");
  });

  it("keeps a UTC heatmap day stable in the St. John's timezone", () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = "America/St_Johns";
    try {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("America/St_Johns");
      expect(formatShortDate("2026-04-03", "en")).toBe("Apr 3");
      expect(formatShortDate("2026-04-03", "fr")).toBe("3 avr.");
    } finally {
      if (originalTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimeZone;
      }
    }
  });
});
