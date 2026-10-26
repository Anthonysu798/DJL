import { describe, expect, it } from "vitest";
import { csvCell } from "./export.ts";

describe("analytics CSV export", () => {
  it("neutralizes formulas, tab/carriage prefixes and correctly quotes data", () => {
    for (const value of ["=1+1", "+SUM(A1)", "-1+2", "@data", "\tprivate", "\rprivate", "  =1+1"])
      expect(csvCell(value).startsWith("\"'")).toBe(true);
    expect(csvCell('asset, "test"')).toBe('"asset, ""test"""');
    expect(csvCell("42")).toBe('"42"');
  });
});
