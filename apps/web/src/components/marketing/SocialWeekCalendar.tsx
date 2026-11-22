import { useState } from "react";
import { IconArrowLeft, IconArrowRight, IconCalendar } from "@tabler/icons-react";
import type { SocialInboxItem } from "@djl/contracts";
import SpotlightCard from "~/components/react-bits/SpotlightCard";
import FadeContent from "~/components/react-bits/FadeContent";
import { Button } from "~/components/ui/button";
import { calendarEntries, calendarWeek, localCalendarTime } from "./socialCalendar";
import "./social-week-calendar.css";

export function SocialWeekCalendar({
  items,
  onReschedule,
}: {
  items: SocialInboxItem[];
  onReschedule: (item: SocialInboxItem, draft: SocialInboxItem["drafts"][number]) => void;
}) {
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [offset, setOffset] = useState(0);
  const today = localCalendarTime(new Date(), timezone).slice(0, 10);
  const days = calendarWeek(today, offset);
  const entries = calendarEntries(items, timezone);
  const zones = [
    ...new Set([
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      "UTC",
      ...items.flatMap((item) => item.drafts.map((draft) => draft.content.timezone)),
    ]),
  ];
  return (
    <section className="social-week-calendar" aria-label="Publishing calendar">
      <div className="social-calendar-toolbar">
        <strong>
          <IconCalendar size={16} aria-hidden="true" />
          {new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          }).format(new Date(`${days[0]}T12:00:00Z`))}{" "}
          –{" "}
          {new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(`${days[6]}T12:00:00Z`))}
        </strong>
        <select
          aria-label="Calendar time zone"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
        >
          {zones.map((zone) => (
            <option key={zone}>{zone}</option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous week"
          onClick={() => setOffset(offset - 1)}
        >
          <IconArrowLeft size={16} />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOffset(0)}>
          Today
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next week"
          onClick={() => setOffset(offset + 1)}
        >
          <IconArrowRight size={16} />
        </Button>
      </div>
      <FadeContent key={`${timezone}:${offset}`} trigger="mount" duration={0.25}>
        <div className="social-calendar-week">
          {days.map((day) => (
            <div className="social-calendar-day" key={day} data-today={day === today || undefined}>
              <h4>
                {new Intl.DateTimeFormat(undefined, {
                  weekday: "short",
                  day: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${day}T12:00:00Z`))}
              </h4>
              {entries
                .filter((entry) => entry.day === day)
                .map((entry) => (
                  <SpotlightCard
                    key={entry.id}
                    className="social-calendar-post"
                    spotlightColor="var(--primary)"
                    intensity={0.06}
                    flare={false}
                  >
                    <span className="social-calendar-time">
                      {new Intl.DateTimeFormat(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: timezone,
                      }).format(new Date(entry.at))}
                    </span>
                    <a href={`#/${encodeURIComponent(entry.item.threadId)}`}>{entry.item.name}</a>
                    <span className="social-calendar-state">
                      {entry.state.replaceAll("_", " ")}
                    </span>
                    {!entry.draft.tasks.some((task) =>
                      ["publishing", "published", "reconciling", "uncertain"].includes(task.state),
                    ) && (
                      <button type="button" onClick={() => onReschedule(entry.item, entry.draft)}>
                        Change time
                      </button>
                    )}
                  </SpotlightCard>
                ))}
              {!entries.some((entry) => entry.day === day) && (
                <span className="social-calendar-empty" aria-label="No posts">
                  —
                </span>
              )}
            </div>
          ))}
        </div>
      </FadeContent>
      <p className="text-xs text-muted-foreground">
        Times are shown in {timezone}. Changes prepare a new preview for confirmation.
      </p>
    </section>
  );
}
