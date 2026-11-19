import type { CloudSocialReportScheduleInput } from "../../../../../../packages/contracts/src/cloud/socialReports.ts";
import { ApiError } from "../../http/errors.ts";

export function validateReportSchedule(input: CloudSocialReportScheduleInput) {
  if (
    ![input.weekday, input.hour, input.minute].every(Number.isInteger) ||
    input.weekday < 0 ||
    input.weekday > 6 ||
    input.hour < 0 ||
    input.hour > 23 ||
    input.minute < 0 ||
    input.minute > 59 ||
    input.timezone.length > 100
  )
    throw new ApiError(
      400,
      "invalid_report_schedule",
      "Choose a weekly day, time, and IANA timezone.",
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format();
  } catch {
    throw new ApiError(400, "invalid_report_schedule", "Choose an IANA timezone.");
  }
}
/** One occurrence per local calendar day. For a repeated clock time use its first
 * occurrence; for a missing clock time use the first existing minute after it.
 * The bounded minute scan covers all IANA UTC offsets without a timezone database dependency.
 */
export function nextWeeklyInstant(
  after: Date,
  input: Pick<CloudSocialReportScheduleInput, "timezone" | "weekday" | "hour" | "minute">,
): Date {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: input.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const local = (date: Date) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(date).map((part) => [part.type, part.value]),
    );
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
    };
  };
  const current = local(after);
  const midnight = Date.UTC(current.year, current.month - 1, current.day);
  const weekday = new Date(midnight).getUTCDay();
  let date = midnight + ((input.weekday - weekday + 7) % 7) * 86400000;
  for (let week = 0; week < 3; week++, date += 7 * 86400000) {
    const day = new Date(date);
    const desired = input.hour * 60 + input.minute;
    for (let instant = date - 15 * 3600000; instant <= date + 36 * 3600000; instant += 60000) {
      const parts = local(new Date(instant));
      if (
        parts.year !== day.getUTCFullYear() ||
        parts.month !== day.getUTCMonth() + 1 ||
        parts.day !== day.getUTCDate() ||
        parts.hour * 60 + parts.minute < desired
      )
        continue;
      // Always choose this day's first occurrence before comparing with `after`.
      if (instant > after.getTime()) return new Date(instant);
      break;
    }
  }
  throw new Error("No weekly schedule occurrence");
}
