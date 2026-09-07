import { describe, expect, it } from "vitest";
import { parseCursorRelease, cursorVersionStatus } from "./cursorTools";

describe("Cursor tool versions", () => {
  it("reads the full release identifier from the official installer", () => {
    expect(
      parseCursorRelease(
        'DOWNLOAD_URL="https://downloads.cursor.com/lab/2026.09.02-c22c1a3/${OS}/${ARCH}/agent-cli-package.tar.gz"',
      ),
    ).toBe("2026.09.02-c22c1a3");
    expect(parseCursorRelease("error page")).toBeNull();
  });
  it("does not order build hashes as semantic prerelease versions", () => {
    expect(cursorVersionStatus("2026.09.02-ffffff0", "2026.09.02-0000001")).toBe("behind_latest");
    expect(cursorVersionStatus("2026.09.03-0000001", "2026.09.02-ffffff0")).toBe("current");
    expect(cursorVersionStatus("2026.09.02-ffffff0", "2026.09.02-ffffff0")).toBe("current");
    expect(cursorVersionStatus(null, "2026.09.02-ffffff0")).toBe("unknown");
  });
});
