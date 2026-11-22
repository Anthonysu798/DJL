import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentVideoClipInput, AgentVideoSubtitle } from "@djl/contracts";
import sharp from "sharp";
import { resolveAuthorizedInputPath } from "../work/documentTools";
import { inspectVideo } from "./media";
import { resolveMediaBinary } from "./mediaBinary";
const exec = promisify(execFile);
export const VIDEO_MAX_BYTES = 25_000_000;
export async function sourceVideo(stateDir: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id))
    throw new Error("Choose a valid campaign video asset ID, never a file path.");
  const root = path.join(stateDir, "marketing", "originals");
  const source = await resolveAuthorizedInputPath(root, id);
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024 * 1024)
    throw new Error("Video must be a regular file up to 256 MB.");
  const meta = await inspectVideo(source).catch(() => {
    throw new Error("Video cannot be decoded. Install FFprobe/FFmpeg and use a valid MP4 or MOV.");
  });
  if (meta.duration > 1800 || meta.width > 8192 || meta.height > 8192)
    throw new Error("Use a video up to 30 minutes and 8192 pixels per side.");
  return { source, meta };
}
export function validateVideoClips(clips: readonly AgentVideoClipInput[], duration: number) {
  if (!clips.length || clips.length > 8) throw new Error("Choose 1–8 clips.");
  let total = 0;
  for (const clip of clips) {
    if (
      ![clip.start, clip.end].every(Number.isFinite) ||
      clip.start < 0 ||
      clip.end <= clip.start ||
      clip.end > duration ||
      clip.end - clip.start > 120
    )
      throw new Error("Each clip must be within the source and no longer than 120 seconds.");
    if (
      clip.coverAt !== undefined &&
      (!Number.isFinite(clip.coverAt) || clip.coverAt < clip.start || clip.coverAt >= clip.end)
    )
      throw new Error("Cover time must be inside its clip on the original timeline.");
    validateSubtitles(clip.subtitles ?? [], clip.start, clip.end);
    if (
      clip.focalPoint &&
      ![clip.focalPoint.x, clip.focalPoint.y].every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      )
    )
      throw new Error("Crop position must be between 0 and 1 on each axis.");
    total += clip.end - clip.start;
  }
  if (total > 600) throw new Error("The combined clips may not exceed 10 minutes.");
}
export function validateSubtitles(
  segments: readonly AgentVideoSubtitle[],
  start: number,
  end: number,
) {
  if (segments.length > 60) throw new Error("Use at most 60 subtitle segments per clip.");
  let previous = start;
  for (const segment of segments) {
    if (
      ![segment.start, segment.end].every(Number.isFinite) ||
      segment.start < previous ||
      segment.end <= segment.start ||
      segment.end > end ||
      !segment.text.trim() ||
      segment.text.length > 1000 ||
      /[{}\\]/.test(segment.text) ||
      [...segment.text].some((c) => c.charCodeAt(0) < 32)
    )
      throw new Error(
        "Subtitles require ordered, non-overlapping source timestamps, plain text and valid clip bounds.",
      );
    previous = segment.end;
  }
}
function time(seconds: number) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
export async function runVideoCommand(args: string[], signal: AbortSignal, cwd?: string) {
  try {
    await exec(
      resolveMediaBinary("ffmpeg"),
      ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args],
      { signal, timeout: 300000, maxBuffer: 2 * 1024 * 1024, ...(cwd ? { cwd } : {}) },
    );
  } catch (error) {
    throw new Error(
      signal.aborted
        ? "Video processing canceled."
        : "FFmpeg failed or is unavailable. Configure DJL_FFMPEG_PATH and DJL_FFPROBE_PATH or install FFmpeg with H.264/AAC support, then retry.",
      { cause: error },
    );
  }
}
export async function renderVideoClip(
  source: string,
  clip: AgentVideoClipInput,
  dir: string,
  signal: AbortSignal,
) {
  const output = path.join(dir, "clip.mp4"),
    cover = path.join(dir, "cover.png");
  const overlayInputs: string[] = [];
  const overlays: string[] = [];
  const filters = [
    clip.crop === "vertical"
      ? `crop='min(iw,ih*9/16)':'min(ih,iw*16/9)':x='(iw-ow)*${clip.focalPoint?.x ?? 0.5}':y='(ih-oh)*${clip.focalPoint?.y ?? 0.5}',scale=720:1280`
      : "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    "setsar=1",
    "fps=30",
  ];
  if (clip.subtitles?.length) {
    await writeFile(
      path.join(dir, "subtitles.srt"),
      clip.subtitles
        .map(
          (s, i) =>
            `${i + 1}\n${time(s.start - clip.start)} --> ${time(s.end - clip.start)}\n${s.text}\n`,
        )
        .join("\n"),
      { mode: 0o600 },
    );
    // Raster text overlays also work on FFmpeg distributions without libass. Keep SRT as the timing source.
    const inputMeta = await inspectVideo(source);
    const width =
      clip.crop === "vertical"
        ? 720
        : Math.max(
            2,
            Math.floor(
              (inputMeta.width * Math.min(1, 1280 / inputMeta.width, 1280 / inputMeta.height)) / 2,
            ) * 2,
          );
    for (const [index, segment] of clip.subtitles.entries()) {
      const file = path.join(dir, `subtitle-${index}.png`);
      const escaped = segment.text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
      const text = await sharp({
        text: {
          text: `<span foreground="white" background="#000000cc">${escaped}</span>`,
          font: "Arial",
          width: Math.floor(width * 0.88),
          height: Math.max(24, Math.floor(width * 0.35)),
          align: "center",
          rgba: true,
        },
      })
        .png()
        .toBuffer();
      await writeFile(file, text, { mode: 0o600 });
      overlayInputs.push("-i", file);
      overlays.push(
        `[caption${index}][${index + 1}:v]overlay=x=(W-w)/2:y=H-h-20:enable='gte(t,${segment.start - clip.start})*lt(t,${segment.end - clip.start})'[caption${index + 1}]`,
      );
    }
  }
  const duration = clip.end - clip.start;
  // Leave room for AAC and MP4 overhead. Retry at most twice if real output exceeds the cap.
  const targetVideoBitrate = Math.max(
    160_000,
    Math.floor((VIDEO_MAX_BYTES * 0.9 * 8) / duration) - 128_000,
  );
  const encode = (bitrate?: number) =>
    runVideoCommand(
      [
        "-protocol_whitelist",
        "file,pipe",
        "-ss",
        String(clip.start),
        "-i",
        source,
        ...overlayInputs,
        "-t",
        String(clip.end - clip.start),
        ...(overlays.length
          ? [
              "-filter_complex",
              `[0:v]${filters.join(",")}[caption0];${overlays.join(";")}`,
              "-map",
              `[caption${overlays.length}]`,
            ]
          : ["-map", "0:v:0", "-vf", filters.join(",")]),
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        ...(bitrate
          ? ["-b:v", String(bitrate), "-maxrate", String(bitrate), "-bufsize", String(bitrate * 2)]
          : ["-crf", "23"]),
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        output,
      ],
      signal,
      dir,
    );
  await encode();
  let size = await stat(output);
  for (let attempt = 0; size.size > VIDEO_MAX_BYTES && attempt < 2; attempt++) {
    await encode(Math.floor(targetVideoBitrate * (attempt === 0 ? 1 : 0.65)));
    size = await stat(output);
  }
  if (size.size <= 0 || size.size > VIDEO_MAX_BYTES)
    throw new Error(
      "Export could not fit within 25 MB after compression. Choose a shorter clip. The original is preserved.",
    );
  const meta = await inspectVideo(output);
  if (Math.abs(meta.duration - (clip.end - clip.start)) > 0.3)
    throw new Error(
      "Video export was truncated or has an unexpected duration. Choose a shorter clip.",
    );
  await runVideoCommand(
    ["-xerror", "-protocol_whitelist", "file,pipe", "-i", output, "-f", "null", "-"],
    signal,
  );
  await runVideoCommand(
    [
      "-protocol_whitelist",
      "file,pipe",
      "-ss",
      String((clip.coverAt ?? clip.start) - clip.start),
      "-i",
      output,
      "-frames:v",
      "1",
      cover,
    ],
    signal,
  );
  if ((await stat(cover)).size > 10 * 1024 * 1024) throw new Error("Cover exceeds 10 MB.");
  return { output, cover, meta, bytes: size.size };
}
export async function extractVideoAudio(
  source: string,
  start: number,
  end: number,
  output: string,
  signal: AbortSignal,
) {
  await runVideoCommand(
    [
      "-protocol_whitelist",
      "file,pipe",
      "-ss",
      String(start),
      "-i",
      source,
      "-t",
      String(end - start),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "24000",
      "-c:a",
      "pcm_s16le",
      "-f",
      "wav",
      output,
    ],
    signal,
  );
  const audio = await readFile(output);
  if (audio.length > 10 * 1024 * 1024 || audio.length < 44)
    throw new Error("Normalized audio must be a WAV file below 10 MB.");
  return audio;
}
