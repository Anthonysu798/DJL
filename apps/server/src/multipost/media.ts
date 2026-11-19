import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { mkdir, stat, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
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
