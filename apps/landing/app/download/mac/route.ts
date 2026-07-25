import { NextResponse } from "next/server";
import { VPS_MAC_COMPATIBILITY_DOWNLOAD_URL } from "../../lib/vpsDesktopDownloads";

export function GET() {
  return NextResponse.redirect(VPS_MAC_COMPATIBILITY_DOWNLOAD_URL, 307);
}
