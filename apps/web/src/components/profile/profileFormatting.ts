// FILE: profileFormatting.ts
// Purpose: Pure display formatters shared by the Profile page and the shareable card.
// Layer: web profile feature (no I/O, safe to use during html-to-image render).
import { formatLocaleDateTime, formatLocaleNumber } from "~/i18n/intl";

// Compact token/count formatting matching the reference card ("17bn", "538m", "1.2k").
export function formatCompact(value: number | null | undefined, locale?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return formatLocaleNumber(value, locale ?? "en", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  });
}

// Thousands-separated integer ("4,934").
export function formatNumber(value: number | null | undefined, locale?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return formatLocaleNumber(value, locale ?? "en", { maximumFractionDigits: 0 });
}

// Title-case a home-directory basename into a friendly display name.
export function toDisplayName(basename: string): string {
  const cleaned = basename
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) {
    return "DJL";
  }
  return cleaned
    .split(" ")
    .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function normalizeHandle(value: string): string {
  const slug = value
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 30);
  return `@${slug || "djl"}`;
}

// Pretty short date for "peak day" tooltips ("Apr 3").
export function formatShortDate(day: string | null, locale?: string): string | null {
  if (!day) {
    return null;
  }
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) {
    return null;
  }
  return formatLocaleDateTime(new Date(Date.UTC(year, month - 1, date)), locale ?? "en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
