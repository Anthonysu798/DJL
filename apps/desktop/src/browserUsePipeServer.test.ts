// FILE: browserUsePipeServer.test.ts
// Purpose: Guards the desktop browser-use native pipe path helpers.
// Layer: Desktop test
// Depends on: Vitest and browserUsePipeServer path resolution exports

import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BrowserUsePipeServer,
  SYNARA_BROWSER_USE_PIPE_ENV,
  resolveConfiguredBrowserUsePipePath,
  resolveDefaultBrowserUsePipePath,
} from "./browserUsePipeServer";

describe("browser-use pipe path resolution", () => {
  it("creates a discoverable unix socket path under the Codex browser-use directory", () => {
    const pipePath = resolveDefaultBrowserUsePipePath("darwin");

    expect(dirname(pipePath)).toBe("/tmp/codex-browser-use");
    expect(basename(pipePath)).toMatch(/^synara-iab-\d+\.sock$/);
  });

  it("uses the same discoverable directory on Linux", () => {
    expect(dirname(resolveDefaultBrowserUsePipePath("linux"))).toBe("/tmp/codex-browser-use");
  });

  it("uses the Codex browser-use named-pipe prefix on Windows", () => {
    expect(resolveDefaultBrowserUsePipePath("win32")).toMatch(
      /^\\\\\.\\pipe\\codex-browser-use-synara-iab-\d+$/,
    );
  });

  it("prefers an explicit Synara pipe path from the environment", () => {
    expect(
      resolveConfiguredBrowserUsePipePath(
        {
          [SYNARA_BROWSER_USE_PIPE_ENV]: "/tmp/codex-browser-use/synara.sock",
        },
        "darwin",
      ),
    ).toBe("/tmp/codex-browser-use/synara.sock");
  });

  it("prefers a discoverable Windows named-pipe override", () => {
    const pipePath = String.raw`\\.\pipe\codex-browser-use-synara-custom`;

    expect(
      resolveConfiguredBrowserUsePipePath({ [SYNARA_BROWSER_USE_PIPE_ENV]: pipePath }, "win32"),
    ).toBe(pipePath);
  });

  it("falls back to the generated path when the environment is empty", () => {
    expect(dirname(resolveConfiguredBrowserUsePipePath({}, "darwin"))).toBe(
      "/tmp/codex-browser-use",
    );
  });

  it("ignores a Unix override outside the directory Codex scans", () => {
    const resolved = resolveConfiguredBrowserUsePipePath(
      {
        [SYNARA_BROWSER_USE_PIPE_ENV]: "/var/folders/user/T/codex-browser-use/synara.sock",
      },
      "darwin",
    );

    expect(dirname(resolved)).toBe("/tmp/codex-browser-use");
    expect(basename(resolved)).toMatch(/^synara-iab-\d+\.sock$/);
  });

  it("ignores a Windows override without the Codex browser-use prefix", () => {
    expect(
      resolveConfiguredBrowserUsePipePath(
        { [SYNARA_BROWSER_USE_PIPE_ENV]: String.raw`\\.\pipe\synara-iab-custom` },
        "win32",
      ),
    ).toMatch(/^\\\\\.\\pipe\\codex-browser-use-synara-iab-\d+$/);
  });

  it("removes its Unix socket when disposed", async () => {
    const pipePath = `/tmp/codex-browser-use/synara-iab-test-${process.pid}-${Date.now()}.sock`;
    const server = new BrowserUsePipeServer({} as never, pipePath);

    await server.start();
    expect(existsSync(pipePath)).toBe(true);

    await server.dispose();
    expect(existsSync(pipePath)).toBe(false);
  });

  it("replaces a stale file before listening on its Unix socket", async () => {
    const pipePath = `/tmp/codex-browser-use/synara-iab-stale-${process.pid}-${Date.now()}.sock`;
    writeFileSync(pipePath, "stale");
    const server = new BrowserUsePipeServer({} as never, pipePath);

    try {
      await server.start();
      expect(existsSync(pipePath)).toBe(true);
    } finally {
      await server.dispose();
    }

    expect(existsSync(pipePath)).toBe(false);
  });
});
