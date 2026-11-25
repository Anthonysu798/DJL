import { describe, expect, it } from "vitest";

import { fakeUsageLimitError } from "./devFakeUsageLimit";

const accountHome = "/data/userdata/terminal-accounts/codex/codex-89d2cee05a";

describe("fakeUsageLimitError", () => {
  it("is off unless DJL_DEV_FAKE_USAGE_LIMIT names accounts", () => {
    expect(
      fakeUsageLimitError("codex", { codex: { homePath: accountHome } }, undefined),
    ).toBeNull();
    expect(fakeUsageLimitError("codex", {}, " ")).toBeNull();
  });

  it("fails turns on the named added account", () => {
    const options = { codex: { homePath: accountHome } };
    expect(fakeUsageLimitError("codex", options, "codex-89d2cee05a")).toMatch(/usage limit/);
    expect(fakeUsageLimitError("codex", options, "default")).toBeNull();
  });

  it("treats a folder outside the added accounts as the normal sign-in", () => {
    expect(fakeUsageLimitError("codex", {}, "default")).toMatch(/usage limit/);
    expect(
      fakeUsageLimitError("codex", { codex: { homePath: "/Users/me/.codex" } }, "default"),
    ).toMatch(/usage limit/);
    expect(
      fakeUsageLimitError(
        "claudeAgent",
        { claudeAgent: { configDir: "/x/.claude" } },
        "codex-1, default",
      ),
    ).toMatch(/usage limit/);
  });
});
