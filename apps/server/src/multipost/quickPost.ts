import type {
  MultiPostAccount,
  MultiPostCapability,
  MultiPostContentData,
  MultiPostFile,
  MultiPostQuickPostResult,
  MultiPostTarget,
} from "@synara/contracts";

type Skipped = MultiPostQuickPostResult["skipped"][number];
/** Platforms whose regular post cannot be text alone. */
const MEDIA_REQUIRED = new Set(["instagram", "pinterest", "rednote"]);

/** Chooses, per account, the kind of post its platform accepts for this content. */
export function planQuickPost(
  capabilities: readonly MultiPostCapability[],
  accounts: readonly MultiPostAccount[],
  files: readonly MultiPostFile[],
) {
  const videos = files.filter((file) => file.type?.startsWith("video/"));
  const oneVideoOnly = videos.length === 1 && files.length === 1;
  const targets: Record<"dynamic" | "video", MultiPostTarget[]> = { dynamic: [], video: [] };
  const skipped: Skipped[] = [];
  for (const account of accounts) {
    const adapter = (kind: "dynamic" | "video") =>
      capabilities.find((x) => x.platformKey === account.platformKey && x.kind === kind);
    const dynamic = adapter("dynamic");
    const video = adapter("video");
    const skip = (reason: Skipped["reason"]) =>
      skipped.push({ accountId: account.id, label: account.label, reason });
    if (video && oneVideoOnly) targets.video.push({ accountId: account.id, adapterId: video.id });
    else if (dynamic && !files.length && MEDIA_REQUIRED.has(account.platformKey))
      skip("needs-media");
    else if (dynamic) targets.dynamic.push({ accountId: account.id, adapterId: dynamic.id });
    else if (video && videos.length)
      targets.video.push({ accountId: account.id, adapterId: video.id });
    else skip(video ? "needs-video" : "unsupported");
  }
  return { targets, skipped };
}

/** Most platforms print the title above the caption, so a regular post gets no invented title. */
export function quickPostContent(
  kind: "dynamic" | "video",
  text: string,
  title: string | undefined,
  files: readonly MultiPostFile[],
): MultiPostContentData {
  const images = files.filter((file) => file.type?.startsWith("image/"));
  const videos = files.filter((file) => file.type?.startsWith("video/"));
  if (kind === "dynamic")
    return {
      title: title ?? "",
      content: text,
      ...(images.length ? { images } : {}),
      ...(videos.length ? { videos } : {}),
    };
  const [first = "", ...rest] = text.split("\n");
  return title
    ? { title, content: text, video: videos[0]! }
    : { title: first.trim().slice(0, 100), content: rest.join("\n").trim(), video: videos[0]! };
}

const reasons: Record<Skipped["reason"], string> = {
  "needs-video": "needs a video",
  "needs-media": "needs a photo or video",
  unsupported: "only takes articles or podcasts; use the advanced editor",
};
export const describeSkipped = (skipped: readonly Skipped[]) =>
  skipped.map((x) => `${x.label} ${reasons[x.reason]}`).join("; ");
