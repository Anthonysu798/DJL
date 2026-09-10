import { describe, expect, it, vi } from "vitest";

import { syncShellEnvironment } from "./syncShellEnvironment";

describe("syncShellEnvironment", () => {
  it("hydrates PATH and missing SSH_AUTH_SOCK from the login shell on macOS", async () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/Users/test/.local/bin:/usr/bin",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/opt/homebrew/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/secretive.sock",
      HOMEBREW_PREFIX: "/opt/homebrew",
    }));

    await syncShellEnvironment(env, {
      platform: "darwin",
      readEnvironment,
    });

    expect(readEnvironment).toHaveBeenCalledWith("/bin/zsh", [
      "PATH",
      "SSH_AUTH_SOCK",
      "HOMEBREW_PREFIX",
      "HOMEBREW_CELLAR",
      "HOMEBREW_REPOSITORY",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
    ]);
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/Users/test/.local/bin");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/secretive.sock");
    expect(env.HOMEBREW_PREFIX).toBe("/opt/homebrew");
  });

  it("preserves an inherited SSH_AUTH_SOCK value", async () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/usr/bin",
      SSH_AUTH_SOCK: "/tmp/inherited.sock",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/opt/homebrew/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/login-shell.sock",
    }));

    await syncShellEnvironment(env, {
      platform: "darwin",
      readEnvironment,
    });

    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/inherited.sock");
  });

  it("preserves inherited values when the login shell omits them", async () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/usr/bin",
      SSH_AUTH_SOCK: "/tmp/inherited.sock",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/opt/homebrew/bin:/usr/bin",
    }));

    await syncShellEnvironment(env, {
      platform: "darwin",
      readEnvironment,
    });

    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/inherited.sock");
  });

  it("hydrates PATH and missing SSH_AUTH_SOCK from the login shell on Linux", async () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/usr/bin",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/usr/local/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/ssh.sock",
    }));

    await syncShellEnvironment(env, {
      platform: "linux",
      readEnvironment,
    });

    expect(readEnvironment).toHaveBeenCalledWith("/bin/zsh", [
      "PATH",
      "SSH_AUTH_SOCK",
      "HOMEBREW_PREFIX",
      "HOMEBREW_CELLAR",
      "HOMEBREW_REPOSITORY",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
    ]);
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/ssh.sock");
  });

  it("falls back to a user login shell when SHELL is missing", async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/usr/local/bin:/usr/bin",
    }));

    await syncShellEnvironment(env, {
      platform: "linux",
      readEnvironment,
      userShell: "/bin/bash",
    });

    expect(readEnvironment).toHaveBeenCalledWith("/bin/bash", [
      "PATH",
      "SSH_AUTH_SOCK",
      "HOMEBREW_PREFIX",
      "HOMEBREW_CELLAR",
      "HOMEBREW_REPOSITORY",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
    ]);
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin");
  });

  it("falls back to launchctl PATH on macOS when shell probing does not return one", async () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/opt/homebrew/bin/nu",
      PATH: "/usr/bin",
    };
    const readEnvironment = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("unknown flag");
      })
      .mockImplementationOnce(() => ({}));
    const readLaunchctlPath = vi.fn(() => "/opt/homebrew/bin:/usr/bin");
    const logWarning = vi.fn();

    await syncShellEnvironment(env, {
      platform: "darwin",
      readEnvironment,
      readLaunchctlPath,
      userShell: "/bin/zsh",
      logWarning,
    });

    expect(readEnvironment).toHaveBeenNthCalledWith(1, "/opt/homebrew/bin/nu", [
      "PATH",
      "SSH_AUTH_SOCK",
      "HOMEBREW_PREFIX",
      "HOMEBREW_CELLAR",
      "HOMEBREW_REPOSITORY",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
    ]);
    expect(readEnvironment).toHaveBeenNthCalledWith(2, "/bin/zsh", [
      "PATH",
      "SSH_AUTH_SOCK",
      "HOMEBREW_PREFIX",
      "HOMEBREW_CELLAR",
      "HOMEBREW_REPOSITORY",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
    ]);
    expect(readLaunchctlPath).toHaveBeenCalledTimes(1);
    expect(logWarning).toHaveBeenCalledWith(
      "Failed to read login shell environment from /opt/homebrew/bin/nu.",
      expect.any(Error),
    );
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin");
  });

  it("hydrates PATH and missing variables from the Windows registry", async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "C:\\Windows\\system32",
    };
    const readWindowsEnvironment = vi.fn(() => ({
      PATH: "C:\\Windows\\system32;C:\\Users\\ramar\\.local\\bin",
      CLAUDE_CONFIG_DIR: "C:\\Users\\ramar\\.config\\claude",
    }));

    await syncShellEnvironment(env, {
      platform: "win32",
      readWindowsEnvironment,
    });

    expect(readWindowsEnvironment).toHaveBeenCalledTimes(1);
    expect(env.PATH).toBe("C:\\Windows\\system32;C:\\Users\\ramar\\.local\\bin");
    expect(env.CLAUDE_CONFIG_DIR).toBe("C:\\Users\\ramar\\.config\\claude");
  });

  it("merges Windows PATH but preserves variables already in the environment", async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "C:\\Windows\\system32",
      CLAUDE_CONFIG_DIR: "C:\\already\\set",
    };
    const readWindowsEnvironment = vi.fn(() => ({
      PATH: "C:\\Users\\ramar\\.local\\bin",
      CLAUDE_CONFIG_DIR: "C:\\Users\\ramar\\.config\\claude",
      GEMINI_API_KEY: "from-registry",
    }));

    await syncShellEnvironment(env, {
      platform: "win32",
      readWindowsEnvironment,
    });

    expect(env.PATH).toBe("C:\\Users\\ramar\\.local\\bin;C:\\Windows\\system32");
    expect(env.CLAUDE_CONFIG_DIR).toBe("C:\\already\\set");
    expect(env.GEMINI_API_KEY).toBe("from-registry");
  });

  it("logs a warning and leaves the environment intact when the Windows reader throws", async () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "C:\\Windows\\system32",
    };
    const readWindowsEnvironment = vi.fn(() => {
      throw new Error("powershell.exe ENOENT");
    });
    const logWarning = vi.fn();

    await syncShellEnvironment(env, {
      platform: "win32",
      readWindowsEnvironment,
      logWarning,
    });

    expect(readWindowsEnvironment).toHaveBeenCalledTimes(1);
    expect(logWarning).toHaveBeenCalledWith(
      "Failed to synchronize the desktop Windows environment.",
      expect.any(Error),
    );
    expect(env.PATH).toBe("C:\\Windows\\system32");
  });

  it("does nothing on unsupported platforms", async () => {
    const env: NodeJS.ProcessEnv = {
      SHELL: "/bin/zsh",
      PATH: "/usr/bin",
      SSH_AUTH_SOCK: "/tmp/inherited.sock",
    };
    const readEnvironment = vi.fn(() => ({
      PATH: "/opt/homebrew/bin:/usr/bin",
      SSH_AUTH_SOCK: "/tmp/secretive.sock",
    }));

    await syncShellEnvironment(env, {
      platform: "freebsd",
      readEnvironment,
    });

    expect(readEnvironment).not.toHaveBeenCalled();
    expect(env.PATH).toBe("/usr/bin");
    expect(env.SSH_AUTH_SOCK).toBe("/tmp/inherited.sock");
  });
});

it("waits for asynchronous shell capture before merging provider paths", async () => {
  let resolveEnvironment!: (value: Record<string, string>) => void;
  const env: NodeJS.ProcessEnv = { SHELL: "/bin/bash", PATH: "/usr/bin" };
  const pending = syncShellEnvironment(env, {
    platform: "linux",
    readEnvironment: () =>
      new Promise<Record<string, string>>((resolve) => {
        resolveEnvironment = resolve;
      }),
  });
  expect(env.PATH).toBe("/usr/bin");
  resolveEnvironment({ PATH: "/tools/bin:/usr/bin", SSH_AUTH_SOCK: "/tmp/agent.sock" });
  await pending;
  expect(env.PATH).toBe("/tools/bin:/usr/bin");
  expect(env.SSH_AUTH_SOCK).toBe("/tmp/agent.sock");
});

it("stops shell fallback and preserves inherited values when startup is cancelled", async () => {
  const controller = new AbortController();
  const env: NodeJS.ProcessEnv = { SHELL: "/bin/custom-shell", PATH: "/usr/bin" };
  const readEnvironment = vi.fn(async () => {
    controller.abort();
    throw new Error("capture cancelled");
  });
  const logWarning = vi.fn();
  await syncShellEnvironment(env, {
    platform: "linux",
    signal: controller.signal,
    readEnvironment,
    logWarning,
  });
  expect(readEnvironment).toHaveBeenCalledTimes(1);
  expect(env.PATH).toBe("/usr/bin");
  expect(logWarning).not.toHaveBeenCalled();
});

it("preserves synchronous Linux profile-path hydration before single-instance locking", async () => {
  const env: NodeJS.ProcessEnv = { SHELL: "/bin/bash", PATH: "/usr/bin" };
  const result = syncShellEnvironment(env, {
    platform: "linux",
    readEnvironment: () => ({ PATH: "/usr/bin", XDG_CONFIG_HOME: "/custom/config" }),
  });
  expect(env.XDG_CONFIG_HOME).toBe("/custom/config");
  await result;
});
