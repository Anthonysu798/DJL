import type { MultiPostAccount, MultiPostJob } from "@synara/contracts";

const profiles: Record<string, (username: string) => string> = {
  instagram: (name) => `https://www.instagram.com/${name}/`,
  tiktok: (name) => `https://www.tiktok.com/@${name}`,
  x: (name) => `https://x.com/${name}`,
  threads: (name) => `https://www.threads.net/@${name}`,
};
/** The post itself when the platform returned its link, otherwise the profile it now tops. */
export function postViewUrl(job: MultiPostJob, account: MultiPostAccount | undefined) {
  if (job.evidence?.postUrl) return job.evidence.postUrl;
  const username = account?.identity?.username.replace(/^@/, "") ?? "";
  const profile = account && profiles[account.platformKey];
  return profile && /^[\w.-]+$/.test(username) ? profile(username) : account?.homeUrl;
}

/** The chat shows one post: the newest. Everything before it lives in Activity. */
export function latestPost(jobs: readonly MultiPostJob[]) {
  const live = jobs
    .filter((job) => job.state !== "cancelled")
    .toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const newest = live[0] ? Date.parse(live[0].createdAt) : 0;
  // One press can queue several accounts a moment apart.
  const latest = live.filter((job) => newest - Date.parse(job.createdAt) < 10_000);
  return { latest, earlier: live.length - latest.length };
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
/** A preview whose caption has already gone out through MultiPost needs no second card. */
export function alreadySent(captions: Record<string, string>, jobs: readonly MultiPostJob[]) {
  const wanted = new Set(Object.values(captions).map(squash).filter(Boolean));
  return jobs.some((job) => {
    if (job.state === "cancelled") return false;
    const data = { ...job.snapshot.data, ...job.target.overrides };
    return (
      wanted.has(squash(data.content ?? "")) ||
      wanted.has(squash(`${data.title ?? ""} ${data.content ?? ""}`))
    );
  });
}
