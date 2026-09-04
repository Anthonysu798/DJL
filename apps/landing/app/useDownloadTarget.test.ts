import { describe, expect, it } from "vitest";

import { chinaMirrorHref, chinaMirrorTargets } from "./useDownloadTarget";

describe("chinaMirrorHref", () => {
  it.each([
    ["/download/windows", "/download/windows?mirror=cn"],
    ["/download/mac/arm64", "/download/mac/arm64?mirror=cn"],
  ])("requests the China mirror for %s", (href, expected) => {
    expect(chinaMirrorHref(href)).toBe(expected);
  });
});

describe("chinaMirrorTargets", () => {
  it("returns explicit macOS and Windows mirror downloads", () => {
    expect(
      chinaMirrorTargets({
        mac: "Download macOS from China",
        windows: "Download Windows from China",
      }),
    ).toEqual([
      {
        href: "/download/mac/arm64?mirror=cn",
        label: "Download macOS from China",
      },
      {
        href: "/download/windows?mirror=cn",
        label: "Download Windows from China",
      },
    ]);
  });
});
