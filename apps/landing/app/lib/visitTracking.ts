// FILE: visitTracking.ts
// Purpose: Builds privacy-limited anonymous landing visit reports for the stats Worker.

import { readStatsUrl } from "./downloadStats";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPORT_TIMEOUT_MS = 3_000;

export interface VisitReport {
  readonly visitorId: string;
  readonly path: string;
  readonly country: string | null;
}

export interface VisitorIdentity {
  readonly visitorId: string;
  readonly isNew: boolean;
}

export function normalizeVisitorId(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

export function resolveVisitorIdentity(
  value: unknown,
  randomUUID: () => string = () => crypto.randomUUID(),
): VisitorIdentity {
  const existing = normalizeVisitorId(value);
  return existing
    ? { visitorId: existing, isNew: false }
    : { visitorId: randomUUID().toLowerCase(), isNew: true };
}

export function normalizeVisitPath(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.length > 256 ||
    value.includes("?") ||
    value.includes("#")
  ) {
    return null;
  }
  return value;
}

export async function reportVisitToWorker(
  report: VisitReport,
  options: { readonly statsUrl?: string; readonly fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    await fetchImpl(`${options.statsUrl ?? readStatsUrl()}/v1/visits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
  } catch {
    // Analytics must never affect page rendering or navigation.
  }
}
