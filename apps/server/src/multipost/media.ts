import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { mkdir, stat, copyFile, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { MultiPostFile, MultiPostScope } from "@synara/contracts";
import { scopedAttachmentInputFiles } from "../work/scopedAttachments";
import { resolveAuthorizedInputPath } from "../work/documentTools";
export const multiPostMediaTypes: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export async function multiPostAttachments(scope: MultiPostScope) {
  if (scope.attachmentsRoot) await mkdir(scope.attachmentsRoot, { recursive: true, mode: 0o700 });
  return scopedAttachmentInputFiles(scope);
}
export async function resolveMultiPostMedia(scope: MultiPostScope, input: string) {
  const own = await multiPostAttachments(scope);
  const alias = input.startsWith("Attachments/")
    ? own.find((file) => path.basename(file) === input.slice(12))
    : undefined;
  if (input.startsWith("Attachments/") && !alias)
    throw new Error("Attachment belongs to another conversation or is missing");
  const full = await resolveAuthorizedInputPath(scope.authorizedRoot, alias ?? input, own);
  const info = await stat(full);
  const name = path.basename(full);
  const type = multiPostMediaTypes[name.split(".").pop()?.toLowerCase() ?? ""];
  if (!type || !info.isFile()) throw new Error("Choose a supported media file");
  if (info.size > 100 * 1024 * 1024) throw new Error("Media exceeds the 100 MiB limit");
  return { full, name, type, size: info.size };
}
export async function importMultiPostMedia(
  scope: MultiPostScope,
  paths: string[],
): Promise<MultiPostFile[]> {
  if (!scope.mediaRoot) throw new Error("MultiPost media storage is unavailable");
  if (!Array.isArray(paths) || !paths.length || paths.length > 20)
    throw new Error("Choose one to twenty media files");
  await mkdir(scope.mediaRoot, { recursive: true, mode: 0o700 });
  const results: MultiPostFile[] = [];
  for (const input of paths) {
    const file = await resolveMultiPostMedia(scope, input);
    const hash = createHash("sha256");
    await pipeline(createReadStream(file.full), hash);
    const key = hash.digest("hex").slice(0, 32);
    const id = `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}`;
    await copyFile(file.full, path.join(scope.mediaRoot, id));
    await writeFile(
      path.join(scope.mediaRoot, id + ".json"),
      JSON.stringify({ name: file.name, type: file.type, size: file.size }),
      { mode: 0o600 },
    );
    results.push({ name: file.name, type: file.type, size: file.size, url: `Media/${id}` });
  }
  return results;
}
const at = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);
/** The largest part of a photo with this shape, slid toward `focus`; null when it already fits. */
export function cropBox(
  width: number,
  height: number,
  ratio: number,
  focus: { x: number; y: number } = { x: 0.5, y: 0.5 },
) {
  if (Math.abs(width / height - ratio) <= ratio * 0.01) return null;
  const w = Math.min(width, Math.round(height * ratio));
  const h = Math.min(height, Math.round(width / ratio));
  return {
    left: Math.round((width - w) * at(focus.x)),
    top: Math.round((height - h) * at(focus.y)),
    width: w,
    height: h,
  };
}
/**
 * A copy of a stored photo cut to `ratio` around its focus. Anything DJL cannot crop (a link, a
 * video, an animation, a format it cannot read) goes out as it is, and the platform crops it.
 */
export async function cropMedia(
  scope: MultiPostScope,
  file: MultiPostFile,
  ratio: number,
): Promise<MultiPostFile> {
  const id = file.url.startsWith("Media/") ? file.url.slice(6) : "";
  if (!scope.mediaRoot || !/^[a-f0-9-]{36}$/.test(id)) return file;
  if (!/^image\/(jpeg|png|webp|avif|heic)$/.test(file.type ?? "")) return file;
  try {
    const { data, info } = await sharp(path.join(scope.mediaRoot, id))
      .rotate()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const box = cropBox(info.width, info.height, ratio, file.focus);
    if (!box) return file;
    const png = file.type === "image/png";
    const { width, height, channels } = info;
    const cropped = sharp(data, { raw: { width, height, channels } }).extract(box);
    const bytes = await (png ? cropped.png() : cropped.jpeg({ quality: 92 })).toBuffer();
    const name = file.name.replace(/\.[^.]*$/, "") + (png ? ".png" : ".jpg");
    const type = png ? "image/png" : "image/jpeg";
    const key = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    const saved = `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}`;
    await writeFile(path.join(scope.mediaRoot, saved), bytes, { mode: 0o600 });
    await writeFile(
      path.join(scope.mediaRoot, saved + ".json"),
      JSON.stringify({ name, type, size: bytes.length }),
      { mode: 0o600 },
    );
    return { name, type, size: bytes.length, url: `Media/${saved}` };
  } catch {
    return file;
  }
}
/** Accepts what a person uploaded or what an agent names: files, `Media/` references or paths. */
export async function quickPostMedia(
  scope: MultiPostScope,
  items: readonly (string | MultiPostFile)[],
): Promise<MultiPostFile[]> {
  if (!Array.isArray(items) || items.length > 20) throw new Error("Add at most twenty files");
  const files: MultiPostFile[] = [];
  for (const item of items) {
    if (typeof item === "string" && !item.startsWith("Media/")) {
      files.push(...(await importMultiPostMedia(scope, [item])));
      continue;
    }
    const url = typeof item === "string" ? item : item?.url;
    if (typeof url !== "string") throw new Error("Choose a supported media file");
    if (typeof item !== "string" && item.type) {
      files.push(item);
      continue;
    }
    const id = url.slice(6);
    if (!scope.mediaRoot || !/^[a-f0-9-]{36}$/.test(id)) throw new Error("Unknown media");
    const saved = JSON.parse(await readFile(path.join(scope.mediaRoot, id + ".json"), "utf8")) as {
      name: string;
      type: string;
      size: number;
    };
    files.push({ ...saved, url });
  }
  const unsupported = files.find((file) => !/^(image|video)\//.test(file.type ?? ""));
  if (unsupported)
    throw new Error(`${unsupported.name} is not a photo or video; use the advanced editor for it`);
  return files;
}
