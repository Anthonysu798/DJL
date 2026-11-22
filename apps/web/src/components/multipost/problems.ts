import type { MultiPostJob } from "@djl/contracts";

/** What to tell a person, and the one thing they can do about it. */
export interface Problem {
  key: string;
  text: string;
  fix: "retry" | "accounts" | null;
}
const causes: [RegExp, Problem][] = [
  [
    /daily limit|quota/i,
    {
      key: "whyLimit",
      text: "Autopilot reached today's limit for this account. Raise the limit in Accounts, or try again tomorrow.",
      fix: "accounts",
    },
  ],
  [
    /account changed|verify the selected|connect the selected|identity/i,
    { key: "whyAccount", text: "This account needs you to sign in again.", fix: "accounts" },
  ],
  [
    /autopilot is off|approval is no longer|authorization expired|revoked/i,
    {
      key: "whyPermission",
      text: "This post no longer has your OK. Press Try again to send it.",
      fix: "retry",
    },
  ],
  [
    /fetch failed|econn|enotfound|network|offline|timed out|timeout|open djl desktop/i,
    {
      key: "whyConnection",
      text: "DJL lost its connection while posting. Check your internet, then try again.",
      fix: "retry",
    },
  ],
  [
    /prepared page|window|cancelled/i,
    {
      key: "whyClosed",
      text: "The posting window closed before the post was finished. Try again and leave it open.",
      fix: "retry",
    },
  ],
  [
    /media|file|image|photo|video|upload/i,
    {
      key: "whyMedia",
      text: "The photo or video couldn't be added. Try again, or use a different file.",
      fix: "retry",
    },
  ],
];
/** Turns whatever went wrong into words a person can act on. The raw text stays available. */
export function explainProblem(job: Pick<MultiPostJob, "state" | "error">): Problem | null {
  if (job.state !== "failed") return null;
  return (
    causes.find(([pattern]) => pattern.test(job.error ?? ""))?.[1] ?? {
      key: "whyUnknown",
      text: "Something went wrong while posting. Try again.",
      fix: "retry",
    }
  );
}
