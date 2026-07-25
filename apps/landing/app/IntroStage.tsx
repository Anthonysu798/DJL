"use client";

/* ───────────────────────── DJL 开场 (opening) ─────────────────────────
   A scroll-controlled cinematic. GSAP ScrollTrigger PINS the viewport and
   SCRUBS a timeline against scroll, so the operator literally scrolls the
   machine awake: nebula ignites → kernel core lights → boot log streams →
   "AGENT AWAKE" → the camera pushes through the core into the live page.
   Framer Motion handles the pointer-parallax once we hand off to the hero.
   Reduced-motion users get the final awake frame, no pin, no scrub. */

import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import type { Content } from "./content";
import { useReducedMotion } from "./effects";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function IntroStage({ boot, descend }: { boot: Content["boot"]; descend: string }) {
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useGSAP(
    () => {
      if (reduced) return;

      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: root.current,
          start: "top top",
          end: "+=2600",
          scrub: 1,
          pin: true,
          pinSpacing: true,
          anticipatePin: 1,
        },
      });

      tl
        // ── ignite: nebula + starfield bloom from a faint pre-ignition glow ──
        .fromTo(
          ".intro-nebula",
          { autoAlpha: 0.14, scale: 1.16 },
          { autoAlpha: 0.5, scale: 1.34, duration: 1.6 },
          0,
        )
        .fromTo(
          ".intro-stars",
          { autoAlpha: 0.28, yPercent: 7 },
          { autoAlpha: 0.85, yPercent: -7, duration: 2.2 },
          0,
        )
        .fromTo(
          ".intro-core",
          { autoAlpha: 0.35, scale: 0.34 },
          { autoAlpha: 1, scale: 1, duration: 1.1, ease: "power3.out" },
          0,
        )
        .fromTo(
          ".intro-ring",
          { autoAlpha: 0, scale: 0.5 },
          { autoAlpha: 1, scale: 1, duration: 1, stagger: 0.12, ease: "power2.out" },
          0.1,
        )
        // the scroll cue is visible at rest, then fades as the boot takes over
        .to(".intro-descend", { autoAlpha: 0, duration: 0.5 }, 0.5)
        // ── identity ──
        .fromTo(
          ".intro-brand",
          { autoAlpha: 0, y: 26, filter: "blur(10px)" },
          { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.9 },
          0.55,
        )
        .fromTo(".intro-label", { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.5 }, 0.8)
        // ── boot log streams + meter fills ──
        .fromTo(
          ".intro-line",
          { autoAlpha: 0, x: -12 },
          { autoAlpha: 1, x: 0, duration: 0.6, stagger: 0.42 },
          1.0,
        )
        .fromTo(
          ".intro-meter-fill",
          { scaleX: 0 },
          { scaleX: 1, duration: 3, ease: "power1.inOut" },
          1.0,
        )
        .fromTo(
          ".intro-pct",
          { textContent: 0 },
          { textContent: 100, duration: 3, ease: "power1.inOut", snap: { textContent: 1 } },
          1.0,
        )
        // ── AGENT AWAKE ──
        .fromTo(
          ".intro-awake",
          { autoAlpha: 0, scale: 0.9, filter: "blur(6px)" },
          { autoAlpha: 1, scale: 1, filter: "blur(0px)", duration: 0.8 },
          3.7,
        )
        .to(".intro-core", { scale: 1.2, duration: 0.7 }, 3.7)
        // ── descend: push the camera through the core into the live page ──
        .to(".intro-stars", { yPercent: -26, duration: 1.8 }, 4.3)
        .to(".intro-nebula", { scale: 1.75, autoAlpha: 0.25, duration: 1.8 }, 4.3)
        .to(".intro-core", { scale: 2.6, duration: 1.4, ease: "power2.in" }, 4.6)
        .to(
          ".intro-inner",
          { scale: 1.55, autoAlpha: 0, filter: "blur(14px)", duration: 1.2, ease: "power2.in" },
          4.8,
        );

      // keep pin measurements honest once the hero image/fonts settle
      const onLoad = () => ScrollTrigger.refresh();
      window.addEventListener("load", onLoad);
      return () => window.removeEventListener("load", onLoad);
    },
    { scope: root, dependencies: [reduced], revertOnUpdate: true },
  );

  return (
    <section
      ref={root}
      className="intro"
      data-reduced={reduced ? "1" : undefined}
      aria-label={boot.label}
    >
      <div className="intro-inner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="intro-nebula" src="/img/nebula.jpg" alt="" aria-hidden="true" />
        <div className="intro-stars" aria-hidden="true" />
        <div className="intro-scrim" aria-hidden="true" />

        <div className="intro-stack">
          {/* kernel core */}
          <div className="intro-reactor" aria-hidden="true">
            <span className="intro-ring r1" />
            <span className="intro-ring r2" />
            <span className="intro-ring r3" />
            <span className="intro-core" />
          </div>

          <div className="intro-brand">{boot.brand}</div>
          <div className="intro-label">
            <span className="dot dot-amber" />
            {boot.label}
          </div>

          {/* boot log */}
          <div className="intro-boot">
            {boot.lines.map((line) => (
              <div
                key={line.text}
                className="intro-line"
                style={{ color: line.ok ? "var(--paper-dim)" : "var(--mute)" }}
              >
                <span style={{ color: line.ok ? "var(--amber)" : "var(--mute-2)" }}>
                  {line.ok ? "✓" : "●"}
                </span>
                <span>{line.text}</span>
              </div>
            ))}
          </div>

          {/* meter */}
          <div className="intro-meter">
            <div className="intro-meter-row">
              <span className="mono-label">calibrating</span>
              <span className="intro-pct font-mono">0</span>
            </div>
            <div className="intro-meter-track">
              <span className="intro-meter-fill" />
            </div>
          </div>

          {/* awake */}
          <div className="intro-awake">{boot.ready}</div>

          {/* descend cue */}
          <div className="intro-descend descend-cue">
            <span className="arrow">▼</span>
            {descend}
          </div>
        </div>
      </div>
    </section>
  );
}
