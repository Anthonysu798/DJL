import { NextResponse } from "next/server";
import { resolveVpsDesktopDownload } from "../../lib/vpsDesktopDownloads";

export function GET() {
  const destination = resolveVpsDesktopDownload({ platform: "windows", arch: "x64" });
  return NextResponse.redirect(destination, 307);
}
