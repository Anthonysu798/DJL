import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SERVER_SETTINGS } from "@synara/contracts";
const runtime = vi.hoisted(() => ({
  probe: vi.fn(),
  request: vi.fn(),
  close: vi.fn(),
  launch: vi.fn(),
}));
vi.mock("./accounts", async (original) => ({
  ...(await original<typeof import("./accounts")>()),
  probe: runtime.probe,
}));
vi.mock("./codexTerminalBinary", () => ({
  resolveCodexTerminalBinary: async (binary: string) => binary,
}));
vi.mock("node:fs/promises", () => ({ access: async () => {} }));
vi.mock("./native/protocol", () => ({
  NativeRpc: class {
    constructor(...args: unknown[]) {
      runtime.launch(...args);
    }
    request = runtime.request;
    close = runtime.close;
    notify() {}
  },
}));
import { readProfileAccount, parseProfileAccountOutput } from "./profileAccounts";

describe("CLI profile account identity", () => {
  it("uses each Codex profile's CLI environment and returns only status/email", async () => {
    runtime.request.mockImplementation(async (method: string) =>
      method === "initialize"
        ? {}
        : {
            account: {
              type: "chatgpt",
              email: "person@example.com",
              accessToken: "must-not-return",
            },
          },
    );
    const result = await readProfileAccount(
      { provider: "codex", profileId: "work-account" },
      DEFAULT_SERVER_SETTINGS,
      "/tmp/accounts",
    );
    expect(runtime.launch).toHaveBeenLastCalledWith(
      "codex",
      expect.arrayContaining(["app-server"]),
      "/tmp/accounts/codex/work-account",
      expect.objectContaining({ CODEX_HOME: "/tmp/accounts/codex/work-account" }),
    );
    expect(result).toEqual({
      provider: "codex",
      profileId: "work-account",
      status: "signedIn",
      email: "person@example.com",
    });
    expect(runtime.close).toHaveBeenCalled();
  });
  it.each([
    [null, "signedOut"],
    [{ type: "apiKey" }, "signedIn"],
    [{ type: "chatgpt", email: null }, "signedIn"],
    [{ type: "unknown-provider" }, "unknown"],
  ])("handles Codex identity without an email: %j", async (account, status) => {
    runtime.request.mockImplementation(async (method: string) =>
      method === "initialize" ? {} : { account },
    );
    expect(
      await readProfileAccount(
        { provider: "codex", profileId: "no-email" },
        DEFAULT_SERVER_SETTINGS,
        "/tmp/accounts",
      ),
    ).toMatchObject({ status, email: null });
  });
  it("does not return credential-bearing subprocess errors", async () => {
    runtime.request.mockRejectedValueOnce(new Error("access_token=must-stay-private"));
    const result = await readProfileAccount(
      { provider: "codex", profileId: "failed-probe" },
      DEFAULT_SERVER_SETTINGS,
      "/tmp/accounts",
    );
    expect(result).toMatchObject({ status: "unknown", email: null });
    expect(JSON.stringify(result)).not.toContain("must-stay-private");
  });
  it("reads Claude's email from its profile-scoped official CLI", async () => {
    runtime.probe.mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ loggedIn: true, email: "claude@example.com", token: "secret" }),
      stderr: "",
    });
    const result = await readProfileAccount(
      { provider: "claudeAgent", profileId: "personal" },
      DEFAULT_SERVER_SETTINGS,
      "/tmp/accounts",
    );
    expect(runtime.probe).toHaveBeenLastCalledWith(
      "claude",
      ["auth", "status"],
      expect.objectContaining({ CLAUDE_CONFIG_DIR: "/tmp/accounts/claudeAgent/personal" }),
    );
    expect(result.email).toBe("claude@example.com");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("does not reuse another profile's email or fall back to host credentials", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "host-secret");
    runtime.probe.mockResolvedValue({ code: 1, stdout: '{"loggedIn":false}', stderr: "" });
    try {
      expect(
        await readProfileAccount(
          { provider: "claudeAgent", profileId: "signed-out" },
          DEFAULT_SERVER_SETTINGS,
          "/tmp/accounts",
        ),
      ).toMatchObject({ status: "signedOut", email: null });
      expect(runtime.probe.mock.lastCall![2].ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("distinguishes signed-out, unavailable, unconfirmed and API-key identities", () => {
    expect(
      parseProfileAccountOutput("claudeAgent", {
        code: 1,
        stdout: '{"loggedIn":false,"email":"stale@example.com"}',
        stderr: "",
      }),
    ).toEqual({ status: "signedOut", email: null });
    expect(
      parseProfileAccountOutput("cursor", {
        code: 0,
        stdout: "Logged in as cursor@example.com",
        stderr: "",
      }),
    ).toEqual({ status: "signedIn", email: "cursor@example.com" });
    expect(
      parseProfileAccountOutput("cursor", { code: 1, stdout: "", stderr: "", missing: true })
        .status,
    ).toBe("unavailable");
    expect(
      parseProfileAccountOutput("opencode", { code: 0, stdout: "2 credentials", stderr: "" }),
    ).toEqual({ status: "signedIn", email: null });
    expect(
      parseProfileAccountOutput("claudeAgent", { code: 0, stdout: "not valid JSON", stderr: "" })
        .status,
    ).toBe("unknown");
  });
  it("rejects profile directory traversal before starting a CLI", async () => {
    await expect(
      readProfileAccount(
        { provider: "codex", profileId: "../another" },
        DEFAULT_SERVER_SETTINGS,
        "/tmp/accounts",
      ),
    ).rejects.toThrow();
  });
});
