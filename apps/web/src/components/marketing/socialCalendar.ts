import type { SocialInboxItem } from "@synara/contracts";

function parts(instant: Date, timezone: string) {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => Number(values.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}
export function localCalendarTime(instant: string | Date, timezone: string) {
  const p = parts(new Date(instant), timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** Never guess which occurrence the user meant during a daylight-saving fold. */
export function calendarTimeToIso(
  value: string,
  timezone: string,
  known?: { scheduledAt: string; timezone: string },
) {
  if (known?.timezone === timezone && localCalendarTime(known.scheduledAt, timezone) === value)
    return new Date(known.scheduledAt).toISOString();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a complete date and time.");
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(wall).toISOString().slice(0, 16) !== value)
    throw new Error("Choose a valid date and time.");
  const offsets = new Set<number>();
  for (const delta of [-36, 0, 36]) {
    const sample = new Date(wall + delta * 3600000);
    const p = parts(sample, timezone);
    offsets.add(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - sample.getTime());
  }
  const candidates = [...offsets]
    .map((offset) => new Date(wall - offset))
    .filter((date) => localCalendarTime(date, timezone) === value);
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? "This time occurs twice when the clocks change. Choose a different time."
        : "This time does not exist when the clocks change. Choose a different time.",
    );
  return candidates[0]!.toISOString();
}

export function calendarWeek(anchor: string, offset: number) {
  const date = new Date(`${anchor}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, index) =>
    new Date(date.getTime() + index * 86400000).toISOString().slice(0, 10),
  );
}
export function calendarEntries(items: SocialInboxItem[], timezone: string) {
  return items
    .flatMap((item) =>
      item.drafts.flatMap((draft) => {
        const tasks = draft.tasks.filter((task) => task.state !== "cancelled");
        const entries = tasks.length
          ? tasks.map((task) => ({ id: task.id, at: task.dueAt, state: task.state }))
          : !draft.confirmedAt && draft.content.publicationMode !== "now"
            ? [{ id: draft.id, at: draft.content.scheduledAt, state: "review_required" }]
            : [];
        return entries
          .filter((entry) => Number.isFinite(Date.parse(entry.at)))
          .map((entry) => ({
            id: entry.id,
            at: entry.at,
            state: entry.state,
            item,
            draft,
            day: localCalendarTime(entry.at, timezone).slice(0, 10),
          }));
      }),
    )
    .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
