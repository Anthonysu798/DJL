import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MultiPostJob } from "@djl/contracts";
import { Button } from "~/components/ui/button";
import { calendarWeek, localCalendarTime } from "../marketing/socialCalendar";
export function MultiPostCalendar({ jobs, timezone }: { jobs: MultiPostJob[]; timezone: string }) {
  const { t } = useTranslation("chat");
  const [offset, setOffset] = useState(0);
  const days = calendarWeek(localCalendarTime(new Date(), timezone).slice(0, 10), offset);
  return (
    <section
      className="mp-calendar"
      aria-label={t("multipost.calendar", { defaultValue: "Publishing calendar" })}
    >
      <div className="mp-section-heading">
        <h3>{t("multipost.calendar", { defaultValue: "Publishing calendar" })}</h3>
        <div className="mp-actions">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("multipost.previousWeek", { defaultValue: "Previous week" })}
            onClick={() => setOffset((x) => x - 1)}
          >
            ←
          </Button>
          <span>
            {days[0]} — {days[6]}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("multipost.nextWeek", { defaultValue: "Next week" })}
            onClick={() => setOffset((x) => x + 1)}
          >
            →
          </Button>
        </div>
      </div>
      <div className="mp-calendar-grid">
        {days.map((day) => (
          <div className="mp-calendar-day" key={day}>
            <time dateTime={day}>{day.slice(5)}</time>
            {jobs
              .filter(
                (job) =>
                  localCalendarTime(
                    job.snapshot.data.scheduledPublishTime
                      ? new Date(job.snapshot.data.scheduledPublishTime)
                      : job.dueAt,
                    timezone,
                  ).slice(0, 10) === day,
              )
              .map((job) => (
                <button
                  key={job.id}
                  onClick={() =>
                    document.getElementById(`mp-job-${job.id}`)?.scrollIntoView({ block: "center" })
                  }
                >
                  <span className={`mp-status mp-status-${job.state}`}>
                    {t(`multipost.${job.state}`, { defaultValue: job.state })}
                  </span>
                  <span>{job.snapshot.data.title}</span>
                </button>
              ))}
          </div>
        ))}
      </div>
      <p className="mp-muted">{timezone}</p>
    </section>
  );
}
