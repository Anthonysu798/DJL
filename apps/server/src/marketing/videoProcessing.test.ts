import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { expect, it } from "vitest";
import { renderVideoClip, validateVideoClips, VIDEO_MAX_BYTES } from "./videoProcessing";

const exec = promisify(execFile);

it("exports the chosen side of a manual crop and a real cover, preserving the source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "djl-crop-proof-"));
  try {
    const source = path.join(root, "source.mp4");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=320x240:d=1:r=10,drawbox=x=160:y=0:w=160:h=240:color=blue:t=fill",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      source,
    ]);
    const original = await readFile(source);
    const colors: number[][] = [];
    for (const x of [0, 1]) {
      const dir = path.join(root, String(x));
      await mkdir(dir);
      const result = await renderVideoClip(
        source,
        { start: 0, end: 1, crop: "vertical", focalPoint: { x, y: 0.5 }, coverAt: 0.3 },
        dir,
        new AbortController().signal,
      );
      expect(result.meta.width / result.meta.height).toBeCloseTo(9 / 16);
      expect(result.meta.duration).toBeCloseTo(1, 1);
      expect(result.bytes).toBeLessThanOrEqual(VIDEO_MAX_BYTES);
      colors.push(
        Array.from(await sharp(result.cover).resize(1, 1).removeAlpha().raw().toBuffer()),
      );
    }
    expect(colors[0]![0]).toBeGreaterThan(200);
    expect(colors[0]![2]).toBeLessThan(30);
    expect(colors[1]![2]).toBeGreaterThan(200);
    expect(colors[1]![0]).toBeLessThan(30);
    expect(await readFile(source)).toEqual(original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("compresses a genuinely oversized noisy export below 25 MB without truncating it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "djl-compression-test-"));
  try {
    const source = path.join(root, "source.mp4");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=black:s=1280x720:r=30:d=8,noise=alls=100:allf=t+u",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "23",
      source,
    ]);
    const sourceSize = (await stat(source)).size;
    expect(sourceSize).toBeGreaterThan(VIDEO_MAX_BYTES);
    expect(sourceSize).toBeLessThanOrEqual(256 * 1024 * 1024);
    const dir = path.join(root, "render");
    await mkdir(dir);
    const result = await renderVideoClip(
      source,
      { start: 0, end: 8, crop: "original" },
      dir,
      new AbortController().signal,
    );
    expect(result.bytes).toBeLessThanOrEqual(VIDEO_MAX_BYTES);
    expect(result.meta.duration).toBeCloseTo(8, 1);
    expect((await stat(source)).size).toBe(sourceSize);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 90000);

it("stops after three oversized encodes and preserves the original", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "djl-compression-limit-"));
  const saved = process.env.DJL_FFMPEG_PATH;
  try {
    const source = path.join(root, "source.mp4"),
      binary = path.join(root, "encoder");
    await writeFile(source, "original source");
    const calls = path.join(root, "calls");
    // Simulate an encoder that ignores the requested bitrate and always exceeds the cap.
    await writeFile(
      binary,
      `#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(calls)},'encode\\n');fs.writeFileSync(process.argv.at(-1),Buffer.alloc(${VIDEO_MAX_BYTES + 1}));\n`,
    );
    await chmod(binary, 0o700);
    process.env.DJL_FFMPEG_PATH = binary;
    await expect(
      renderVideoClip(
        source,
        { start: 0, end: 1, crop: "original" },
        root,
        new AbortController().signal,
      ),
    ).rejects.toThrow("25 MB");
    expect((await readFile(calls, "utf8")).trim().split("\n")).toHaveLength(3);
    expect(await readFile(source, "utf8")).toBe("original source");
  } finally {
    if (saved === undefined) delete process.env.DJL_FFMPEG_PATH;
    else process.env.DJL_FFMPEG_PATH = saved;
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects invalid crop coordinates and subtitle control syntax before encoding", () => {
  for (const focalPoint of [
    { x: -1, y: 0 },
    { x: 0.5, y: NaN },
    { x: Infinity, y: 1 },
  ]) {
    expect(() =>
      validateVideoClips([{ start: 0, end: 1, crop: "vertical", focalPoint }], 2),
    ).toThrow("Crop position");
  }
  for (const text of ["{\\pos(1,1)}", "line\nbreak", ""]) {
    expect(() =>
      validateVideoClips(
        [{ start: 0, end: 1, crop: "original", subtitles: [{ start: 0, end: 1, text }] }],
        2,
      ),
    ).toThrow("Subtitles");
  }
});
