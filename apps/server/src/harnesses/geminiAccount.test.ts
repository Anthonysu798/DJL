import { DEFAULT_SERVER_SETTINGS, type ServerSettings } from "@djl/contracts";
import { describe, expect, it } from "vitest";
import { buildHarnessInvocation } from "./accounts";
import { geminiSubscriptionEnvironment } from "./native/gemini";

const settingsWith = (gemini: { binaryPath?: string }): ServerSettings => ({
  ...DEFAULT_SERVER_SETTINGS,
  providers: {
    ...DEFAULT_SERVER_SETTINGS.providers,
    gemini: { ...DEFAULT_SERVER_SETTINGS.providers.gemini, ...gemini },
  },
});

describe("Gemini CLI account", () => {
  it("uses the configured binary and no login subcommand, and lets sign-in open a browser", () => {
    const settings = settingsWith({ binaryPath: "/opt/my tools/gemini" });
    const invocation = buildHarnessInvocation("gemini", settings, "/tmp/root", { PATH: "/bin" });
    expect(invocation.binary).toBe("/opt/my tools/gemini");
    expect(invocation.loginArgs).toEqual([]);
    expect(invocation.statusArgs).toEqual(["--version"]);
    // Sign-in runs the interactive CLI, which must be able to open the OAuth browser.
    expect(invocation.env.NO_BROWSER).toBeUndefined();
    expect(invocation.env.PATH).toBe("/bin");
  });
  it("blocks the browser for background agent sessions", () => {
    expect(geminiSubscriptionEnvironment({ PATH: "/bin" }).NO_BROWSER).toBe("true");
  });
  it("falls back to gemini on PATH", () => {
    const invocation = buildHarnessInvocation(
      "gemini",
      settingsWith({ binaryPath: "" }),
      "/tmp/root",
      {},
    );
    expect(invocation.binary).toBe("gemini");
  });
});
