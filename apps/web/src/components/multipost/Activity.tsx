import type { ReactNode } from "react";
import type {
  MultiPostAccount,
  MultiPostCommand,
  MultiPostJob,
  MultiPostJobState,
} from "@djl/contracts";
import { Button } from "~/components/ui/button";
import { PlatformMark } from "./PlatformMark";
import { explainProblem } from "./problems";
import { useMultiPostLocale, useMultiPostText } from "./shared";

type Tone = "busy" | "good" | "warn" | "bad" | "idle";
const tones: Record<MultiPostJobState, Tone> = {
  queued: "idle",
  preparing: "busy",
  submitting: "busy",
  prepared: "warn",
  "scheduled-on-platform": "idle",
  published: "good",
  delivered: "good",
  "needs-login": "warn",
  missed: "warn",
  uncertain: "warn",
  failed: "bad",
  cancelled: "idle",
};
const cancellable = new Set<MultiPostJobState>([
  "queued",
  "preparing",
  "prepared",
  "scheduled-on-platform",
  "uncertain",
]);
const time = (job: MultiPostJob, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(job.snapshot.data.scheduledPublishTime ?? job.dueAt),
  );
export const needsAttention = (job: MultiPostJob) =>
  ["needs-login", "missed", "failed", "uncertain"].includes(job.state) ||
  (job.state === "prepared" && Boolean(job.evidence?.requiresManual));

/** Every post as one line a person can read, with the single next step when there is one. */
export function Activity({
  jobs,
  accounts,
  busy,
  onCommand,
  onAccounts,
}: {
  jobs: MultiPostJob[];
  accounts: MultiPostAccount[];
  busy?: boolean;
  onCommand: (command: MultiPostCommand) => void;
  onAccounts?: () => void;
}) {
  const l = useMultiPostText();
  const locale = useMultiPostLocale();
  return (
    <ul className="mp-activity">
      {jobs.map((job) => {
        const account = accounts.find((x) => x.id === job.accountId);
        const waitingForTime = job.state === "queued" && Date.parse(job.dueAt) > Date.now();
        const manual = job.state === "prepared" && job.evidence?.requiresManual;
        const act = (
          action: "retry-job" | "verify-job" | "open-job" | "cancel-job" | "close-job",
        ) => onCommand({ action, jobId: job.id });
        const text: Record<MultiPostJobState, [string, string, string?, string?]> = {
          queued: waitingForTime
            ? ["stScheduled", "Scheduled", "stScheduledHint", "Goes out at {{time}}."]
            : ["stWaiting", "Waiting", "stWaitingHint", "Starts in a moment."],
          preparing: ["stPosting", "Posting…", "stPostingHint", "DJL is filling in your post."],
          submitting: ["stPosting", "Posting…", "stPostingHint", "DJL is filling in your post."],
          prepared: manual
            ? [
                "stOneStep",
                "One step left",
                "stOneStepHint",
                "Your post is filled in. Press the final Publish button in the window.",
              ]
            : ["stPosting", "Posting…", "stPostingHint", "DJL is filling in your post."],
          "scheduled-on-platform": [
            "stPlatformScheduled",
            "Scheduled on the platform",
            "stPlatformScheduledHint",
            "The platform will publish it at {{time}}.",
          ],
          published: ["stPosted", "Posted"],
          delivered: ["stSent", "Sent"],
          "needs-login": [
            "stSignIn",
            "Sign in again",
            "stSignInHint",
            "This account was signed out. Sign in, then try again.",
          ],
          missed: [
            "stMissed",
            "Missed",
            "stMissedHint",
            "Your computer was off or asleep at the scheduled time.",
          ],
          uncertain: [
            "stUnsure",
            "Not sure it posted",
            "stUnsureHint",
            "Check first, so it is not posted twice.",
          ],
          failed: ["stFailed", "Didn't post"],
          cancelled: ["stCancelled", "Cancelled"],
        };
        const [key, label, hintKey, hint] = text[job.state];
        const retryable =
          !job.submittedAt && ["missed", "failed", "needs-login"].includes(job.state);
        const problem = explainProblem(job);
        const actions: ReactNode[] = [];
        if (job.evidence?.postUrl)
          actions.push(
            <a key="view" href={job.evidence.postUrl} target="_blank" rel="noopener noreferrer">
              {l("viewPost", "View post")} ↗
            </a>,
          );
        if (manual)
          actions.push(
            <Button key="open" size="sm" onClick={() => act("open-job")}>
              {l("openTheWindow", "Open the window")}
            </Button>,
          );
        if ((job.state === "needs-login" || problem?.fix === "accounts") && onAccounts)
          actions.push(
            <Button key="accounts" size="sm" onClick={onAccounts}>
              {l("goToAccounts", "Go to Accounts")}
            </Button>,
          );
        if (retryable)
          actions.push(
            <Button
              key="retry"
              size="sm"
              variant={job.state === "needs-login" ? "outline" : "default"}
              disabled={busy}
              onClick={() => act("retry-job")}
            >
              {job.state === "missed" ? l("postItNow", "Post it now") : l("tryAgain", "Try again")}
            </Button>,
          );
        if (manual || ["scheduled-on-platform", "uncertain"].includes(job.state))
          actions.push(
            <Button key="verify" size="sm" variant="outline" onClick={() => act("verify-job")}>
              {l("checkPosted", "Check if it posted")}
            </Button>,
          );
        if (cancellable.has(job.state))
          actions.push(
            <Button
              key="cancel"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => act("cancel-job")}
            >
              {l("cancel", "Cancel")}
            </Button>,
          );
        return (
          <li className="mp-job" id={`mp-job-${job.id}`} key={job.id} data-tone={tones[job.state]}>
            <PlatformMark
              platformKey={account?.platformKey ?? ""}
              name={account?.label ?? job.adapterId}
            />
            <div className="mp-job-body">
              <div className="mp-job-head">
                <strong>{account?.label ?? l("removedAccount", "Removed account")}</strong>
                <span className="mp-pill" data-tone={tones[job.state]}>
                  {l(key, label)}
                </span>
                <time className="mp-muted" dateTime={job.dueAt}>
                  {time(job, locale)}
                </time>
              </div>
              <p className="mp-job-text">
                {job.snapshot.data.title ||
                  job.target.overrides?.content ||
                  job.snapshot.data.content ||
                  job.snapshot.data.description ||
                  l("untitled", "Untitled post")}
              </p>
              {hintKey && hint && (
                <p className="mp-muted">{l(hintKey, hint, { time: time(job, locale) })}</p>
              )}
              {problem && <p className="mp-error">{l(problem.key, problem.text)}</p>}
              {job.error && (
                <details className="mp-details">
                  <summary>{l("technicalDetails", "Technical details")}</summary>
                  <p>{job.error}</p>
                </details>
              )}
              {job.evidence?.message && !manual && (
                <p className="mp-muted">{job.evidence.message}</p>
              )}
              {actions.length > 0 && <div className="mp-actions">{actions}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
