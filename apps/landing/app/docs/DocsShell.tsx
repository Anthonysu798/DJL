"use client";

import { useEffect, useState } from "react";
import { content, formatGb, localModelCatalog, type Locale } from "../content";
import { GITHUB_REPOSITORY_URL } from "../lib/githubDesktopDownloads";
import { localeHref } from "../localeHref";
import { SubpageHeader } from "../SubpageHeader";
import { useDownloadTarget } from "../useDownloadTarget";
import "./docs.css";

// Order matters: the scroll-spy resolves the top-most visible section.
const SECTION_IDS = ["use", "local-model", "runtimes", "models", "privacy"] as const;

export function DocsShell({ locale }: { locale: Locale }) {
  const t = content[locale];
  const g = t.guide;
  const [activeId, setActiveId] = useState<string>("use");
  const download = useDownloadTarget({
    mac: g.cta.download,
    windows: t.landing.hero.downloadWindows,
  });

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      // Active = section crossing the upper third of the viewport.
      { rootMargin: "-80px 0px -60% 0px" },
    );
    SECTION_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const tocItems = [
    { id: "use", label: g.sections.use },
    { id: "local-model", label: g.sections.local },
    { id: "runtimes", label: g.local.runtimeTitle },
    { id: "models", label: g.local.table.title },
    { id: "privacy", label: g.local.privacy.title },
  ];

  return (
    <main lang={t.htmlLang} className="landing-light docs">
      <SubpageHeader t={t} locale={locale} current="docs" />

      <div className="docs-shell">
        {/* left: document map + resources */}
        <aside className="docs-side" aria-label={t.landing.nav.docs}>
          <span className="docs-side-label">{t.landing.nav.docs}</span>
          <nav className="docs-side-group">
            {tocItems.slice(0, 2).map((item) => (
              <a key={item.id} href={`#${item.id}`} data-active={item.id === activeId || undefined}>
                {item.label}
              </a>
            ))}
            {tocItems.slice(3).map((item) => (
              <a key={item.id} href={`#${item.id}`} data-active={item.id === activeId || undefined}>
                {item.label}
              </a>
            ))}
          </nav>
          <span className="docs-side-label">{g.resources}</span>
          <nav className="docs-side-group">
            <a href={localeHref("/changelog", locale)}>{t.landing.footer.changelog}</a>
            <a href={GITHUB_REPOSITORY_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href={download.href}>{t.landing.nav.download}</a>
          </nav>
        </aside>

        {/* center: the document */}
        <article className="docs-main">
          <nav className="docs-crumb" aria-label="Breadcrumb">
            <a href={localeHref("/", locale)}>{g.home}</a>
            <span aria-hidden="true">/</span>
            <span>{t.landing.nav.docs}</span>
          </nav>
          <h1>{g.title}</h1>
          <p className="docs-lede">{g.lede}</p>

          <section id="use" className="docs-section">
            <h2>{g.use.title}</h2>
            <p className="docs-body">{g.use.body}</p>
            <ol className="docs-steps">
              {g.use.steps.map((step, index) => (
                <li key={step.k}>
                  <span className="docs-step-n" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <h3>{step.k}</h3>
                    <p>{step.v}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="docs-note">{g.use.note}</p>
          </section>

          <section id="local-model" className="docs-section">
            <h2>{g.local.title}</h2>
            <p className="docs-body">{g.local.body}</p>
            <p className="docs-note">{g.local.desktopOnly}</p>
            <ol className="docs-steps">
              {g.local.steps.map((step, index) => (
                <li key={step.k}>
                  <span className="docs-step-n" aria-hidden="true">
                    {index + 1}
                  </span>
                  <div>
                    <h3>{step.k}</h3>
                    <p>{step.v}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section id="runtimes" className="docs-section">
            <h2>{g.local.runtimeTitle}</h2>
            <div className="docs-runtimes">
              {g.local.runtimes.map((runtime) => (
                <div key={runtime.k} className="docs-runtime-card">
                  <h3>{runtime.k}</h3>
                  <p>{runtime.v}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="models" className="docs-section">
            <h2>{g.local.table.title}</h2>
            <p className="docs-body">{g.local.table.caption}</p>
            <div className="docs-table-scroll">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th scope="col">{g.local.table.model}</th>
                    <th scope="col">{g.local.table.memory}</th>
                    <th scope="col">{g.local.table.download}</th>
                    <th scope="col">{g.local.table.drives}</th>
                  </tr>
                </thead>
                <tbody>
                  {localModelCatalog.map((model) => (
                    <tr key={model.id}>
                      <th scope="row">{model.name}</th>
                      <td>{model.minMemoryGb} GB</td>
                      <td>{formatGb(model.downloadGb)}</td>
                      <td>
                        <span className="docs-pill" data-agent={model.agent}>
                          {model.agent ? g.local.table.yes : g.local.table.no}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="docs-callout" data-kind="warning">
              <h3>{g.local.warning.title}</h3>
              <p>{g.local.warning.body}</p>
            </div>
            <div className="docs-callout">
              <h3>{g.local.context.title}</h3>
              <p>{g.local.context.body}</p>
            </div>
            <div className="docs-callout">
              <h3>{g.local.custom.title}</h3>
              <p>{g.local.custom.body}</p>
            </div>
          </section>

          <section id="privacy" className="docs-section">
            <h2>{g.local.privacy.title}</h2>
            <p className="docs-body">{g.local.privacy.body}</p>
          </section>

          <section className="docs-cta">
            <h2>{g.cta.title}</h2>
            <p className="docs-body">{g.cta.body}</p>
            <a className="lp-btn" href={download.href}>
              {download.label}
            </a>
          </section>
        </article>

        {/* right: on this page */}
        <aside className="docs-toc" aria-label={g.toc}>
          <span className="docs-side-label">{g.toc}</span>
          <nav>
            {tocItems.map((item) => (
              <a key={item.id} href={`#${item.id}`} data-active={item.id === activeId || undefined}>
                {item.label}
              </a>
            ))}
          </nav>
        </aside>
      </div>
    </main>
  );
}
