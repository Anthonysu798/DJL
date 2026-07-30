import { content, formatGb, localModelCatalog, type Locale } from "../content";
import "./guide.css";

// A plain document: no wheel interception, no pinning, no GSAP. The home page rail owns that
// interaction model, and reference material a reader scans and re-finds must not fight the scroll.
export function GuideDoc({ locale }: { locale: Locale }) {
  const t = content[locale];
  const g = t.guide;
  const homeHref = locale === "en" ? "/?lang=en" : "/";

  return (
    <main lang={t.htmlLang} className="guide content-light">
      <div className="grain" aria-hidden="true" />

      <header className="guide-top">
        <a className="guide-back" href={homeHref}>
          <span aria-hidden="true">←</span> {g.home}
        </a>
        <div className="guide-lang" role="group" aria-label="Language">
          <a href="/guide?lang=en" className={locale === "en" ? "active" : ""}>
            EN
          </a>
          <a href="/guide?lang=zh" className={locale === "zh" ? "active" : ""}>
            中文
          </a>
        </div>
      </header>

      <div className="guide-shell">
        <div className="guide-intro">
          <span className="guide-eyebrow">{g.eyebrow}</span>
          <h1>{g.title}</h1>
          <p>{g.lede}</p>
        </div>

        <div className="guide-body">
          <aside className="guide-toc" aria-label={g.toc}>
            <span className="guide-toc-label">{g.toc}</span>
            <ol>
              <li>
                <a href="#use">{g.sections.use}</a>
              </li>
              <li>
                <a href="#local-model">{g.sections.local}</a>
              </li>
            </ol>
          </aside>

          <article className="guide-article">
            {/* ── 01 · using the agent ── */}
            <section id="use" className="guide-section" data-signal="online">
              <div className="guide-section-head">
                <span className="guide-index">{g.use.index}</span>
                <span className="guide-tag">{g.use.tag}</span>
              </div>
              <h2>{g.use.title}</h2>
              <p className="guide-lead">{g.use.body}</p>

              <ol className="guide-steps">
                {g.use.steps.map((step) => (
                  <li key={step.k}>
                    <h3>{step.k}</h3>
                    <p>{step.v}</p>
                  </li>
                ))}
              </ol>

              <p className="guide-note">{g.use.note}</p>
            </section>

            {/* ── 02 · installing a local model ── */}
            <section id="local-model" className="guide-section" data-signal="local">
              <div className="guide-section-head">
                <span className="guide-index">{g.local.index}</span>
                <span className="guide-tag">{g.local.tag}</span>
              </div>
              <h2>{g.local.title}</h2>
              <p className="guide-lead">{g.local.body}</p>

              <p className="guide-desktop-only">{g.local.desktopOnly}</p>

              <ol className="guide-steps">
                {g.local.steps.map((step) => (
                  <li key={step.k}>
                    <h3>{step.k}</h3>
                    <p>{step.v}</p>
                  </li>
                ))}
              </ol>

              <h3 className="guide-subhead">{g.local.runtimeTitle}</h3>
              <div className="guide-runtimes">
                {g.local.runtimes.map((runtime) => (
                  <div key={runtime.k} className="guide-runtime">
                    <h4>{runtime.k}</h4>
                    <p>{runtime.v}</p>
                  </div>
                ))}
              </div>

              <h3 className="guide-subhead">{g.local.table.title}</h3>
              <p className="guide-caption">{g.local.table.caption}</p>
              <div className="guide-table-scroll">
                <table className="guide-table">
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
                      <tr key={model.id} data-agent={model.agent}>
                        <th scope="row">{model.name}</th>
                        <td>{model.minMemoryGb} GB</td>
                        <td>{formatGb(model.downloadGb)}</td>
                        <td>
                          <span className="guide-pill">
                            {model.agent ? g.local.table.yes : g.local.table.no}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="guide-callout" data-kind="warning">
                <h3>{g.local.warning.title}</h3>
                <p>{g.local.warning.body}</p>
              </div>

              <div className="guide-callout">
                <h3>{g.local.context.title}</h3>
                <p>{g.local.context.body}</p>
              </div>

              <div className="guide-callout">
                <h3>{g.local.custom.title}</h3>
                <p>{g.local.custom.body}</p>
              </div>

              <div className="guide-callout">
                <h3>{g.local.privacy.title}</h3>
                <p>{g.local.privacy.body}</p>
              </div>
            </section>

            <section className="guide-cta">
              <h2>{g.cta.title}</h2>
              <p>{g.cta.body}</p>
              <a className="guide-cta-button" href="/download/mac/arm64">
                {g.cta.download}
              </a>
            </section>
          </article>
        </div>
      </div>
    </main>
  );
}
