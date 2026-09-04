import { describe, expect, it } from "vitest";

import { readRequestedMirror, readVisitorCountry } from "./downloadRegion";

describe("readRequestedMirror", () => {
  it("accepts only the explicit China mirror request", () => {
    expect(readRequestedMirror(new Request("https://djl.test/download/windows?mirror=cn"))).toBe(
      "cn",
    );
    expect(readRequestedMirror(new Request("https://djl.test/download/windows"))).toBeNull();
    expect(
      readRequestedMirror(new Request("https://djl.test/download/windows?mirror=other")),
    ).toBeNull();
  });
});

describe("readVisitorCountry", () => {
  it("normalizes Vercel's country header and rejects unsafe values", () => {
    expect(
      readVisitorCountry(
        new Request("https://djl.test", { headers: { "x-vercel-ip-country": "ca" } }),
      ),
    ).toBe("CA");
    expect(readVisitorCountry(new Request("https://djl.test"))).toBeNull();
    expect(
      readVisitorCountry(
        new Request("https://djl.test", { headers: { "x-vercel-ip-country": "Canada" } }),
      ),
    ).toBeNull();
  });
});
