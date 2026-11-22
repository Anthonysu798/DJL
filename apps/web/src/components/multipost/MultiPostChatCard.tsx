import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MultiPostJob, MultiPostState } from "@synara/contracts";
import { Button } from "~/components/ui/button";
import { multiPostCommand, multiPostState } from "./client";
import { latestPost, postViewUrl } from "./chatResult";
import { MultiPostReview } from "./MultiPostReview";
import { PlatformMark } from "./PlatformMark";
import { platformName, useMultiPostLocale, useMultiPostText } from "./shared";

type Tone = "good" | "busy" | "idle" | "bad" | "warn" | "undo" | "retry";
function tone(job: MultiPostJob, now: number): Tone {
  if (job.state === "published" || job.state === "delivered") return "good";
  if (job.state === "failed") return "bad";
  if (job.state === "scheduled-on-platform") return "idle";
  // The connection dropped before anything was sent, and DJL is about to try once more.
  if (job.state === "queued" && job.retriedAt && Date.parse(job.dueAt) > now) return "retry";
  if (job.state === "queued" && Date.parse(job.dueAt) > now)
    // An Autopilot post nobody pressed a button for waits a moment so it can be stopped.
    return job.autopilot && !job.snapshot.scheduledAt ? "undo" : "idle";
  if (job.state === "queued") return "busy";
  if (job.state === "preparing" || job.state === "submitting") return "busy";
  return job.state === "prepared" && !job.evidence?.requiresManual ? "busy" : "warn";
}

/** In the chat: a preview to approve, then one line saying how the newest post went. */
export function MultiPostChatCard({
  threadId,
  onSeeAll,
}: {
  threadId: string;
  onSeeAll?: () => void;
}) {
  const l = useMultiPostText();
  const locale = useMultiPostLocale();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["multipost", threadId],
    queryFn: () => multiPostState(threadId),
    retry: false,
    refetchInterval: 3000,
  });
  const [now, setNow] = useState(() => Date.now());
  const counting = query.data?.jobs.some(
    (job) => job.threadId === threadId && ["undo", "retry"].includes(tone(job, now)),
  );
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [counting]);
  if (!query.data) return null;
  const state: MultiPostState = query.data;
  const updated = () => {
    void client.invalidateQueries({ queryKey: ["multipost"] });
  };
  const { latest, earlier } = latestPost(state.jobs.filter((job) => job.threadId === threadId));
  const line = (job: MultiPostJob) => {
    const account = state.accounts.find((x) => x.id === job.accountId);
    const platform = state.capabilities.find((x) => x.platformKey === account?.platformKey);
    const twins = state.accounts.filter(
      (x) => x.platformKey === account?.platformKey && x.status === "connected",
    );
    const name =
      (twins.length < 2 && platform && platformName(platform)) || account?.label || job.adapterId;
    const kind = tone(job, now);
    const url = kind === "good" ? postViewUrl(job, account) : undefined;
    const n = Math.max(1, Math.ceil((Date.parse(job.dueAt) - now) / 1000));
    const time = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(job.snapshot.data.scheduledPublishTime ?? job.dueAt));
    return (
      <li className="mp-result-line" data-tone={kind} key={job.id}>
        <PlatformMark platformKey={account?.platformKey ?? ""} name={name} />
        <span className="mp-result-text" role="status">
          {kind === "good"
            ? l("chatPosted", "Your post is live on {{name}}.", { name })
            : kind === "undo"
              ? l("chatUndo", "Posting to {{name}} in {{n}}…", { name, n })
              : kind === "retry"
                ? l("chatRetrying", "The connection dropped. Trying {{name}} again in {{n}}…", {
                    name,
                    n,
                  })
                : kind === "busy"
                  ? l("chatPosting", "Posting to {{name}}…", { name })
                  : kind === "idle"
                    ? l("chatScheduled", "Scheduled for {{name}}: {{time}}.", { name, time })
                    : kind === "bad"
                      ? l("chatFailed", "Couldn't post to {{name}}.", { name })
                      : l("chatNeedsYou", "Your {{name}} post needs you.", { name })}
        </span>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer">
            {l("chatView", "View it")}
            <span aria-hidden="true"> ↗</span>
          </a>
        )}
        {(kind === "undo" || kind === "retry") && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void multiPostCommand(threadId, { action: "cancel-job", jobId: job.id }).then(
                updated,
                updated,
              )
            }
          >
            {l("chatStop", "Don't post")}
          </Button>
        )}
        {kind === "bad" && !job.submittedAt && (
          <Button
            size="sm"
            onClick={() =>
              void multiPostCommand(threadId, { action: "retry-job", jobId: job.id }).then(
                updated,
                updated,
              )
            }
          >
            {l("tryAgain", "Try again")}
          </Button>
        )}
        {kind === "warn" && onSeeAll && (
          <Button size="sm" onClick={onSeeAll}>
            {l("chatSeeWhy", "See what to do")}
          </Button>
        )}
      </li>
    );
  };
  return (
    <>
      {state.drafts
        .filter(
          (d) =>
            d.threadId === threadId &&
            !state.jobs.some((j) => j.draftId === d.id && j.revision === d.revision),
        )
        .map((d) => (
          <MultiPostReview
            key={`${d.id}-${d.revision}`}
            threadId={threadId}
            draft={d}
            accounts={state.accounts}
            onUpdated={updated}
          />
        ))}
      {latest.length > 0 && (
        <section className="mp-result">
          <ul>{latest.map(line)}</ul>
          {earlier > 0 && onSeeAll && (
            <button type="button" className="mp-result-all" onClick={onSeeAll}>
              {l("chatAllPosts", "All posts")}
            </button>
          )}
        </section>
      )}
    </>
  );
}
