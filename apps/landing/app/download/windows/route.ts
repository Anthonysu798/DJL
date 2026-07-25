import { NextResponse } from "next/server";
import { resolveGithubDesktopDownload } from "../../lib/githubDesktopDownloads";
import { resolveVpsDesktopDownload, type DesktopDownloadTarget } from "../../lib/vpsDesktopDownloads";

const TARGET: DesktopDownloadTarget = { platform: "windows", arch: "x64" };

export async function GET() {
  const destination =
    (await resolveGithubDesktopDownload(TARGET)) ?? resolveVpsDesktopDownload(TARGET);
  return NextResponse.redirect(destination, 307);
}
