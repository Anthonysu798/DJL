/** How each platform frames a post: picture shape, caption room, and where it folds the caption. */
export interface PostLook {
  /** CSS aspect-ratio of the picture as the feed shows it. */
  ratio: string;
  limit?: number;
  hashtags?: number;
  /** Characters shown before "… more". */
  fold: number;
}
const fallback: PostLook = { ratio: "1 / 1", fold: 200 };
const looks: Record<string, PostLook> = {
  instagram: { ratio: "1 / 1", limit: 2200, hashtags: 30, fold: 125 },
  tiktok: { ratio: "9 / 16", limit: 2200, fold: 90 },
  douyin: { ratio: "9 / 16", limit: 1000, fold: 55 },
  x: { ratio: "16 / 9", limit: 280, fold: 280 },
  threads: { ratio: "4 / 5", limit: 500, fold: 500 },
  facebook: { ratio: "1.91 / 1", fold: 400 },
  linkedin: { ratio: "1.91 / 1", limit: 3000, fold: 210 },
  youtube: { ratio: "16 / 9", limit: 5000, fold: 160 },
  pinterest: { ratio: "2 / 3", limit: 500, fold: 100 },
  rednote: { ratio: "3 / 4", limit: 1000, fold: 100 },
  weibo: { ratio: "1 / 1", limit: 2000, fold: 140 },
  bilibili: { ratio: "16 / 9", limit: 2000, fold: 120 },
};
export const postLook = (platformKey: string) => looks[platformKey] ?? fallback;

export type CaptionWarning =
  | { platformKey: string; kind: "too-long"; over: number }
  | { platformKey: string; kind: "too-many-hashtags"; allowed: number };
/** What a platform would cut off or refuse, found before posting instead of after. */
export function captionWarnings(text: string, platformKeys: readonly string[]): CaptionWarning[] {
  const length = Array.from(text.trim()).length;
  const tags = text.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
  const warnings: CaptionWarning[] = [];
  for (const platformKey of new Set(platformKeys)) {
    const look = postLook(platformKey);
    if (look.limit && length > look.limit)
      warnings.push({ platformKey, kind: "too-long", over: length - look.limit });
    if (look.hashtags && tags > look.hashtags)
      warnings.push({ platformKey, kind: "too-many-hashtags", allowed: look.hashtags });
  }
  return warnings;
}
/** The caption as the feed first shows it. */
export function foldCaption(text: string, platformKey: string) {
  const all = Array.from(text.trim());
  const { fold } = postLook(platformKey);
  return all.length > fold
    ? { shown: all.slice(0, fold).join("").trimEnd(), more: true }
    : { shown: all.join(""), more: false };
}
