import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ImageRecipe } from "@synara/contracts";
const exec = promisify(execFile);
const maxPixels = 80_000_000;
export async function inspectImage(bytes: Uint8Array) {
  const meta = await sharp(bytes, { limitInputPixels: maxPixels, failOn: "error" }).metadata();
  if (
    !meta.width ||
    !meta.height ||
    !["jpeg", "png", "webp", "tiff", "heif", "avif"].includes(meta.format ?? "")
  )
    throw new Error("Unsupported image format.");
  return {
    width: meta.width,
    height: meta.height,
    mime: `image/${meta.format === "heif" ? "heic" : meta.format}`,
  };
}
export async function renderImage(bytes: Uint8Array, recipe: ImageRecipe) {
  for (const dimension of [recipe.width, recipe.height])
    if (dimension !== null && (!Number.isInteger(dimension) || dimension < 1 || dimension > 8192))
      throw new Error("Export dimensions must be between 1 and 8192 pixels.");
  if (
    ![
      recipe.exposure,
      recipe.contrast,
      recipe.saturation,
      recipe.temperature,
      recipe.rotation,
    ].every(Number.isFinite) ||
    Math.abs(recipe.exposure) > 3 ||
    recipe.contrast < 0 ||
    recipe.contrast > 3 ||
    recipe.saturation < 0 ||
    recipe.saturation > 3 ||
    Math.abs(recipe.temperature) > 1 ||
    ![0, 90, 180, 270].includes(recipe.rotation)
  )
    throw new Error("Invalid image adjustment.");
  let pipeline = sharp(bytes, { limitInputPixels: maxPixels, failOn: "error" })
    .autoOrient()
    .toColourspace("srgb")
    .rotate(recipe.rotation);
  if (recipe.flip) pipeline = pipeline.flop();
  if (recipe.width || recipe.height)
    pipeline = pipeline.resize(recipe.width, recipe.height, {
      fit: "inside",
      withoutEnlargement: true,
    });
  pipeline = pipeline
    .modulate({ brightness: 2 ** recipe.exposure, saturation: recipe.saturation })
    .linear(recipe.contrast, 128 * (1 - recipe.contrast));
  if (recipe.temperature !== 0)
    pipeline = pipeline.recomb([
      [1 + recipe.temperature * 0.15, 0, 0],
      [0, 1, 0],
      [0, 0, 1 - recipe.temperature * 0.15],
    ]);
  return pipeline.png().toBuffer();
}
export async function inspectVideo(path: string) {
  const { stdout } = await exec(
    process.env.DJL_FFPROBE_PATH || "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      path,
    ],
    { timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  const result = JSON.parse(stdout) as {
    streams: { codec_type: string; width?: number; height?: number }[];
    format: { duration?: string };
  };
  const video = result.streams.find((s) => s.codec_type === "video");
  if (!video?.width || !video.height) throw new Error("No supported video stream found.");
  const duration = Number(result.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Invalid video duration.");
  return {
    width: video.width,
    height: video.height,
    duration,
    hasAudio: result.streams.some((s) => s.codec_type === "audio"),
  };
}
