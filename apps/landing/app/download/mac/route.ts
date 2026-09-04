import { NextResponse } from "next/server";
import {
  GITHUB_LATEST_RELEASE_PAGE_URL,
  resolveGithubLatestReleasePage,
} from "../../lib/githubDesktopDownloads";

// This entry point carries no architecture, so it must not pick one: handing an Intel Mac an Apple
// Silicon disk image looks like a broken download. Send visitors to the release listing and let
// them choose.
export async function GET() {
  const destination = (await resolveGithubLatestReleasePage()) ?? GITHUB_LATEST_RELEASE_PAGE_URL;
  return NextResponse.redirect(destination, 307);
}
