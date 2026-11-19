import type { AgentVideoSubtitle } from "@synara/contracts";

function timestamp(value: string) {
  const match = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)[,.](\d{3})$/.exec(value.trim());
  if (!match) throw new Error("Use valid SRT or WebVTT timestamps.");
  return (
    Number(match[1] ?? 0) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4]) / 1000
  );
}

/** Imported cues remain supplied text; parsing never claims they came from the source audio. */
export function parseVideoSubtitles(text: string): AgentVideoSubtitle[] {
  if (text.length > 256_000) throw new Error("Subtitle files must be below 256 KB.");
  const blocks = text
    .replace(/^\uFEFF/, "")
    .replaceAll("\r\n", "\n")
    .trim()
    .split(/\n\s*\n/);
  const segments: AgentVideoSubtitle[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (/^(WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0] ?? "")) continue;
    const timing = lines.findIndex((line) => line.includes("-->"));
    if (timing < 0 || timing > 1) throw new Error("Each subtitle needs a timestamp line and text.");
    const [from, to] = lines[timing]!.split(/\s+-->\s+/);
    const start = timestamp(from ?? ""),
      end = timestamp((to ?? "").split(/\s+/)[0] ?? "");
    const caption = lines
      .slice(timing + 1)
      .join(" ")
      .trim();
    if (
      start < (segments.at(-1)?.end ?? 0) ||
      end <= start ||
      !caption ||
      caption.length > 1000 ||
      /[{}\\<>]/.test(caption) ||
      [...caption].some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error(
        "Use ordered, non-overlapping subtitles with plain text (no markup), up to 1000 characters per cue.",
      );
    segments.push({ start, end, text: caption });
  }
  if (!segments.length || segments.length > 60)
    throw new Error("Import 1–60 subtitle cues at a time.");
  return segments;
}
