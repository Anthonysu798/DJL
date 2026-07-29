import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it.each([
    { platform: "darwin" as const, engineExecutable: "llmster", cliExecutable: "lms" },
    { platform: "win32" as const, engineExecutable: "llmster.exe", cliExecutable: "lms.exe" },
  ])(
    "relocates bootstrap metadata when the staged $platform engine becomes current",
    async ({ platform, engineExecutable, cliExecutable }) => {
      const stateDir = await mkdtemp(join(tmpdir(), "djl-llmster-installer-"));
      roots.push(stateDir);
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith(".sha512")) {
          return new Response(
            "b11537e8e9350ce7125aa62f037cfc13bb33189d233ddddec11f8ea373517650d26f4e77657b9aea00195ff83751d6a2142674cb217e3f3b2c8913be21784344",
          );
        }
        return new Response("archive", {
          headers: { "Content-Length": "7" },
        });
      });
      const runCommand = vi.fn(
        async (
          command: string,
          args: ReadonlyArray<string>,
          options?: { readonly env?: NodeJS.ProcessEnv },
        ) => {
          if (command === "tar" && args[0] === "-tf") return { stdout: "llmster\n" };
          if (command === "tar" && args[0] === "-xf") {
            const extractedPath = args[args.indexOf("-C") + 1]!;
            await mkdir(extractedPath, { recursive: true });
            await writeFile(join(extractedPath, engineExecutable), "bootstrap", { mode: 0o755 });
            return { stdout: "" };
          }
          const stagingHome = options?.env?.HOME;
          if (args[0] === "bootstrap" && stagingHome) {
            const studioHome = join(stagingHome, ".lmstudio");
            const installDir = join(studioHome, "llmster", "0.0.19-2");
            await mkdir(join(studioHome, "bin"), { recursive: true });
            await mkdir(join(studioHome, ".internal"), { recursive: true });
            await mkdir(installDir, { recursive: true });
            await writeFile(join(studioHome, "bin", cliExecutable), "cli", { mode: 0o755 });
            await writeFile(join(stagingHome, ".lmstudio-home-pointer"), studioHome);
            await writeFile(
              join(studioHome, ".internal", "llmster-install-location.json"),
              JSON.stringify({
                path: join(installDir, "llmster"),
                argv: [],
                cwd: installDir,
              }),
            );
            return { stdout: "" };
          }
          throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        },
      );

      const installed = await installLmStudioRuntime({
        stateDir,
        platform,
        arch: "arm64",
        fetch: fetchMock,
        runCommand,
        onProgress: vi.fn(),
      });

      const currentHome = join(stateDir, "local-models", "runtimes", "lmstudio", "current");
      expect(await readFile(join(currentHome, ".lmstudio-home-pointer"), "utf8")).toBe(
        join(currentHome, ".lmstudio"),
      );
      expect(
        JSON.parse(
          await readFile(
            join(currentHome, ".lmstudio", ".internal", "llmster-install-location.json"),
            "utf8",
          ),
        ),
      ).toEqual({
        path: join(currentHome, ".lmstudio", "llmster", "0.0.19-2", engineExecutable),
        argv: [],
        cwd: join(currentHome, ".lmstudio", "llmster", "0.0.19-2"),
      });
      expect(installed.command).toBe(join(currentHome, ".lmstudio", "bin", cliExecutable));
    },
  );
});
