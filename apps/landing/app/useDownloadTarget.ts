"use client";

import { useSyncExternalStore } from "react";

export type DownloadTarget = {
  platform: "mac" | "windows";
  href: string;
  label: string;
};

// The server and first client render always show the macOS variant; the Windows
// swap happens after hydration through the browser snapshot. The hrefs are the
// existing release-resolving route handlers, so no version is pinned here.
const subscribe = () => () => {};

export function useDownloadTarget(labels: { mac: string; windows: string }): DownloadTarget {
  const platform = useSyncExternalStore<DownloadTarget["platform"]>(
    subscribe,
    () => (navigator.userAgent.includes("Windows") ? "windows" : "mac"),
    () => "mac",
  );

  return platform === "windows"
    ? { platform, href: "/download/windows", label: labels.windows }
    : { platform, href: "/download/mac/arm64", label: labels.mac };
}

// The China mirror button reuses the platform route and asks the server for OSS explicitly.
export function chinaMirrorHref(href: string): string {
  return `${href}?mirror=cn`;
}

export function chinaMirrorTargets(labels: { mac: string; windows: string }) {
  return [
    { href: chinaMirrorHref("/download/mac/arm64"), label: labels.mac },
    { href: chinaMirrorHref("/download/windows"), label: labels.windows },
  ] as const;
}
