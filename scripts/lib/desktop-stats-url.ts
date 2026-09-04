// FILE: desktop-stats-url.ts
// Purpose: Validates DJL_STATS_URL before it is baked into the desktop package metadata.

export function validateDesktopStatsUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = new URL(trimmed);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Stats URLs must use https and may not contain credentials or query data.");
  }
  return parsed.toString().replace(/\/+$/, "");
}
