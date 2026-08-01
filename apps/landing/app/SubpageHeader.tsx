"use client";

// Slim white sticky header shared by /docs and /changelog. Imports the landing
// theme so these routes carry the same token layer as the home page.
import "./landing-theme.css";
import type { Content, Locale } from "./content";
import { GITHUB_REPOSITORY_URL } from "./lib/githubDesktopDownloads";
import { localeHref } from "./localeHref";
import { GithubMark } from "./ui/github-mark";
import { useDownloadTarget } from "./useDownloadTarget";
import "./subpage-header.css";

export function SubpageHeader({
  t,
  locale,
  current,
}: {
  t: Content;
  locale: Locale;
  current: "docs" | "changelog";
}) {
  const nav = t.landing.nav;
  const basePath = current === "docs" ? "/docs" : "/changelog";
  const crossPath = current === "docs" ? "/changelog" : "/docs";
  const crossLabel = current === "docs" ? t.landing.footer.changelog : nav.docs;
  const pageLabel = current === "docs" ? nav.docs : t.landing.footer.changelog;
  const download = useDownloadTarget({ mac: nav.download, windows: nav.download });

  return (
    <header className="sph">
      <div className="sph-inner">
        <div className="sph-left">
          <a className="sph-brand" href={localeHref("/", locale)}>
            <img src="/djl-logo.png" alt="DJL" />
          </a>
          <span className="sph-divider" aria-hidden="true" />
          <span className="sph-label">{pageLabel}</span>
        </div>
        <div className="sph-right">
          <a className="sph-link" href={localeHref(crossPath, locale)}>
            {crossLabel}
          </a>
          <div className="sph-lang" role="group" aria-label="Language">
            <a href={basePath} className={locale === "zh" ? "active" : undefined}>
              中文
            </a>
            <a href={`/en${basePath}`} className={locale === "en" ? "active" : undefined}>
              EN
            </a>
          </div>
          <a
            className="sph-github"
            href={GITHUB_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            aria-label={nav.githubLabel}
          >
            <GithubMark size={17} />
          </a>
          <a className="lp-btn sph-download" href={download.href}>
            {download.label}
          </a>
        </div>
      </div>
    </header>
  );
}
