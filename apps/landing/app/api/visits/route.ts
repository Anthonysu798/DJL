import { cookies } from "next/headers";

import { readVisitorCountry } from "../../lib/downloadRegion";
import { scheduleAfterResponse } from "../../lib/downloadStats";
import {
  normalizeVisitPath,
  reportVisitToWorker,
  resolveVisitorIdentity,
  type VisitReport,
} from "../../lib/visitTracking";

export const VISITOR_COOKIE_NAME = "djl_visitor_id";
const VISITOR_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export interface VisitRouteDependencies {
  readonly cookieValue: string | undefined;
  readonly country: string | null;
  readonly randomUUID: () => string;
  readonly isProduction: boolean;
  readonly schedule: (task: () => Promise<void>) => void;
  readonly report: (report: VisitReport) => Promise<void>;
}

function visitorCookie(visitorId: string, isProduction: boolean): string {
  return [
    `${VISITOR_COOKIE_NAME}=${visitorId}`,
    `Max-Age=${VISITOR_COOKIE_MAX_AGE_SECONDS}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(isProduction ? ["Secure"] : []),
  ].join("; ");
}

export async function handleVisitRequest(
  request: Request,
  deps: VisitRouteDependencies,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const path = normalizeVisitPath(
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).path
      : null,
  );
  if (path === null) {
    return Response.json({ error: "invalid_path" }, { status: 400 });
  }

  const identity = resolveVisitorIdentity(deps.cookieValue, deps.randomUUID);
  deps.schedule(() => deps.report({ visitorId: identity.visitorId, path, country: deps.country }));

  const headers = new Headers({ "cache-control": "no-store" });
  if (identity.isNew) {
    headers.set("set-cookie", visitorCookie(identity.visitorId, deps.isProduction));
  }
  return new Response(null, { status: 204, headers });
}

export async function POST(request: Request): Promise<Response> {
  const cookieStore = await cookies();
  return handleVisitRequest(request, {
    cookieValue: cookieStore.get(VISITOR_COOKIE_NAME)?.value,
    country: readVisitorCountry(request),
    randomUUID: () => crypto.randomUUID(),
    isProduction: process.env.NODE_ENV === "production",
    schedule: scheduleAfterResponse,
    report: reportVisitToWorker,
  });
}
