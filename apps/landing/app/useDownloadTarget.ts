"use client";

import { useEffect, useState } from "react";

export type DownloadTarget = {
  platform: "mac" | "windows";
  href: string;
  label: string;
};

// The server and first client render always show the macOS variant; the Windows
// swap happens in an effect so hydration never mismatches. The hrefs are the
// existing release-resolving route handlers, so no version is pinned here.
export function useDownloadTarget(labels: { mac: string; windows: string }): DownloadTarget {
  const [platform, setPlatform] = useState<"mac" | "windows">("mac");

  useEffect(() => {
    if (navigator.userAgent.includes("Windows")) setPlatform("windows");
  }, []);

  return platform === "windows"
    ? { platform, href: "/download/windows", label: labels.windows }
    : { platform, href: "/download/mac/arm64", label: labels.mac };
}
