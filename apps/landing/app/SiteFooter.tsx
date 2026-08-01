"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Content, Locale } from "./content";
import { GITHUB_REPOSITORY_URL } from "./lib/githubDesktopDownloads";
import { localeHref } from "./localeHref";
import { RuixenGradientFooter } from "./ui/ruixen-gradient-footer";
import { useDownloadTarget } from "./useDownloadTarget";
import "./site-footer.css";

gsap.registerPlugin(ScrollTrigger);

export function SiteFooter({ t, locale }: { t: Content; locale: Locale }) {
  const strip = t.landing.ctaStrip;
  const footer = t.landing.footer;
  const hero = t.landing.hero;
  const root = useRef<HTMLDivElement>(null);
  // Same rule as the hero: both platforms visible, detected one leads.
  const download = useDownloadTarget({ mac: hero.downloadMac, windows: hero.downloadWindows });
  const macTarget = { href: "/download/mac/arm64", label: hero.downloadMac };
  const windowsTarget = { href: "/download/windows", label: hero.downloadWindows };
  const [primary, secondary] =
    download.platform === "windows" ? [windowsTarget, macTarget] : [macTarget, windowsTarget];

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const stripEl = root.current?.querySelector(".lp-cta-strip");
      if (stripEl) {
        gsap.from(stripEl, {
          y: 32,
          opacity: 0,
          duration: 0.7,
          ease: "power3.out",
          scrollTrigger: { trigger: stripEl, start: "top 85%", once: true },
        });
      }
    },
    { scope: root },
  );

  return (
    <div ref={root}>
      <section className="lp-section">
        <div className="lp-container">
          {/* design.md's single inverted surface per page */}
          <div className="lp-cta-strip">
            <h2>{strip.title}</h2>
            <div className="lp-cta-strip-actions">
              <a className="lp-btn lp-btn--on-dark lp-btn--lg" href={primary.href}>
                {primary.label}
              </a>
              <a className="lp-btn lp-btn--ghost-dark lp-btn--lg" href={secondary.href}>
                {secondary.label}
              </a>
            </div>
          </div>
        </div>
      </section>
      {/* minReveal 0 keeps the canvas pure white until the final stretch of
          scroll, when the Dia-style glow rises into the reserved 40vh. */}
      <RuixenGradientFooter className="lp-footer" gradientHeight="40vh" minReveal={0}>
        <div className="lp-container lp-footer-row">
          <nav className="lp-footer-links" aria-label="Footer">
            <a href="/download/mac">{footer.download}</a>
            <a href={localeHref("/docs", locale)}>{footer.docs}</a>
            <a href={localeHref("/changelog", locale)}>{footer.changelog}</a>
            <a href={GITHUB_REPOSITORY_URL} target="_blank" rel="noreferrer">
              {footer.github}
            </a>
          </nav>
          <span className="lp-footer-copy">{footer.copyright}</span>
        </div>
      </RuixenGradientFooter>
    </div>
  );
}
