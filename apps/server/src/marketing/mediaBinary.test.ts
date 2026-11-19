import { tmpdir } from "node:os";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { resolveMediaBinary } from "./mediaBinary";

it("discovers the matching packaged architecture and honors explicit binary paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "djl-media-binary-"));
  try {
    const resources = path.join(root, "Contents", "Resources", "media", "darwin-arm64");
    await mkdir(resources, { recursive: true });
    const binary = path.join(resources, "ffmpeg");
    await writeFile(binary, "test fixture");
    await chmod(binary, 0o700);
    const options = {
      env: {},
      platform: "darwin" as const,
      arch: "arm64",
      executable: path.join(root, "Contents", "MacOS", "DJL"),
    };
    expect(resolveMediaBinary("ffmpeg", options)).toBe(binary);
    expect(resolveMediaBinary("ffmpeg", { ...options, arch: "x64" })).toBe("ffmpeg");
    expect(resolveMediaBinary("ffprobe", options)).toBe("ffprobe");
    expect(
      resolveMediaBinary("ffmpeg", { ...options, env: { DJL_FFMPEG_PATH: "/custom/ffmpeg" } }),
    ).toBe("/custom/ffmpeg");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
