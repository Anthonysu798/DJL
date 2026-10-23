import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { unlink } from "node:fs/promises";
const exec = promisify(execFile);
export interface ResolvedClip {
  path: string;
  duration: number;
  hasAudio: boolean;
  start: number;
  end: number;
  speed: number;
}
export function validateTimeline(clips: ResolvedClip[]) {
  if (!clips.length || clips.length > 32) throw new Error("A timeline needs 1–32 clips.");
  for (const c of clips)
    if (
      ![c.start, c.end, c.speed, c.duration].every(Number.isFinite) ||
      c.start < 0 ||
      c.end <= c.start ||
      c.end > c.duration + 0.01 ||
      c.speed < 0.5 ||
      c.speed > 2
    )
      throw new Error("Invalid clip trim or speed.");
  if (clips.reduce((s, c) => s + (c.end - c.start) / c.speed, 0) > 1800)
    throw new Error("Export is limited to 30 minutes.");
}
export function buildVideoArguments(
  clips: ResolvedClip[],
  output: string,
  width: number,
  height: number,
) {
  validateTimeline(clips);
  if (![720, 1080, 1280, 1920].includes(width) || ![720, 1080, 1280, 1920].includes(height))
    throw new Error("Unsupported export resolution.");
  const args = ["-hide_banner", "-nostdin", "-y"];
  for (const c of clips) args.push("-protocol_whitelist", "file,pipe", "-i", c.path);
  const filters = clips.flatMap((c, i) => [
    `[${i}:v]trim=start=${c.start}:end=${c.end},setpts=(PTS-STARTPTS)/${c.speed},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`,
    c.hasAudio
      ? `[${i}:a]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS,atempo=${c.speed},aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${(c.end - c.start) / c.speed}[a${i}]`,
  ]);
  filters.push(
    clips.map((_, i) => `[v${i}][a${i}]`).join("") + `concat=n=${clips.length}:v=1:a=1[v][a]`,
  );
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    output,
  );
  return args;
}
export async function exportTimeline(
  clips: ResolvedClip[],
  output: string,
  width: number,
  height: number,
  signal?: AbortSignal,
) {
  try {
    await exec(
      process.env.DJL_FFMPEG_PATH || "ffmpeg",
      buildVideoArguments(clips, output, width, height),
      { timeout: 600000, maxBuffer: 4 * 1024 * 1024, ...(signal ? { signal } : {}) },
    );
  } catch (error) {
    await unlink(output).catch(() => undefined);
    throw new Error(
      error instanceof Error && error.name === "AbortError"
        ? "Export canceled."
        : "Video export failed. Verify FFmpeg is installed and supports H.264/AAC.",
      { cause: error },
    );
  }
}
