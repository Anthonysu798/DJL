"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { content, type ConsoleTab, type Locale } from "./content";
import { SiteNav } from "./SiteNav";
import { DjlHero } from "./hero/DjlHero";
import { ContextRailStory } from "./ContextRailStory";
import { DesktopLaunchGate } from "./DesktopLaunchGate";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function Site({ locale, tab: _tab }: { locale: Locale; tab: ConsoleTab }) {
  const t = content[locale];
  void _tab;
  const rootRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add(
        {
          isDesktop: "(min-width: 900px)",
          reduceMotion: "(prefers-reduced-motion: reduce)",
        },
        (context) => {
          const conditions = context.conditions as {
            isDesktop: boolean;
            reduceMotion: boolean;
          };
          if (conditions.reduceMotion || !conditions.isDesktop) return;

          gsap.fromTo(
            ".section-reveal",
            { autoAlpha: 0, y: 32 },
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.85,
              ease: "power3.out",
              stagger: 0.07,
              scrollTrigger: {
                trigger: ".metric-band",
                start: "top 82%",
                toggleActions: "play none none reverse",
              },
            },
          );
        },
      );

      const refresh = window.setTimeout(() => ScrollTrigger.refresh(), 350);
      return () => {
        window.clearTimeout(refresh);
        media.revert();
      };
    },
    { scope: rootRef },
  );

  return (
    <main ref={rootRef} lang={t.htmlLang} className="stage landing">
      <div className="grain" aria-hidden="true" />

      <SiteNav t={t} />
      <DjlHero t={t} />
      <div className="content-light">
        <MetricBand stats={t.hero.stats} />
        <ContextRailStory t={t} />
        <DesktopLaunchGate t={t} />
      </div>
    </main>
  );
}

function MetricBand({ stats }: { stats: readonly { k: string; v: string }[] }) {
  return (
    <section className="metric-band" aria-label="DJL platform highlights">
      <div className="shell metric-grid">
        {stats.map((stat) => (
          <div key={stat.k} className="metric section-reveal">
            <strong>{stat.k}</strong>
            <span>{stat.v}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
