import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fetchGrokLatestVersion, isOfficialGrokInstallation } from "./grokTools";

describe("official Grok tool maintenance", () => {
  it("reads the stable channel and falls back only to the official artifact host", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("0.2.14\n"));
    expect(await fetchGrokLatestVersion(fetcher)).toBe("0.2.14");
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "https://x.ai/cli/stable",
      "https://storage.googleapis.com/grok-build-public-artifacts/cli/stable",
    ]);
  });
  it("keeps malformed or unavailable upstream versions unknown", async () => {
    const fetcher = vi.fn(async () => new Response("<html>not a release</html>"));
    expect(await fetchGrokLatestVersion(fetcher)).toBeNull();
  });
  it("does not update a different or custom Grok installation", () => {
    const home = join(tmpdir(), "grok-owner");
    expect(isOfficialGrokInstallation(join(home, ".grok", "bin", "grok"), home)).toBe(true);
    expect(
      isOfficialGrokInstallation(join(home, ".grok", "downloads", "grok-linux-x86_64"), home),
    ).toBe(true);
    expect(isOfficialGrokInstallation(join(home, "custom", "grok"), home)).toBe(false);
    expect(isOfficialGrokInstallation(join(home, ".grok", "bin-other", "grok"), home)).toBe(false);
  });
});
