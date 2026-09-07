import { cookies } from "next/headers";

import { readVisitorCountry } from "../../lib/downloadRegion";
import { scheduleAfterResponse } from "../../lib/downloadStats";
import { handleVisitRequest, VISITOR_COOKIE_NAME } from "../../lib/visitRoute";
import { reportVisitToWorker } from "../../lib/visitTracking";

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
