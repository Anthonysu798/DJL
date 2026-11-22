import { useState } from "react";
import type { MultiPostAccount, MultiPostJob } from "@synara/contracts";
import { Button } from "~/components/ui/button";
import { calendarTimeToIso, calendarWeek, localCalendarTime } from "../marketing/socialCalendar";
import { PlatformMark } from "./PlatformMark";
import { useMultiPostLocale, useMultiPostText } from "./shared";

const when = (job: MultiPostJob) => new Date(job.snapshot.data.scheduledPublishTime ?? job.dueAt);
/** Still waiting for its time on this computer, so its time can change. */
export const movable = (job: MultiPostJob, now = Date.now()) =>
  job.state === "queued" &&
  !job.submittedAt &&
  Boolean(job.snapshot.scheduledAt) &&
  Date.parse(job.dueAt) > now;
const utc = (day: string) => new Date(`${day}T12:00:00Z`);
const tone = (job: MultiPostJob) =>
  job.state === "published" || job.state === "delivered"
    ? "good"
    : job.state === "failed"
      ? "bad"
      : ["needs-login", "missed", "uncertain"].includes(job.state)
        ? "warn"
        : "idle";

/** The week at a glance. A scheduled post moves by dragging it to another day or picking a new time. */
export function MultiPostCalendar({
  jobs,
  accounts,
  timezone,
  busy,
  onMove,
}: {
  jobs: MultiPostJob[];
  accounts: MultiPostAccount[];
  timezone: string;
  busy?: boolean;
  onMove: (jobId: string, scheduledAt: string) => void;
}) {
  const l = useMultiPostText();
  const locale = useMultiPostLocale();
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; time: string } | null>(null);
  const today = localCalendarTime(new Date(), timezone).slice(0, 10);
  const days = calendarWeek(today, offset);
  const shown = jobs.filter((job) => job.state !== "cancelled");
  const dayName = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const dayDate = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const clock = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: timezone });
  const drop = (day: string) => {
    const job = shown.find((x) => x.id === dragging);
    setDragging(null);
    setOver(null);
    if (!job) return;
    const local = localCalendarTime(when(job), timezone);
    // Same time of day, new day.
    if (local.slice(0, 10) !== day)
      onMove(job.id, calendarTimeToIso(`${day}T${local.slice(11, 16)}`, timezone));
  };
  return (
    <section className="mp-calendar" aria-label={l("calendar", "Publishing calendar")}>
      <div className="mp-section-heading">
        <h3>
          {dayDate.format(utc(days[0]!))} – {dayDate.format(utc(days[6]!))}
        </h3>
        <div className="mp-actions">
          <Button
            variant="ghost"
            size="sm"
            aria-label={l("previousWeek", "Previous week")}
            onClick={() => setOffset((x) => x - 1)}
          >
            ←
          </Button>
          {offset !== 0 && (
            <Button variant="ghost" size="sm" onClick={() => setOffset(0)}>
              {l("thisWeek", "This week")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label={l("nextWeek", "Next week")}
            onClick={() => setOffset((x) => x + 1)}
          >
            →
          </Button>
        </div>
      </div>
      <div className="mp-calendar-grid">
        {days.map((day) => (
          <div
            className="mp-calendar-day"
            key={day}
            data-day={day}
            data-today={day === today || undefined}
            data-over={over === day || undefined}
            onDragOver={(event) => {
              if (!dragging) return;
              event.preventDefault();
              setOver(day);
            }}
            onDragLeave={() => setOver((current) => (current === day ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              drop(day);
            }}
          >
            <time dateTime={day}>
              {dayName.format(utc(day))} <strong>{Number(day.slice(8))}</strong>
            </time>
            {shown
              .filter((job) => localCalendarTime(when(job), timezone).slice(0, 10) === day)
              .toSorted((a, b) => when(a).getTime() - when(b).getTime())
              .map((job) => {
                const account = accounts.find((x) => x.id === job.accountId);
                const canMove = movable(job);
                const text =
                  job.target.overrides?.content ||
                  job.snapshot.data.content ||
                  job.snapshot.data.title ||
                  l("untitled", "Untitled post");
                return (
                  <div className="mp-calendar-item" key={job.id} data-tone={tone(job)}>
                    <button
                      type="button"
                      draggable={canMove && !busy}
                      data-movable={canMove || undefined}
                      aria-label={`${clock.format(when(job))}, ${account?.label ?? ""}: ${text}`}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", job.id);
                        event.dataTransfer.effectAllowed = "move";
                        setDragging(job.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      onClick={() =>
                        canMove
                          ? setEditing(
                              editing?.id === job.id
                                ? null
                                : { id: job.id, time: localCalendarTime(when(job), timezone) },
                            )
                          : document
                              .getElementById(`mp-job-${job.id}`)
                              ?.scrollIntoView({ block: "center" })
                      }
                    >
                      <span className="mp-calendar-time">
                        <PlatformMark
                          platformKey={account?.platformKey ?? ""}
                          name={account?.label ?? ""}
                        />
                        {clock.format(when(job))}
                      </span>
                      <span className="mp-calendar-text">{text}</span>
                    </button>
                    {editing?.id === job.id && (
                      <form
                        className="mp-calendar-move"
                        onSubmit={(event) => {
                          event.preventDefault();
                          onMove(job.id, calendarTimeToIso(editing.time, timezone));
                          setEditing(null);
                        }}
                      >
                        <input
                          type="datetime-local"
                          autoFocus
                          required
                          aria-label={l("newTime", "New date and time")}
                          value={editing.time}
                          onChange={(event) => setEditing({ id: job.id, time: event.target.value })}
                        />
                        <Button type="submit" size="sm" disabled={busy}>
                          {l("move", "Move")}
                        </Button>
                      </form>
                    )}
                  </div>
                );
              })}
          </div>
        ))}
      </div>
      <p className="mp-muted">
        {l(
          "calendarHint",
          "Drag a scheduled post to another day, or click it to pick a new time. Times are yours ({{timezone}}).",
          { timezone },
        )}
      </p>
    </section>
  );
}
