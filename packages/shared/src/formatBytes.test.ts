import { describe, expect, it } from "vitest";

import { formatBytes } from "./formatBytes";

describe("formatBytes", () => {
  it("uses the requested locale for the numeric part", () => {
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
    expect(formatBytes(1536, "fr")).toBe("1,5 KB");
  });

  it("preserves the locale-neutral default for non-UI callers", () => {
    expect(formatBytes(1024)).toBe("1 KB");
  });
});
