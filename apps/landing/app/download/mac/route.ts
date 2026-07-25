import { NextResponse } from "next/server";
import { resolveGithubLatestReleasePage } from "../../lib/githubDesktopDownloads";
import { VPS_MAC_COMPATIBILITY_DOWNLOAD_URL } from "../../lib/vpsDesktopDownloads";

// This entry point carries no architecture, so it must not pick one: handing an Intel Mac an Apple
// Silicon disk image looks like a broken download. Send visitors to the release listing and let
// them choose, exactly as the VPS compatibility page did.
export async function GET() {
  const destination =
    (await resolveGithubLatestReleasePage()) ?? VPS_MAC_COMPATIBILITY_DOWNLOAD_URL;
  return NextResponse.redirect(destination, 307);
}
