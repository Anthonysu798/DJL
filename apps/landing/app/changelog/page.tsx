import type { Metadata, Viewport } from "next";
import { fetchChangelogReleases } from "../lib/githubReleases";
import { ChangelogDoc } from "./ChangelogDoc";

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export const metadata: Metadata = {
  title: "DJL changelog - every release",
  description:
    "What changed in each version of the DJL desktop app, read from the published GitHub releases.",
  alternates: {
    languages: { "zh-CN": "/changelog", en: "/en/changelog" },
  },
};

// The page itself is revalidated on the same window as the underlying release read, so a newly
// published version reaches the site without a redeploy or a code change.
export const revalidate = 600;

export default async function ChangelogPage() {
  const releases = await fetchChangelogReleases();

  return <ChangelogDoc locale="zh" releases={releases} />;
}
