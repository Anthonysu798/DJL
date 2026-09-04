import { describe, expect, it } from "vitest";

import { chinaMirrorHref } from "./useDownloadTarget";

describe("chinaMirrorHref", () => {
  it.each([
    ["/download/windows", "/download/windows?mirror=cn"],
    ["/download/mac/arm64", "/download/mac/arm64?mirror=cn"],
  ])("requests the China mirror for %s", (href, expected) => {
    expect(chinaMirrorHref(href)).toBe(expected);
  });
});
