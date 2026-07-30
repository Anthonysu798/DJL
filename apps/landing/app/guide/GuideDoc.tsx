import { content, formatGb, localModelCatalog, type Locale } from "../content";
import { CanvasText } from "../ui/canvas-text";
import { LampContainer } from "../ui/lamp";
import { MaskContainer } from "../ui/svg-mask-effect";
import "./guide.css";

// A plain document: no wheel interception, no pinning. The home page rail owns that interaction
// model, and reference material a reader scans and re-finds must not fight the scroll. The effects
// here are deliberately rationed — the lamp heads the page, the mask carries exactly one callout,
// and the prose and model table stay quiet.
export function GuideDoc({ locale }: { locale: Locale }) {
  const t = content[locale];
  const g = t.guide;
  const homeHref = locale === "en" ? "/?lang=en" : "/";
  const changelogHref = locale === "en" ? "/changelog?lang=en" : "/changelog";

  return (
    <main lang={t.htmlLang} className="guide" data-theme="dark">
      <header className="gd-top">
        <a className="gd-back" href={homeHref}>
          <span aria-hidden="true">←</span> {g.home}
        </a>
        <div className="gd-top-right">
          <a className="gd-top-link" href={changelogHref}>
            {t.changelog.eyebrow}
          </a>
          <div className="gd-lang" role="group" aria-label="Language">
            <a href="/guide?lang=en" className={locale === "en" ? "active" : ""}>
              EN
            </a>
            <a href="/guide?lang=zh" className={locale === "zh" ? "active" : ""}>
              中文
            </a>
          </div>
        </div>
      </header>

      <LampContainer className="gd-lamp" contentClassName="-translate-y-[14rem]">
        <div className="gd-lamp-inner">
          <span className="gd-eyebrow">{g.eyebrow}</span>
          <h1>{g.title}</h1>
          <p>{g.lede}</p>
        </div>
      </LampContainer>

      <div className="gd-body">
        {/* Grid background: the calm surface everything below is read against. */}
        <div
          className="gd-grid [background-image:linear-gradient(to_right,#e4e4e7_1px,transparent_1px),linear-gradient(to_bottom,#e4e4e7_1px,transparent_1px)] [background-size:40px_40px] dark:[background-image:linear-gradient(to_right,#1c1f27_1px,transparent_1px),linear-gradient(to_bottom,#1c1f27_1px,transparent_1px)]"
          aria-hidden="true"
        />

        <div className="gd-shell">
          <aside className="gd-toc" aria-label={g.toc}>
            <span className="gd-toc-label">{g.toc}</span>
            <ol>
              <li>
                <a href="#use">{g.sections.use}</a>
              </li>
              <li>
                <a href="#local-model">{g.sections.local}</a>
              </li>
            </ol>
          </aside>

          <article className="gd-article">
            {/* ── 01 · using the agent ── */}
            <section id="use" className="gd-section" data-signal="online">
              <div className="gd-section-head">
                <span className="gd-index">{g.use.index}</span>
                <span className="gd-tag">{g.use.tag}</span>
              </div>
              <h2>{g.use.title}</h2>
              <p className="gd-lead">{g.use.body}</p>

              <ol className="gd-steps">
                {g.use.steps.map((step, index) => (
                  <li key={step.k}>
                    <span className="gd-step-n" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3>{step.k}</h3>
                      <p>{step.v}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <p className="gd-note">{g.use.note}</p>
            </section>

            {/* ── 02 · installing a local model ── */}
            <section id="local-model" className="gd-section" data-signal="local">
              <div className="gd-section-head">
                <span className="gd-index">{g.local.index}</span>
                <span className="gd-tag">{g.local.tag}</span>
              </div>
              <h2>{g.local.title}</h2>
              <p className="gd-lead">{g.local.body}</p>

              <p className="gd-desktop-only">{g.local.desktopOnly}</p>

              <ol className="gd-steps">
                {g.local.steps.map((step, index) => (
                  <li key={step.k}>
                    <span className="gd-step-n" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3>{step.k}</h3>
                      <p>{step.v}</p>
                    </div>
                  </li>
                ))}
              </ol>

              <h3 className="gd-subhead">{g.local.runtimeTitle}</h3>
              <dl className="gd-runtimes">
                {g.local.runtimes.map((runtime) => (
                  <div key={runtime.k}>
                    <dt>{runtime.k}</dt>
                    <dd>{runtime.v}</dd>
                  </div>
                ))}
              </dl>

              <h3 className="gd-subhead">{g.local.table.title}</h3>
              <p className="gd-caption">{g.local.table.caption}</p>
              <div className="gd-table-scroll">
                <table className="gd-table">
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
                          <span className="gd-pill">
                            {model.agent ? g.local.table.yes : g.local.table.no}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="gd-callout" data-kind="warning">
                <h3>{g.local.warning.title}</h3>
                <p>{g.local.warning.body}</p>
              </div>

              <div className="gd-callout">
                <h3>{g.local.context.title}</h3>
                <p>{g.local.context.body}</p>
              </div>

              <div className="gd-callout">
                <h3>{g.local.custom.title}</h3>
                <p>{g.local.custom.body}</p>
              </div>

              {/* The one masked moment on the page. A cursor-shaped hole revealing what is underneath
                  is the literal subject of this callout, which is why it earns the effect here and
                  nowhere else. On touch and keyboard the component renders both layers plainly. */}
              <MaskContainer
                className="gd-privacy"
                revealSize={320}
                baseColor="#0a0c12"
                hoverColor="#06070b"
                revealText={
                  <div className="gd-privacy-layer">
                    <h3>{g.local.privacy.title}</h3>
                    <p>{g.local.privacy.body}</p>
                  </div>
                }
              >
                <div className="gd-privacy-layer" data-masked="true">
                  <h3>{g.local.privacy.title}</h3>
                  <p>{g.local.privacy.body}</p>
                </div>
              </MaskContainer>
            </section>

            <section className="gd-cta">
              {/* Dense lines and large type on purpose: at a small size with the default 10px gap
                  only a few strokes cross each glyph and the words read as scattered dashes. */}
              <CanvasText
                text={g.cta.title}
                className="gd-cta-title"
                backgroundClassName="bg-[#08090d]"
                lineGap={4}
                lineWidth={2}
                curveIntensity={40}
              />
              <p>{g.cta.body}</p>
              <a className="gd-cta-button" href="/download/mac/arm64">
                {g.cta.download}
              </a>
            </section>
          </article>
        </div>
      </div>
    </main>
  );
}
