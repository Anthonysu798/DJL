import { NextResponse } from "next/server";
import { resolveGithubLatestReleaseVersion } from "../../lib/githubDesktopDownloads";

// The launch gate is a client component, so it reads the version from here rather than the GitHub
// API directly: the lookup stays server-side and shares the cached release read the download routes
// already use, instead of every visitor's browser spending its own GitHub rate limit.
export async function GET() {
  const version = await resolveGithubLatestReleaseVersion();
  return NextResponse.json({ version });
}
