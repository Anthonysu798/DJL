import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { installLmStudioRuntime, selectLmStudioReleaseAsset } from "./LmStudioInstaller";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed llmster installer", () => {
  it("pins the official checksum-protected artifact for each supported platform", () => {
    expect(selectLmStudioReleaseAsset("darwin", "arm64")).toMatchObject({
      version: "0.0.19-2",
      name: "0.0.19-2-darwin-arm64.full.tar.gz",
      archiveType: "tgz",
    });
    expect(selectLmStudioReleaseAsset("win32", "x64")).toMatchObject({
      name: "0.0.19-2-win32-x64.full.zip",
      archiveType: "zip",
    });
    expect(() => selectLmStudioReleaseAsset("freebsd", "x64")).toThrow(
      "One-click LM Studio engine installation is not available",
    );
  });

  it("refuses to run the bootstrap binary when the mandatory SHA-512 checksum fails", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "djl-llmster-installer-"));
    roots.push(stateDir);
    const runCommand = vi.fn();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(".sha512")) return new Response("0".repeat(128));
      return new Response("archive", {
        headers: { "Content-Length": "7" },
      });
    });

    await expect(
      installLmStudioRuntime({
        stateDir,
        platform: "darwin",
        arch: "arm64",
        fetch: fetchMock,
        runCommand,
        onProgress: vi.fn(),
      }),
    ).rejects.toThrow("SHA-512 integrity check");
    expect(runCommand).not.toHaveBeenCalled();
  });
});
