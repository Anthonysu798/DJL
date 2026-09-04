import { NextResponse } from "next/server";
import { reportDownload, scheduleAfterResponse } from "../../../lib/downloadStats";
import {
  GITHUB_LATEST_RELEASE_CHECKSUMS_URL,
  type MacArchitecture,
} from "../../../lib/githubDesktopDownloads";
import { resolveDesktopDownload } from "../../../lib/resolveDesktopDownload";

type RouteContext = {
  params: Promise<{ arch: string }>;
};

function isMacArchitecture(value: string): value is MacArchitecture {
  return value === "arm64" || value === "x64";
}

export async function GET(request: Request, { params }: RouteContext) {
  const { arch } = await params;
  if (!isMacArchitecture(arch)) {
    return NextResponse.redirect(GITHUB_LATEST_RELEASE_CHECKSUMS_URL, 307);
  }

  const decision = await resolveDesktopDownload({ platform: "mac", arch }, request);
  scheduleAfterResponse(() => reportDownload(decision.report));
  return NextResponse.redirect(decision.destination, 307);
}
