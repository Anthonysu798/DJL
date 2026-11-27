// FILE: openableFiles.ts
// Purpose: Which files DJL will hand to the operating system to open in their own app. Files
//          in a chat are written by an agent, so "open" must never mean "run": only document,
//          image and media types pass. Anything else (scripts, apps, shortcuts, web pages,
//          macro-enabled Office files, archives) is shown in its folder instead.
// Layer: Shared utility (no runtime dependencies)

const OPENABLE_DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  // Documents
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "rtf",
  "txt",
  "md",
  "csv",
  "tsv",
  "odt",
  "ods",
  "odp",
  "pages",
  "numbers",
  "key",
  // Images
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "heif",
  "bmp",
  "tiff",
  "avif",
  // Audio and video
  "mp3",
  "wav",
  "m4a",
  "mp4",
  "mov",
]);

export function isOpenableDocumentPath(filePath: string): boolean {
  const name = filePath.split(/[/\\]/).at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  // A leading dot is a hidden file's name, not an extension.
  return dot > 0 && OPENABLE_DOCUMENT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
