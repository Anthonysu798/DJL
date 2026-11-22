import type { ComputerUseRequest } from "@djl/contracts";

export type HistoryClearRange = "all" | "10m" | "1h" | "today" | "custom";

function localDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = value.split(/[-T:]/).map(Number);
  // Reject calendar normalization and nonexistent local times at a DST jump.
  return date.getFullYear() === parts[0] &&
    date.getMonth() + 1 === parts[1] &&
    date.getDate() === parts[2] &&
    date.getHours() === parts[3] &&
    date.getMinutes() === parts[4]
    ? date
    : null;
}

export function computerHistoryClearScope(input: {
  range: HistoryClearRange;
  cutoff: Date;
  bundleId?: string;
  since?: string;
  until?: string;
}): Extract<ComputerUseRequest, { method: "activity.clear" }> | null {
  const bundleId = input.bundleId?.trim();
  if ((bundleId?.length ?? 0) > 256 || !Number.isFinite(input.cutoff.getTime())) return null;
  const request = { method: "activity.clear" as const, ...(bundleId ? { bundleId } : {}) };
  if (input.range === "all") return request;
  const until = input.range === "custom" ? localDate(input.until) : input.cutoff;
  const since =
    input.range === "custom"
      ? localDate(input.since)
      : input.range === "today"
        ? new Date(input.cutoff.getFullYear(), input.cutoff.getMonth(), input.cutoff.getDate())
        : new Date(input.cutoff.getTime() - (input.range === "10m" ? 600_000 : 3_600_000));
  if (!since || !until || since >= until) return null;
  return { ...request, since: since.toISOString(), until: until.toISOString() };
}
