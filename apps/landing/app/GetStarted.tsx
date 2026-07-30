import type { Content, Locale } from "./content";
import "./get-started.css";

// Lands after the capability rail: the rail sells the product, this gives a reader who is convinced
// somewhere concrete to go. The depth itself lives on /guide, which is a plain document — dropping
// it into this page would put reference material inside a wheel-driven, pinned scroll.
export function GetStarted({ t, locale }: { t: Content; locale: Locale }) {
  const s = t.start;
  const guideHref = locale === "en" ? "/guide?lang=en" : "/guide";

  return (
    <section id="get-started" className="get-started" aria-labelledby="get-started-title">
      <div className="gs-inner">
        <div className="gs-head">
          <span className="gs-tag">{s.tag}</span>
          <h2 id="get-started-title">{s.title}</h2>
          <p>{s.body}</p>
        </div>

        <ol className="gs-steps">
          {s.steps.map((step) => (
            <li key={step.k}>
              <h3>{step.k}</h3>
              <p>{step.v}</p>
            </li>
          ))}
        </ol>

        <a className="gs-cta" href={guideHref}>
          {s.cta}
          <span aria-hidden="true">→</span>
        </a>
      </div>
    </section>
  );
}
