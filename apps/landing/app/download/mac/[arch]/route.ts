import { NextResponse } from "next/server";
import {
  resolveVpsDesktopDownload,
  type MacArchitecture,
  VPS_DOWNLOAD_FALLBACK_URL,
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
    return NextResponse.redirect(VPS_DOWNLOAD_FALLBACK_URL, 307);
  }

  const destination = resolveVpsDesktopDownload({ platform: "mac", arch });
  return NextResponse.redirect(destination, 307);
}
