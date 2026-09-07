import { describe, expect, it, vi } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { DEFAULT_SERVER_SETTINGS } from "@synara/contracts";
import { buildHarnessInvocation, parseHarnessAccountStatus, probe } from "./accounts";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: vi.fn(),
  spawnSync: vi.fn(),
}));

describe("fresh harness accounts", () => {
  it("keeps native login with the official runtime and respects Codex home", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        codex: {
          ...DEFAULT_SERVER_SETTINGS.providers.codex,
          binaryPath: "/opt/Codex CLI/codex",
          homePath: "/tmp/codex-profile",
        },
      },
    };
    expect(buildHarnessInvocation("codex", settings, "/tmp/djl", {})).toMatchObject({
      binary: "/opt/Codex CLI/codex",
      loginArgs: ["login"],
      env: { CODEX_HOME: "/tmp/codex-profile" },
    });
  });
  it("uses the configured installed OpenCode and shares its account environment", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        opencode: {
          ...DEFAULT_SERVER_SETTINGS.providers.opencode,
          binaryPath: "/opt/OpenCode CLI/opencode",
        },
      },
    };
    const invocation = buildHarnessInvocation("opencode", settings, "/tmp/djl", {
      HOME: "/Users/example",
      XDG_DATA_HOME: "/shared/data",
      ANTHROPIC_API_KEY: "shared-key",
    });
    expect(invocation.binary).toBe("/opt/OpenCode CLI/opencode");
    expect(invocation.loginArgs).toEqual(["auth", "login"]);
    expect(invocation.env.XDG_DATA_HOME).toBe("/shared/data");
    expect(invocation.env.ANTHROPIC_API_KEY).toBe("shared-key");
    expect(invocation.env.DJL_MANAGED_AUTH).toBeUndefined();
  });
  it("wraps Windows npm shims without losing batch argument encoding", async () => {
    const exec = vi.mocked(execFile).mockImplementation(((
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, "codex 1.0", "");
      return {} as ReturnType<typeof execFile>;
    }) as typeof execFile);
    vi.mocked(spawnSync).mockReturnValue({
      stdout: "C:\\Program Files\\Codex\\codex.cmd\r\n",
      status: 0,
    } as ReturnType<typeof spawnSync>);
    try {
      await probe("codex", ["login", "status"], {}, "win32");
      await probe("C:\\Program Files\\Codex\\codex.cmd", ["login", "status"], {}, "win32");
      expect(exec).toHaveBeenCalledTimes(2);
      expect(exec).toHaveBeenCalledWith(
        "C:\\Windows\\System32\\cmd.exe",
        ["/d", "/s", "/v:off", "/c", 'call "C:\\Program Files\\Codex\\codex.cmd" "login" "status"'],
        expect.objectContaining({ shell: false, windowsVerbatimArguments: true }),
        expect.any(Function),
      );
    } finally {
      exec.mockRestore();
    }
  });
  it("does not expose account identifiers or credential data", () => {
    expect(
      parseHarnessAccountStatus("claudeAgent", {
        code: 0,
        stdout: JSON.stringify({
          loggedIn: true,
          email: "private@example.com",
          accessToken: "secret",
        }),
        stderr: "",
      }),
    ).toEqual("ready");
    expect(
      parseHarnessAccountStatus("codex", { code: 1, stdout: "", stderr: "Not logged in" }),
    ).toBe("required");
    expect(
      parseHarnessAccountStatus("cursor", { code: 0, stdout: "Unknown response", stderr: "" }),
    ).toBe("unknown");
  });
});
