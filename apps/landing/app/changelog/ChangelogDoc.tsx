import { content, type Locale } from "../content";
import { GITHUB_RELEASE_REPOSITORY } from "../lib/githubDesktopDownloads";
import type { ChangelogRelease } from "../lib/githubReleases";
import { SubpageHeader } from "../SubpageHeader";
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

  // "Current" marks the newest stable build, which is what the download buttons serve. A prerelease
  // sitting on top is not what visitors get, so it must not wear the badge.
  const currentVersion = releases.find((release) => !release.prerelease)?.version ?? null;

  return (
    <main lang={t.htmlLang} className="landing-light clg">
      <SubpageHeader t={t} locale={locale} current="changelog" />

      <header className="clg-hero">
        <h1>{c.title}</h1>
        <p>{c.lede}</p>
        {locale === "zh" && <p className="clg-source-note">{c.sourceNote}</p>}
      </header>

      <div className="clg-list">
        {releases.length > 0 ? (
          releases.map((release) => {
            const published = formatPublished(release.publishedAt, locale);
            return (
              <article key={release.version} className="clg-release">
                <aside className="clg-meta">
                  <h2 className="clg-version">{release.version}</h2>
                  <div className="clg-badges">
                    {release.version === currentVersion && (
                      <span className="clg-badge" data-kind="current">
                        {c.current}
                      </span>
                    )}
                    {release.prerelease && (
                      <span className="clg-badge" data-kind="prerelease">
                        {c.prerelease}
                      </span>
                    )}
                  </div>
                  {published && (
                    <time className="clg-date" dateTime={release.publishedAt ?? undefined}>
                      {published}
                    </time>
                  )}
                </aside>

                <div className="clg-notes">
                  {release.intro.map((paragraph) => (
                    <p key={paragraph} className="clg-intro">
                      {paragraph}
                    </p>
                  ))}

                  {release.sections.map((section) => (
                    <section key={section.heading} className="clg-section">
                      <h3>{section.heading}</h3>
                      <ul>
                        {section.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  ))}

                  {release.htmlUrl && (
                    <a
                      className="clg-source"
                      href={release.htmlUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {c.viewOnGithub}
                    </a>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <div className="clg-empty">
            <p className="clg-empty-title">{c.empty}</p>
            <p className="clg-empty-hint">{c.emptyHint}</p>
            <a
              className="lp-btn lp-btn--outline"
              href={RELEASES_PAGE_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              {c.emptyAction}
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
