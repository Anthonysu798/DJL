import { describe, expect, it } from "vitest";
import { resolveVpsDesktopDownload, type DesktopDownloadTarget } from "./vpsDesktopDownloads";

describe("resolveVpsDesktopDownload", () => {
  it.each([
    [
      { platform: "windows", arch: "x64" },
      "https://downloads.slcor.com/download/windows",
    ],
    [
      { platform: "mac", arch: "arm64" },
      "https://downloads.slcor.com/download/mac/arm64",
    ],
    [{ platform: "mac", arch: "x64" }, "https://downloads.slcor.com/download/mac/x64"],
  ] satisfies ReadonlyArray<[DesktopDownloadTarget, string]>)(
    "maps %o to the stable VPS endpoint",
    (target, expected) => {
      expect(resolveVpsDesktopDownload(target)).toBe(expected);
    },
  );
});
