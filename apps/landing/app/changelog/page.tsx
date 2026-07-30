import type { Metadata } from "next";
import type { Locale } from "../content";
import { fetchChangelogReleases } from "../lib/githubReleases";
import { ChangelogDoc } from "./ChangelogDoc";

export const metadata: Metadata = {
  title: "DJL changelog - every release",
  description:
    "What changed in each version of the DJL desktop app, read from the published GitHub releases.",
};

// The page itself is revalidated on the same window as the underlying release read, so a newly
// published version reaches the site without a redeploy or a code change.
export const revalidate = 600;

export default async function ChangelogPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  // Chinese default, English opt-in — the same rule as the home page and the guide.
  const locale: Locale = params.lang === "en" ? "en" : "zh";
  const releases = await fetchChangelogReleases();

  return <ChangelogDoc locale={locale} releases={releases} />;
}
