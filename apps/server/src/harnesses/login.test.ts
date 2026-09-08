import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import {
  DEFAULT_SERVER_SETTINGS,
  type TerminalOpenInput,
  type TerminalSessionSnapshot,
  type TerminalWriteInput,
} from "@synara/contracts";
import type { TerminalCommand } from "../terminal/Services/Manager";
import { createHarnessLoginController } from "./login";
import { probeHarnessAccount } from "./accounts";

vi.mock("./accounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./accounts")>()),
  probeHarnessAccount: vi.fn(),
}));

function fixture() {
  const open = vi.fn((input: TerminalOpenInput, _command?: TerminalCommand) =>
    Effect.succeed({
      threadId: input.threadId,
      terminalId: input.terminalId ?? "default",
      cwd: input.cwd,
      status: "running",
      pid: 123,
      history: "",
      exitCode: null,
      exitSignal: null,
      updatedAt: "2026-09-04T00:00:00Z",
    } satisfies TerminalSessionSnapshot),
  );
  const write = vi.fn((_input: TerminalWriteInput) => Effect.void);
  const close = vi.fn(() => Effect.void);
  const isRunning = vi.fn(() => Effect.succeed(true));
  return {
    open,
    write,
    close,
    isRunning,
    controller: createHarnessLoginController({
      terminal: { open, isRunning, close },
      cwd: "/tmp",
      managedRootDir: "/tmp/djl-managed",
    }),
  };
}

beforeEach(() => {
  vi.mocked(probeHarnessAccount).mockImplementation(async (id) => ({
    id,
    installed: true,
    enabled: true,
    status: "ready",
  }));
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("provider-owned sign-in terminals", () => {
  it("does not reuse one coding-plan login for a different provider", async () => {
    const { controller, open } = fixture();
    await controller.start(
      { harness: "opencode", modelProviderId: "zai-coding-plan" },
      DEFAULT_SERVER_SETTINGS,
    );
    await expect(
      controller.start(
        { harness: "opencode", modelProviderId: "zhipuai-coding-plan" },
        DEFAULT_SERVER_SETTINGS,
      ),
    ).rejects.toThrow("Close the current sign-in");
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[1]?.args).toEqual([
      "auth",
      "login",
      "--provider",
      "zai-coding-plan",
    ]);
    await controller.end("opencode");
    await controller.start(
      { harness: "opencode", modelProviderId: "zhipuai-coding-plan" },
      DEFAULT_SERVER_SETTINGS,
    );
    expect(open.mock.calls[1]?.[1]?.args).toEqual([
      "auth",
      "login",
      "--provider",
      "zhipuai-coding-plan",
    ]);
    await controller.dispose();
  });
  it("coalesces concurrent login clicks without writing into a running login process twice", async () => {
    const { controller, open, write, close } = fixture();
    const [first, second] = await Promise.all([
      controller.start({ harness: "codex" }, DEFAULT_SERVER_SETTINGS),
      controller.start({ harness: "codex" }, DEFAULT_SERVER_SETTINGS),
    ]);
    expect(first).toEqual(second);
    expect(first.threadId).toMatch(/^harness-login-/);
    expect(open).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    expect(open.mock.calls[0]?.[1]).toEqual({
      executable: "codex",
      args: ["login"],
      removeEnv: [],
    });
    await controller.end("codex");
    expect(close).toHaveBeenCalledWith({ ...first, deleteHistory: true });
    const next = await controller.start({ harness: "codex" }, DEFAULT_SERVER_SETTINGS);
    expect(next.threadId).not.toBe(first.threadId);
    await controller.dispose();
  });
  it("preserves inherited credentials and shared CLI locations for OpenCode login", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "unrelated-key");
    const { controller, open, write } = fixture();
    await controller.start(
      { harness: "opencode", modelProviderId: "zai-coding-plan" },
      DEFAULT_SERVER_SETTINGS,
    );
    const overrides = open.mock.calls[0]?.[0].env;
    expect(overrides).not.toHaveProperty("ANTHROPIC_API_KEY");
    for (const name of ["XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]) {
      expect(overrides).not.toHaveProperty(name);
    }
    expect(process.env.ANTHROPIC_API_KEY).toBe("unrelated-key");
    expect(write).not.toHaveBeenCalled();
    expect(open.mock.calls[0]?.[1]).toMatchObject({
      args: ["auth", "login", "--provider", "zai-coding-plan"],
      removeEnv: [],
    });
    await controller.dispose();
  });
  it("restarts after the terminal was closed or exited through the terminal API", async () => {
    const { controller, isRunning, open } = fixture();
    const first = await controller.start({ harness: "codex" }, DEFAULT_SERVER_SETTINGS);
    isRunning.mockReturnValue(Effect.succeed(false));
    const [second, concurrent] = await Promise.all([
      controller.start({ harness: "codex" }, DEFAULT_SERVER_SETTINGS),
      controller.start({ harness: "codex" }, DEFAULT_SERVER_SETTINGS),
    ]);
    expect(second.threadId).not.toBe(first.threadId);
    expect(second).toEqual(concurrent);
    expect(open).toHaveBeenCalledTimes(2);
    await controller.dispose();
  });
  it("cancels a pending probe without starting an orphan login", async () => {
    let resolveProbe!: (value: Awaited<ReturnType<typeof probeHarnessAccount>>) => void;
    vi.mocked(probeHarnessAccount).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const { controller, open } = fixture();
    const pending = controller.start({ harness: "codex" }, DEFAULT_SERVER_SETTINGS);
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await Promise.resolve();
    const end = controller.end("codex");
    resolveProbe({ id: "codex", installed: true, enabled: true, status: "ready" });
    await end;
    await rejected;
    expect(open).not.toHaveBeenCalled();
  });
  it("registers cancellation before settings finish loading and scopes RPC abort to its attempt", async () => {
    const { controller, open, close } = fixture();
    let resolveSettings!: (settings: typeof DEFAULT_SERVER_SETTINGS) => void;
    const settings = new Promise<typeof DEFAULT_SERVER_SETTINGS>((resolve) => {
      resolveSettings = resolve;
    });
    const abort = new AbortController();
    const pending = controller.start({ harness: "codex" }, () => settings, abort.signal);
    const rejected = expect(pending).rejects.toThrow("cancelled");
    abort.abort();
    resolveSettings(DEFAULT_SERVER_SETTINGS);
    await rejected;
    expect(open).not.toHaveBeenCalled();
    const next = await controller.start({ harness: "codex" }, DEFAULT_SERVER_SETTINGS);
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    await controller.end(next.harness);
  });
  it("closes a login when cancellation arrives while PTY spawn is pending", async () => {
    const { controller, open, close } = fixture();
    let resolveOpen!: () => void;
    open.mockImplementation((input) =>
      Effect.promise(
        () =>
          new Promise((resolve) => {
            resolveOpen = () =>
              resolve({
                ...input,
                terminalId: "default",
                status: "running",
                pid: 123,
                history: "",
                exitCode: null,
                exitSignal: null,
                updatedAt: "2026-09-04T00:00:00Z",
              });
          }),
      ),
    );
    const pending = controller.start({ harness: "codex" }, DEFAULT_SERVER_SETTINGS);
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const end = controller.end("codex");
    resolveOpen();
    await end;
    await rejected;
    expect(close).toHaveBeenCalledTimes(1);
    expect(close.mock.calls[0]).toEqual([
      expect.objectContaining({
        threadId: expect.stringMatching(/^harness-login-/),
        deleteHistory: true,
      }),
    ]);
  });
  it("passes only provider overrides, preserving inherited terminal sanitization", async () => {
    vi.stubEnv("TERM", "xterm-ghostty");
    vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
    vi.stubEnv("SYNARA_PRIVATE", "private");
    const { controller, open } = fixture();
    await controller.start({ harness: "claudeAgent" }, DEFAULT_SERVER_SETTINGS);
    expect(open.mock.calls[0]?.[0].env).toEqual({});
    expect(open.mock.calls[0]?.[1]).toEqual({
      executable: "claude",
      args: ["auth", "login"],
      removeEnv: [],
    });
    await controller.dispose();
  });
  it("rejects incompatible OpenCode before opening a sign-in terminal", async () => {
    vi.mocked(probeHarnessAccount).mockResolvedValue({
      id: "opencode",
      enabled: true,
      installed: true,
      status: "incompatible",
    });
    const { controller, open } = fixture();
    await expect(
      controller.start({ harness: "opencode" }, DEFAULT_SERVER_SETTINGS),
    ).rejects.toThrow("provider setup guide");
    expect(open).not.toHaveBeenCalled();
  });
  it("does not start a shell when the official CLI is missing", async () => {
    vi.mocked(probeHarnessAccount).mockResolvedValue({
      id: "cursor",
      enabled: true,
      installed: false,
      status: "missing",
    });
    const { controller, open } = fixture();
    await expect(controller.start({ harness: "cursor" }, DEFAULT_SERVER_SETTINGS)).rejects.toThrow(
      "Install the official",
    );
    expect(open).not.toHaveBeenCalled();
  });
  it("rejects model-provider arguments for native harness logins", async () => {
    const { controller, open } = fixture();
    await expect(
      controller.start({ harness: "codex", modelProviderId: "anything" }, DEFAULT_SERVER_SETTINGS),
    ).rejects.toThrow("requires OpenCode");
    expect(open).not.toHaveBeenCalled();
  });
});
