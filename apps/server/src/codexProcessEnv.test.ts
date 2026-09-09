import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildCodexProcessEnv,
  linkOrCopyCodexOverlayEntry,
  prioritizeCodexOverlayEntries,
} from "./codexProcessEnv";

describe("linkOrCopyCodexOverlayEntry", () => {
  it("copies auth.json when symlink creation is unavailable", () => {
    const symlink = vi.fn(() => {
      throw new Error("symlinks unavailable");
    });
    const copyFile = vi.fn();

    linkOrCopyCodexOverlayEntry(
      {
        entryName: "auth.json",
        sourcePath: "C:\\Users\\test\\.codex\\auth.json",
        targetPath: "C:\\Users\\test\\.synara\\codex-home-overlay\\auth.json",
        type: "file",
      },
      { symlink, copyFile },
    );

    expect(symlink).toHaveBeenCalledWith(
      "C:\\Users\\test\\.codex\\auth.json",
      "C:\\Users\\test\\.synara\\codex-home-overlay\\auth.json",
      "file",
    );
    expect(copyFile).toHaveBeenCalledWith(
      "C:\\Users\\test\\.codex\\auth.json",
      "C:\\Users\\test\\.synara\\codex-home-overlay\\auth.json",
    );
  });

  it("keeps symlink failures visible for other overlay entries", () => {
    const symlink = vi.fn(() => {
      throw new Error("symlinks unavailable");
    });

    expect(() =>
      linkOrCopyCodexOverlayEntry(
        {
          entryName: "sessions",
          sourcePath: "C:\\Users\\test\\.codex\\sessions",
          targetPath: "C:\\Users\\test\\.synara\\codex-home-overlay\\sessions",
          type: "dir",
        },
        { symlink, copyFile: vi.fn() },
      ),
    ).toThrow("symlinks unavailable");
  });
});

describe("prioritizeCodexOverlayEntries", () => {
  it("prepares auth.json before entries whose symlinks may fail first", () => {
    expect(prioritizeCodexOverlayEntries(["sessions", "auth.json", "config.toml"])).toEqual([
      "auth.json",
      "sessions",
      "config.toml",
    ]);
  });
});

describe("buildCodexProcessEnv", () => {
  it("keeps the djl-ssh shim first on PATH after the login shell replaces it", () => {
    const root = mkdtempSync(path.join(tmpdir(), "codex-env-shim-"));
    try {
      const codexHome = path.join(root, "codex-home");
      mkdirSync(codexHome, { recursive: true });
      writeFileSync(
        path.join(codexHome, "config.toml"),
        'model_provider = "openrouter"\n\n[model_providers.openrouter]\nenv_key = "OPENROUTER_API_KEY"\n',
      );
      const shimBin = path.join(root, "bin");
      const env = buildCodexProcessEnv({
        env: {
          PATH: `${shimBin}:/usr/bin`,
          SHELL: "/bin/zsh",
          DJL_HOME: path.join(root, "djl-home"),
          DJL_SSH_SHIM_BIN: shimBin,
        },
        homePath: codexHome,
        platform: "darwin",
        readEnvironment: () => ({ PATH: "/login/bin:/usr/bin", OPENROUTER_API_KEY: "k" }),
      });
      expect(env.PATH).toBe(`${shimBin}:/login/bin:/usr/bin`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves PATH alone when no shim is registered", () => {
    const env = buildCodexProcessEnv({
      env: { PATH: "/usr/bin", SHELL: "/bin/zsh" },
      platform: "win32",
    });
    expect(env.PATH).toBe("/usr/bin");
  });
});
