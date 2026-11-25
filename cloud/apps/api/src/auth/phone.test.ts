import { describe, expect, it } from "vitest";

import { normalizePhoneNumber } from "./phone.ts";

describe("normalizePhoneNumber", () => {
  it("gives every spelling of a number the same E.164 form", () => {
    for (const spelling of [
      "+14155550100",
      "+1 415 555 0100",
      "+1-415-555-0100",
      "+1 (415) 555.0100",
      " +1415 5550100 ",
    ])
      expect(normalizePhoneNumber(spelling)).toBe("+14155550100");
  });

  it("rejects anything that is not an international number", () => {
    for (const malformed of [
      "",
      "4155550100",
      "0014155550100",
      "+0415555010",
      "+14155",
      "+1415555010012345",
      "+1415555010a",
      "++14155550100",
      "+1415555０１００",
      "+14155550100;ext=1",
    ])
      expect(normalizePhoneNumber(malformed)).toBeNull();
  });
});
