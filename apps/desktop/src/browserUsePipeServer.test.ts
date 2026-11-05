// FILE: browserUsePipeServer.test.ts
// Purpose: Guards the desktop browser-use native pipe path helpers.
// Layer: Desktop test
// Depends on: Vitest and browserUsePipeServer path resolution exports

import { once } from "node:events";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { basename, dirname } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BrowserUsePipeServer,
  SYNARA_BROWSER_USE_PIPE_ENV,
  resolveConfiguredBrowserUsePipePath,
  resolveDefaultBrowserUsePipePath,
} from "./browserUsePipeServer";

function testPipePath(label: string): string {
  const suffix = `${label}-${process.pid}-${Date.now()}`;
  return process.platform === "win32"
    ? String.raw`\\.\pipe\codex-browser-use-synara-iab-${suffix}`
    : `/tmp/codex-browser-use/synara-iab-${suffix}.sock`;
}

async function connectToPipe(pipePath: string): Promise<void> {
  const socket = createConnection(pipePath);
  const timeout = setTimeout(() => socket.destroy(new Error("IPC connection timed out")), 3_000);
  try {
    await once(socket, "connect");
  } finally {
    clearTimeout(timeout);
    socket.destroy();
  }
}

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

  it("closes its native IPC endpoint when disposed", async () => {
    const pipePath = testPipePath("test");
    const server = new BrowserUsePipeServer({} as never, pipePath);

    try {
      await server.start();
      await expect(connectToPipe(pipePath)).resolves.toBeUndefined();
      if (process.platform !== "win32") expect(lstatSync(pipePath).isSocket()).toBe(true);
    } finally {
      await server.dispose();
    }

    expect(existsSync(pipePath)).toBe(false);
    await expect(connectToPipe(pipePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reuses its native endpoint without mistaking an active Windows pipe for a stale file", async () => {
    const pipePath = testPipePath("stale");
    const server = new BrowserUsePipeServer({} as never, pipePath);

    if (process.platform !== "win32") {
      mkdirSync(dirname(pipePath), { recursive: true });
      writeFileSync(pipePath, "stale");
    }
    try {
      await server.start();
      if (process.platform === "win32") {
        const duplicate = new BrowserUsePipeServer({} as never, pipePath);
        try {
          await expect(duplicate.start()).rejects.toMatchObject({ code: "EADDRINUSE" });
        } finally {
          await duplicate.dispose();
        }
      } else {
        expect(lstatSync(pipePath).isSocket()).toBe(true);
      }
      await expect(connectToPipe(pipePath)).resolves.toBeUndefined();
    } finally {
      await server.dispose();
    }

    expect(existsSync(pipePath)).toBe(false);
    await expect(connectToPipe(pipePath)).rejects.toMatchObject({ code: "ENOENT" });
    try {
      await server.start();
      await expect(connectToPipe(pipePath)).resolves.toBeUndefined();
    } finally {
      await server.dispose();
    }
    await expect(connectToPipe(pipePath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
