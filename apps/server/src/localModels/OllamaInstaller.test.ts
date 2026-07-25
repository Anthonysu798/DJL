import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installOllamaRuntime,
  selectOllamaReleaseAsset,
  validateArchiveEntries,
  validateExtractedSymlinks,
} from "./OllamaInstaller";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OllamaInstaller", () => {
  it("selects the official archive and requires a SHA-256 digest", () => {
    expect(
      selectOllamaReleaseAsset(
        {
          tag_name: "v0.32.0",
          assets: [
            {
              name: "ollama-darwin.tgz",
              size: 145_356_966,
              digest: "sha256:3b12a49c6c4cbafd7ffba5ccba60cbf80274cdc22eea3ead79c646aba888174c",
              browser_download_url:
                "https://github.com/ollama/ollama/releases/download/v0.32.0/ollama-darwin.tgz",
            },
          ],
        },
        "darwin",
        "arm64",
      ),
    ).toMatchObject({
      name: "ollama-darwin.tgz",
      sha256: "3b12a49c6c4cbafd7ffba5ccba60cbf80274cdc22eea3ead79c646aba888174c",
      version: "v0.32.0",
    });

    expect(() =>
      selectOllamaReleaseAsset(
        {
          tag_name: "v0.32.0",
          assets: [
            {
              name: "ollama-darwin.tgz",
              size: 100,
              digest: null,
              browser_download_url: "https://example.com/ollama-darwin.tgz",
            },
          ],
        },
        "darwin",
        "arm64",
      ),
    ).toThrow(/verified download/i);
  });

  it("rejects archive traversal and absolute paths", () => {
    expect(() => validateArchiveEntries(["ollama", "lib/libllama.dylib"])).not.toThrow();
    expect(() => validateArchiveEntries(["../outside"])).toThrow(/unsafe/i);
    expect(() => validateArchiveEntries(["safe/../../outside"])).toThrow(/unsafe/i);
    expect(() => validateArchiveEntries(["/tmp/outside"])).toThrow(/unsafe/i);
    expect(() => validateArchiveEntries(["C:\\outside\\ollama.exe"])).toThrow(/unsafe/i);
  });

  it("allows internal symlinks and rejects links escaping the install directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "djl-ollama-links-"));
    roots.push(root);
    await writeFile(join(root, "lib.1.dylib"), "fixture");
    await symlink("lib.1.dylib", join(root, "lib.dylib"));
    await expect(validateExtractedSymlinks(root)).resolves.toBeUndefined();

    await symlink("/tmp", join(root, "escape"));
    await expect(validateExtractedSymlinks(root)).rejects.toThrow(/unsafe symbolic link/i);
  });

  it("verifies, extracts, and atomically installs a release archive", async () => {
    const root = await mkdtemp(join(tmpdir(), "djl-ollama-installer-"));
    roots.push(root);
    const fixture = join(root, "fixture");
    await mkdir(fixture);
    await writeFile(join(fixture, "ollama"), "fixture-binary", { mode: 0o700 });
    const archive = join(root, "ollama-darwin.tgz");
    await execFileAsync("tar", ["-czf", archive, "-C", fixture, "."]);
    const bytes = await readFile(archive);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const downloadUrl =
      "https://github.com/ollama/ollama/releases/download/v-test/ollama-darwin.tgz";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes("/releases/latest")) {
        return new Response(
          JSON.stringify({
            tag_name: "v-test",
            assets: [
              {
                name: "ollama-darwin.tgz",
                size: bytes.byteLength,
                digest: `sha256:${digest}`,
                browser_download_url: downloadUrl,
              },
            ],
          }),
        );
      }
      if (String(input) === downloadUrl) return new Response(bytes);
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    const progress: string[] = [];

    const result = await installOllamaRuntime({
      stateDir: root,
      fetch: fetchMock,
      platform: "darwin",
      arch: "arm64",
      onProgress: (event) => {
        progress.push(event.state);
      },
    });

    await expect(readFile(result.command, "utf8")).resolves.toBe("fixture-binary");
    expect(progress).toContain("verifying");
    expect(progress).toContain("installing");
  });
});
