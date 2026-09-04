import { NextResponse } from "next/server";
import { reportDownload, scheduleAfterResponse } from "../../lib/downloadStats";
import type { DesktopDownloadTarget } from "../../lib/githubDesktopDownloads";
import { resolveDesktopDownload } from "../../lib/resolveDesktopDownload";

const TARGET: DesktopDownloadTarget = { platform: "windows", arch: "x64" };

export async function GET(request: Request) {
  const decision = await resolveDesktopDownload(TARGET, request);
  scheduleAfterResponse(() => reportDownload(decision.report));
  return NextResponse.redirect(decision.destination, 307);
}
