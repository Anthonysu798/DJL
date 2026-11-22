/**
 * Instagram confirms a share without saying where the post went, so DJL looks the way a person
 * would: it opens their own profile, then the newest posts, and keeps the one made at that moment.
 * Both scripts only read what the page already shows.
 */
const waitFor = (read: string, otherwise: string) => `(async () => {
  for (let attempt = 0; attempt < 16; attempt++) {
    const found = ${read};
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return ${otherwise};
})()`;

/** On a profile page: the codes of the posts in its grid, in the order shown. */
export const INSTAGRAM_GRID_SCRIPT = waitFor(
  `(() => { const codes = Array.from(document.querySelectorAll("main a[href]")).map((link) => /\\/(?:p|reel)\\/([\\w-]+)\\/?$/.exec(link.pathname)?.[1]).filter(Boolean); return codes.length ? codes.slice(0, 12) : null; })()`,
  "[]",
);
/** On a post's page: when it was published. Comments carry later times, so the earliest is the post's. */
export const INSTAGRAM_POST_TIME_SCRIPT = waitFor(
  `Array.from(document.querySelectorAll("main time[datetime]")).map((time) => time.getAttribute("datetime")).filter(Boolean).sort()[0]`,
  "null",
);

/** The first few posts worth opening: pinned ones sit above the newest, and there are at most three. */
export function gridCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const codes = value.filter(
    (code): code is string => typeof code === "string" && /^[\w-]{5,40}$/.test(code),
  );
  return [...new Set(codes)].slice(0, 4);
}

/** True for a post published around the moment this one was sent, never an older or much later one. */
export function madeByThisShare(postedAt: unknown, submittedAt: string) {
  if (typeof postedAt !== "string") return false;
  const seconds = (Date.parse(postedAt) - Date.parse(submittedAt)) / 1000;
  return seconds >= -300 && seconds <= 900;
}
