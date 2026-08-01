"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Download } from "lucide-react";
import type { Content } from "./content";
import { AppWindowFrame } from "./AppWindowFrame";
import { HeroAppDemo } from "./HeroAppDemo";
import { AuroraBackground } from "./ui/aurora-background";
import { useDownloadTarget } from "./useDownloadTarget";
import "./cinematic-hero.css";

gsap.registerPlugin(ScrollTrigger);

export function CinematicHero({ t }: { t: Content }) {
  const hero = t.landing.hero;
  const root = useRef<HTMLElement>(null);
  // Both platform downloads are always visible; the visitor's own platform
  // takes the primary pill and the other platform sits beside it.
  const download = useDownloadTarget({
    mac: hero.downloadMac,
    windows: hero.downloadWindows,
  });
  const macTarget = { href: "/download/mac/arm64", label: hero.downloadMac };
  const windowsTarget = { href: "/download/windows", label: hero.downloadWindows };
  const [primary, secondary] =
    download.platform === "windows" ? [windowsTarget, macTarget] : [macTarget, windowsTarget];

  useGSAP(
    () => {
      // Hidden states are set from JS, never CSS, so no-JS visitors still see the hero.
      // A hidden document (background-tab load) skips the entrance instead of
      // playing it stale when the visitor finally switches over.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const frame = root.current?.querySelector(".lp-hero-shot");

      if (!document.hidden) {
        const groups = gsap.utils.toArray<HTMLElement>("[data-hero-rise]");
        gsap.set(groups, { y: 20, autoAlpha: 0 });
        gsap.to(groups, {
          y: 0,
          autoAlpha: 1,
          duration: 0.7,
          ease: "power3.out",
          stagger: 0.08,
        });

        gsap.from(".lp-hero-aurora", { autoAlpha: 0, duration: 1.6, ease: "power1.out" });

        // The signature: once the copy has settled, the window streams its
        // skeleton in row by row — the same way the real app streams a run.
        if (frame) {
          const rows = gsap.utils.toArray<HTMLElement>("[data-skel]", frame as HTMLElement);
          gsap.set(rows, { y: 8, autoAlpha: 0 });
          gsap.to(rows, {
            y: 0,
            autoAlpha: 1,
            duration: 0.45,
            ease: "power2.out",
            stagger: 0.07,
            delay: 0.7,
            scrollTrigger: { trigger: frame, start: "top 88%", once: true },
          });
        }
      }

      if (frame) {
        gsap.set(frame, { transformOrigin: "center top" });
        gsap.fromTo(
          frame,
          { scale: 0.8, opacity: 0.4 },
          {
            scale: 1,
            opacity: 1,
            ease: "none",
            scrollTrigger: {
              trigger: frame,
              start: "top 92%",
              end: "top 45%",
              scrub: 0.6,
            },
          },
        );
      }
    },
    { scope: root },
  );

  return (
    <section className="lp-hero" ref={root}>
      {/* Conflicting utilities (absolute vs relative, bg-transparent vs bg-zinc-50) are
          resolved inside cn by tailwind-merge, so this doesn't depend on CSS chunk order. */}
      <AuroraBackground className="lp-hero-aurora pointer-events-none absolute inset-0 z-0 bg-transparent" />
      <div className="lp-hero-inner">
        <p className="lp-eyebrow lp-hero-eyebrow" data-hero-rise>
          {hero.eyebrow}
        </p>
        <h1 className="lp-hero-title" data-hero-rise>
          {hero.titleLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </h1>
        <p className="lp-hero-subhead" data-hero-rise>
          {hero.subhead}
        </p>
        <div className="lp-hero-ctas" data-hero-rise>
          <a className="lp-btn lp-btn--lg" href={primary.href}>
            <Download size={16} aria-hidden="true" />
            {primary.label}
          </a>
          <a className="lp-btn lp-btn--outline lp-btn--lg" href={secondary.href}>
            <Download size={16} aria-hidden="true" />
            {secondary.label}
          </a>
        </div>
        <p className="lp-hero-caption" data-hero-rise>
          {hero.caption}
        </p>
        <AppWindowFrame className="lp-hero-shot" alt={hero.screenshotAlt}>
          <HeroAppDemo t={t} />
        </AppWindowFrame>
      </div>
    </section>
  );
}
