import type { Content, Locale } from "./content";
import { LayoutTextFlip } from "./ui/layout-text-flip";
import "./get-started.css";

// Lands after the capability rail: the rail sells the product, this gives a reader who is convinced
// somewhere concrete to go. It stays light and in the page's flow — the depth lives on /guide, which
// is a document, because reference material inside a wheel-driven pinned scroll fights the reader.
export function GetStarted({ t, locale }: { t: Content; locale: Locale }) {
  const s = t.start;
  const guideHref = locale === "en" ? "/guide?lang=en" : "/guide";
  const changelogHref = locale === "en" ? "/changelog?lang=en" : "/changelog";

  return (
    <section id="get-started" className="get-started" aria-labelledby="get-started-title">
      {/* No ruled background: whitespace and hairlines do the grouping, and a grid competes. */}
      <div className="gs-inner">
        <div className="gs-head">
          <span className="gs-tag">{s.tag}</span>
          <h2 id="get-started-title" className="gs-flip">
            <LayoutTextFlip
              text={s.flip.text}
              words={s.flip.words}
              className="gs-flip-static"
              wordClassName="gs-flip-word"
            />
          </h2>
          <p>{s.body}</p>
        </div>

        <ol className="gs-steps">
          {s.steps.map((step, index) => (
            <li key={step.k}>
              <span className="gs-step-n" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3>{step.k}</h3>
              <p>{step.v}</p>
            </li>
          ))}
        </ol>

        <div className="gs-actions">
          {/* Secondary rank: the page's one blue action is the nav CTA. */}
          <a className="btn" data-variant="secondary" href={guideHref}>
            {s.cta}
          </a>
          <a className="btn" data-variant="utility" href={changelogHref}>
            {t.changelog.eyebrow}
          </a>
        </div>
      </div>
    </section>
  );
}
