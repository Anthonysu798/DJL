import { NextResponse } from "next/server";
import type { DesktopDownloadTarget } from "../../lib/githubDesktopDownloads";
import { resolveDesktopDownload } from "../../lib/resolveDesktopDownload";

const TARGET: DesktopDownloadTarget = { platform: "windows", arch: "x64" };

export async function GET(request: Request) {
  const destination = await resolveDesktopDownload(TARGET, request);
  return NextResponse.redirect(destination, 307);
}
