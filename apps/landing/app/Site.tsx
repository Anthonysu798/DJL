"use client";

import { useLayoutEffect } from "react";
import { content, type ConsoleTab, type Locale } from "./content";
import { SiteNav } from "./SiteNav";
import { DjlHero } from "./hero/DjlHero";
import { HeroRailGateway } from "./HeroRailGateway";
import { ContextRailField } from "./ContextRailField";
import { GetStarted } from "./GetStarted";

export function Site({
  locale,
  tab: _tab,
}: {
  locale: Locale;
  tab: ConsoleTab;
}) {
  const t = content[locale];
  void _tab;

  useLayoutEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    const navigation = window.performance
      .getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation?.type !== "reload") return;

    // A reload should restart the product story instead of treating the
    // capability hash and the browser's restored scroll offset as a deep link.
    // Fresh visits to a shared capability URL still keep their intended target.
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );

    let frame = 0;
    const resetToTop = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };
    resetToTop();
    frame = window.requestAnimationFrame(resetToTop);

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <main lang={t.htmlLang} className="stage landing">
      <div className="grain" aria-hidden="true" />

      <SiteNav t={t} />
      <DjlHero t={t} />
      <div className="content-light">
        <HeroRailGateway stats={t.hero.stats} />
        <ContextRailField t={t} />
        <GetStarted t={t} locale={locale} />
      </div>
    </main>
  );
}
