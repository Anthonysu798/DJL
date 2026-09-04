import { describe, expect, it } from "vitest";

import { readRequestedMirror } from "./downloadRegion";

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
