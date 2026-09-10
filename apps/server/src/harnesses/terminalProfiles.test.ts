import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SERVER_SETTINGS } from "@synara/contracts";
import { Effect } from "effect";
import { buildProfileTerminalLaunch, openProfileTerminal } from "./terminalProfiles";

const baseEnv = {
  PATH: "/usr/bin",
  CODEX_HOME: "/personal/codex",
  ANTHROPIC_API_KEY: "host-secret",
  CLAUDE_CODE_OAUTH_TOKEN: "host-token",
  CURSOR_API_KEY: "host-cursor",
  OPENAI_API_KEY: "host-openai",
  CLAUDECODE: "1",
};
const launch = (
  provider: "codex" | "claudeAgent" | "cursor" | "opencode",
  id = "account-a",
  action: "run" | "login" | "status" = "run",
) =>
  buildProfileTerminalLaunch(
    { provider, profileId: id, action },
    DEFAULT_SERVER_SETTINGS,
    "/tmp/djl-profiles",
    baseEnv,
  );

describe("workspace subscription profiles", () => {
  it("reattaches a running profile without preparing files or discovering executables again", async () => {
    const input = {
      threadId: "w",
      terminalId: "t",
      cwd: "/tmp",
      agentProfile: { provider: "codex", profileId: "account-a", action: "run" },
    } as const;
    const snapshot = {
      ...input,
      status: "running",
      pid: 1,
      history: "",
      exitCode: null,
      exitSignal: null,
      updatedAt: "now",
    } as const;
    const manager = {
      isRunning: vi.fn(() => Effect.succeed(true)),
      open: vi.fn(() => Effect.succeed(snapshot)),
    };
    expect(
      await Effect.runPromise(
        openProfileTerminal(
          input,
          DEFAULT_SERVER_SETTINGS,
          "/nonexistent/read-only/profile",
          manager,
        ),
      ),
    ).toEqual(snapshot);
    expect(manager.open).toHaveBeenCalledExactlyOnceWith(input);
  });
  it("shares Codex credentials while separating concurrent terminal databases", () => {
    const profile = { provider: "codex", profileId: "account-a", action: "run" } as const;
    const first = buildProfileTerminalLaunch(
      profile,
      DEFAULT_SERVER_SETTINGS,
      "/tmp/djl-profiles",
      baseEnv,
      "workspace::one",
    );
    const second = buildProfileTerminalLaunch(
      profile,
      DEFAULT_SERVER_SETTINGS,
      "/tmp/djl-profiles",
      baseEnv,
      "workspace::two",
    );
    expect(first.env.CODEX_HOME).toBe(second.env.CODEX_HOME);
    expect(first.env.CODEX_SQLITE_HOME).not.toBe(second.env.CODEX_SQLITE_HOME);
    expect(first.env.CODEX_SQLITE_HOME).toContain("/terminals/");
  });
  it.each(["codex", "claudeAgent", "cursor", "opencode"] as const)(
    "isolates two %s accounts and reuses the same account for ten terminals",
    (provider) => {
      const first = launch(provider);
      const second = launch(provider, "account-b");
      expect(first.directory).not.toBe(second.directory);
      expect(first.env).not.toEqual(second.env);
      for (let index = 0; index < 10; index++) expect(launch(provider)).toEqual(first);
      for (const name of [
        "ANTHROPIC_API_KEY",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "CURSOR_API_KEY",
        "OPENAI_API_KEY",
        "CLAUDECODE",
      ])
        expect(first.command.removeEnv).toContain(name);
      expect(first.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    },
  );
  it("pins Codex login, status and agent to the same credential store", () => {
    expect(launch("codex", "account-a", "login").env).toEqual(launch("codex").env);
    expect(launch("codex").env.CODEX_HOME).toBe("/tmp/djl-profiles/codex/account-a");
    expect(launch("codex").command.args).toContain('cli_auth_credentials_store="file"');
    expect(launch("codex", "account-a", "status").command.args.slice(-2)).toEqual([
      "login",
      "status",
    ]);
  });
  it("uses native provider directories for Claude, Cursor and OpenCode", () => {
    expect(launch("claudeAgent").env.CLAUDE_CONFIG_DIR).toBe(launch("claudeAgent").directory);
    expect(launch("cursor").env.CURSOR_CONFIG_DIR).toBe(launch("cursor").directory);
    expect(launch("opencode").env.XDG_DATA_HOME).toBe(`${launch("opencode").directory}/data`);
    expect(launch("claudeAgent", "account-a", "login").command.args).toEqual(["auth", "login"]);
  });
  it.each(["../escape", "/tmp/escape", "a/b", "", "a.b"])("rejects unsafe profile id %s", (id) => {
    expect(() => launch("codex", id)).toThrow();
  });
});

describe("shared-login terminal harness launches", () => {
  it.each(["codex", "claudeAgent", "cursor", "opencode", "kimi", "grok"] as const)(
    "prepares a persistent %s shell using the installed CLI configuration",
    async (harness) => {
      const root = await mkdtemp(join(tmpdir(), "djl-terminal-launch-"));
      const settings = structuredClone(DEFAULT_SERVER_SETTINGS);
      const configuredSettings = {
        ...settings,
        providers: {
          ...settings.providers,
          [harness]: { ...settings.providers[harness], binaryPath: "/bin/echo" },
        },
      };
      const manager = {
        isRunning: () => Effect.succeed(false),
        open: vi.fn(() => Effect.succeed({} as never)),
      };
      try {
        await Effect.runPromise(
          openProfileTerminal(
            { threadId: "t", terminalId: harness, cwd: root, harness },
            configuredSettings,
            root,
            manager,
          ),
        );
        const [input, command] = manager.open.mock.calls[0] as unknown as [
          Record<string, unknown>,
          { persistentShell?: boolean },
        ];
        expect(command?.persistentShell).toBe(true);
        expect(input.cwd).toBe(root);
        expect(JSON.stringify(input)).not.toContain("account-a");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
