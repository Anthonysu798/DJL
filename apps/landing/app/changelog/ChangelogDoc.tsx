import { content, type Locale } from "../content";
import { GITHUB_RELEASE_REPOSITORY } from "../lib/githubDesktopDownloads";
import type { ChangelogRelease } from "../lib/githubReleases";
import { AuroraBackground } from "../ui/aurora-background";
import { Timeline, type TimelineEntry } from "../ui/timeline";
import "./changelog.css";

const RELEASES_PAGE_URL = `https://github.com/${GITHUB_RELEASE_REPOSITORY}/releases`;

// Rendered on the server, so the locale drives the formatter rather than the visitor's browser. An
// invalid or missing timestamp yields nothing instead of "Invalid Date".
function formatPublished(iso: string | null, locale: Locale): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function ChangelogDoc({
  locale,
  releases,
}: {
  locale: Locale;
  releases: readonly ChangelogRelease[];
}) {
  const t = content[locale];
  const c = t.changelog;
  const homeHref = locale === "en" ? "/?lang=en" : "/";
  const guideHref = locale === "en" ? "/guide?lang=en" : "/guide";

  // "Current" marks the newest stable build, which is what the download buttons serve. A prerelease
  // sitting on top is not what visitors get, so it must not wear the badge.
  const currentVersion = releases.find((release) => !release.prerelease)?.version ?? null;

  const entries: TimelineEntry[] = releases.map((release) => {
    const published = formatPublished(release.publishedAt, locale);

    return {
      id: release.version,
      title: (
        <div key={`${release.version}-title`} className="cl-entry-head">
          <h2 className="cl-version">{release.version}</h2>
          <div className="cl-badges">
            {release.version === currentVersion && (
              <span className="cl-badge" data-kind="current">
                {c.current}
              </span>
            )}
            {release.prerelease && (
              <span className="cl-badge" data-kind="prerelease">
                {c.prerelease}
              </span>
            )}
          </div>
          {published && (
            <time className="cl-date" dateTime={release.publishedAt ?? undefined}>
              {published}
            </time>
          )}
        </div>
      ),
      content: (
        <div key={`${release.version}-body`} className="cl-entry-body">
          {release.intro.map((paragraph) => (
            <p key={paragraph} className="cl-intro">
              {paragraph}
            </p>
          ))}

          {release.sections.map((section) => (
            <section key={section.heading} className="cl-section">
              <h3 className="cl-section-heading" data-heading={section.heading.toLowerCase()}>
                {section.heading}
              </h3>
              <ul className="cl-items">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}

          {release.htmlUrl && (
            <a
              className="cl-source"
              href={release.htmlUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {c.viewOnGithub}
            </a>
          )}
        </div>
      ),
    };
  });

  return (
    <main lang={t.htmlLang} className="changelog" data-theme="dark">
      <header className="cl-top">
        <a className="cl-back" href={homeHref}>
          <span aria-hidden="true">←</span> {c.home}
        </a>
        <div className="cl-top-right">
          <a className="cl-top-link" href={guideHref}>
            {c.guide}
          </a>
          <div className="cl-lang" role="group" aria-label="Language">
            <a href="/changelog?lang=en" className={locale === "en" ? "active" : ""}>
              EN
            </a>
            <a href="/changelog?lang=zh" className={locale === "zh" ? "active" : ""}>
              中文
            </a>
          </div>
        </div>
      </header>

      <AuroraBackground className="cl-hero">
        <div className="cl-hero-inner">
          <span className="cl-eyebrow">{c.eyebrow}</span>
          <h1>{c.title}</h1>
          <p>{c.lede}</p>
        </div>
      </AuroraBackground>

      {/* Dot background: the calm surface the entries are read against. */}
      <div className="cl-body">
        <div
          className="cl-dots [background-image:radial-gradient(#d4d4d4_1px,transparent_1px)] [background-size:20px_20px] dark:[background-image:radial-gradient(#2a2a2a_1px,transparent_1px)]"
          aria-hidden="true"
        />
        <div className="cl-body-inner">
          {locale === "zh" && <p className="cl-source-note">{c.sourceNote}</p>}

          {entries.length > 0 ? (
            <Timeline data={entries} />
          ) : (
            <div className="cl-empty">
              <p className="cl-empty-title">{c.empty}</p>
              <p className="cl-empty-hint">{c.emptyHint}</p>
              <a
                className="key"
                href={RELEASES_PAGE_URL}
                target="_blank"
                rel="noreferrer noopener"
              >
                {c.emptyAction}
              </a>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
