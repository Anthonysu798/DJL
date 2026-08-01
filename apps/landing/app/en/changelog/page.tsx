import type { Metadata, Viewport } from "next";
import { fetchChangelogReleases } from "../../lib/githubReleases";
import { ChangelogDoc } from "../../changelog/ChangelogDoc";

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

export const revalidate = 600;

export default async function EnglishChangelogPage() {
  const releases = await fetchChangelogReleases();

  return <ChangelogDoc locale="en" releases={releases} />;
}
