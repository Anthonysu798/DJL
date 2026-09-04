// FILE: downloadStats.ts
// Purpose: Reports resolved installer redirects without delaying or breaking the redirect.

import { after } from "next/server";

export interface DownloadReport {
  readonly platform: "windows" | "mac";
  readonly arch: "x64" | "arm64";
  readonly source: "github" | "oss";
  readonly country: string | null;
  readonly version: string | null;
}

export const DEFAULT_STATS_URL = "https://djl-stats.slcor.workers.dev";
const REPORT_TIMEOUT_MS = 3_000;

function normalizeStatsUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function readStatsUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return normalizeStatsUrl(env.DJL_STATS_URL) ?? DEFAULT_STATS_URL;
}

export async function reportDownload(
  report: DownloadReport,
  options: { readonly statsUrl?: string; readonly fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    await fetchImpl(`${options.statsUrl ?? readStatsUrl()}/v1/downloads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
  } catch {
    // Analytics must never break or delay the visitor's download.
  }
}

export function scheduleAfterResponse(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}
