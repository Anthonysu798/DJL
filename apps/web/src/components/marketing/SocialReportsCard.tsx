import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Campaign } from "@djl/contracts";
import type {
  CloudSocialReportScheduleInput,
  CloudSocialReportsResponse,
} from "@djl/contracts/cloud";
import FadeContent from "~/components/react-bits/FadeContent";
import { Button } from "~/components/ui/button";
import { publishingCommand } from "./socialPublishingClient";

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const displayDate = (value: string, timezone?: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(value));

/** Saved cloud reports are also delivered by the server into the originating chat. */
export function SocialReportsCard({
  campaign,
  version,
  draftId,
  disabled = false,
}: {
  campaign: Campaign;
  version: number;
  draftId: string;
  disabled?: boolean;
}) {
  const labelId = useId();
  const client = useQueryClient();
  const key = ["social-reports", campaign.threadId, draftId];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      publishingCommand<CloudSocialReportsResponse>(campaign, version, {
        action: "report-state",
        draftId,
      }),
    refetchInterval: 60000,
    retry: false,
  });
  const [pending, setPending] = useState<CloudSocialReportScheduleInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const schedule = pending ??
    query.data?.schedule ?? {
      enabled: false,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      weekday: 1,
      hour: 9,
      minute: 0,
    };
  const time = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
  async function save() {
    setBusy(true);
    setError("");
    try {
      const { enabled, timezone, weekday, hour, minute } = schedule;
      const result = await publishingCommand<CloudSocialReportsResponse>(campaign, version, {
        action: "report-schedule",
        draftId,
        schedule: { enabled, timezone, weekday, hour, minute },
      });
      client.setQueryData(key, result);
      setPending(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your recap preference.");
    } finally {
      setBusy(false);
    }
  }
  const controlsDisabled = disabled || busy || query.isPending;
  return (
    <FadeContent
      effect="fade"
      duration={0.25}
      trigger="mount"
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="space-y-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-foreground"
            checked={schedule.enabled}
            disabled={controlsDisabled}
            onChange={(event) => setPending({ ...schedule, enabled: event.target.checked })}
          />
          <span>
            <span id={labelId} className="text-sm font-medium">
              Weekly in-chat recap
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              Save a weekly summary of this conversation's published posts and available platform
              metrics. Off until you enable and save.
            </span>
          </span>
        </label>
        {schedule.enabled && (
          <div className="flex flex-wrap items-end gap-3 pl-7">
            <label className="text-xs text-muted-foreground">
              Day
              <select
                aria-label="Recap day"
                className="mt-1 block rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                value={schedule.weekday}
                disabled={controlsDisabled}
                onChange={(event) =>
                  setPending({ ...schedule, weekday: Number(event.target.value) })
                }
              >
                {days.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Time
              <input
                aria-label="Recap time"
                type="time"
                className="mt-1 block rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                value={time}
                disabled={controlsDisabled}
                onChange={(event) => {
                  const [hour, minute] = event.target.value.split(":").map(Number);
                  if (hour !== undefined && minute !== undefined)
                    setPending({ ...schedule, hour, minute });
                }}
              />
            </label>
            <span className="pb-2 text-xs text-muted-foreground">{schedule.timezone}</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 pl-7">
          <Button
            size="sm"
            variant="outline"
            disabled={controlsDisabled || pending === null}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save preference"}
          </Button>
          {query.data?.schedule.enabled && query.data.schedule.nextRunAt && (
            <p className="text-xs text-muted-foreground">
              Next recap: {displayDate(query.data.schedule.nextRunAt, query.data.schedule.timezone)}
            </p>
          )}
        </div>
        {(error || query.error) && (
          <p role="alert" className="text-xs text-destructive">
            {error || query.error?.message}
          </p>
        )}
        <p className="pl-7 text-xs leading-relaxed text-muted-foreground">
          Recaps are saved in DJL Cloud while the app is closed and delivered into this chat when
          DJL reconnects. Recent reports also appear below.
        </p>
        {(query.data?.reports ?? []).slice(0, 3).map((report) => (
          <article key={report.id} className="space-y-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <strong className="font-medium">
                {report.publishedPosts} published {report.publishedPosts === 1 ? "post" : "posts"}
              </strong>
              <time className="text-xs text-muted-foreground" dateTime={report.periodEnd}>
                Week ending{" "}
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeZone: query.data?.schedule.timezone,
                }).format(new Date(report.periodEnd))}
              </time>
            </div>
            {report.providers.map((provider) => (
              <div key={provider.provider} className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
                <p className="mb-2 font-medium capitalize">
                  {provider.provider} · {provider.publishedPosts}{" "}
                  {provider.publishedPosts === 1 ? "post" : "posts"}
                </p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                  {(["views", "likes", "comments", "shares"] as const).map((metric) => (
                    <div key={metric}>
                      <dt className="capitalize text-muted-foreground">{metric}</dt>
                      <dd>
                        {provider.metrics[metric] === null
                          ? "Unavailable"
                          : provider.metrics[metric]!.toLocaleString()}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
            {report.partial && (
              <p className="text-xs text-muted-foreground">
                Some platform metrics were unavailable.
                {report.truncated
                  ? ` Metrics were checked for ${report.inspectedPosts} of ${report.publishedPosts} posts.`
                  : ""}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Cumulative platform metrics retrieved {displayDate(report.retrievedAt)}. Counts may
              change after collection.
            </p>
          </article>
        ))}
      </div>
    </FadeContent>
  );
}
