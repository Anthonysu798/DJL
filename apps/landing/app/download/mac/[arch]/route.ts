import { NextResponse } from "next/server";
import {
  GITHUB_LATEST_RELEASE_CHECKSUMS_URL,
  resolveGithubDesktopDownload,
} from "../../../lib/githubDesktopDownloads";
import {
  resolveVpsDesktopDownload,
  type MacArchitecture,
} from "../../../lib/vpsDesktopDownloads";

type RouteContext = {
  params: Promise<{ arch: string }>;
};

function isMacArchitecture(value: string): value is MacArchitecture {
  return value === "arm64" || value === "x64";
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { arch } = await params;
  if (!isMacArchitecture(arch)) {
    return NextResponse.redirect(GITHUB_LATEST_RELEASE_CHECKSUMS_URL, 307);
  }

  const target = { platform: "mac", arch } as const;
  const destination =
    (await resolveGithubDesktopDownload(target)) ?? resolveVpsDesktopDownload(target);
  return NextResponse.redirect(destination, 307);
}
