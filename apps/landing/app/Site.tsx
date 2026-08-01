"use client";

// The theme layer must be imported before the components so their per-component
// sheets can override its base rules (equal-specificity cascade order).
import "./landing-theme.css";
import { content, type Locale } from "./content";
import { GlassNav } from "./GlassNav";
import { CinematicHero } from "./CinematicHero";
import { ProductSection } from "./ProductSection";
import { CapabilitiesBento } from "./CapabilitiesBento";
import { LocalAiSection } from "./LocalAiSection";
import { RuntimeSection } from "./RuntimeSection";
import { FaqSection } from "./FaqSection";
import { SiteFooter } from "./SiteFooter";

export function Site({ locale }: { locale: Locale }) {
  const t = content[locale];

  return (
    <main lang={t.htmlLang} className="landing-light">
      <GlassNav t={t} />
      <CinematicHero t={t} />
      <ProductSection t={t} />
      <CapabilitiesBento t={t} />
      <LocalAiSection t={t} />
      <RuntimeSection t={t} />
      <FaqSection t={t} locale={locale} />
      <SiteFooter t={t} locale={locale} />
    </main>
  );
}
