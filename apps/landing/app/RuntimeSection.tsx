"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Content } from "./content";
import "./runtime-section.css";

gsap.registerPlugin(ScrollTrigger);

// The honest local-vs-API comparison. The API card leads — it is the section's
// subject — and the closing line lands DJL's actual position: run both.
export function RuntimeSection({ t }: { t: Content }) {
  const runtimes = t.landing.runtimes;
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.from(".lp-runtime-head", {
        y: 24,
        autoAlpha: 0,
        duration: 0.6,
        ease: "power3.out",
        scrollTrigger: { trigger: ".lp-runtime-head", start: "top 80%", once: true },
      });

      gsap.from(".lp-runtime-card", {
        y: 32,
        autoAlpha: 0,
        duration: 0.7,
        ease: "power3.out",
        stagger: 0.12,
        scrollTrigger: { trigger: ".lp-runtime-grid", start: "top 80%", once: true },
      });

      gsap.from(".lp-runtime-closing", {
        y: 24,
        autoAlpha: 0,
        duration: 0.6,
        ease: "power3.out",
        scrollTrigger: { trigger: ".lp-runtime-closing", start: "top 85%", once: true },
      });
    },
    { scope: root },
  );

  return (
    <section id="runtimes" className="lp-section lp-runtime" ref={root}>
      <div className="lp-container">
        <div className="lp-runtime-head">
          <p className="lp-eyebrow">{runtimes.eyebrow}</p>
          <h2 className="lp-runtime-title">{runtimes.title}</h2>
          <p className="lp-runtime-body">{runtimes.body}</p>
        </div>

        <div className="lp-runtime-grid">
          <article className="lp-runtime-card lp-runtime-card--api">
            <span className="lp-runtime-tag lp-runtime-tag--ink">{runtimes.api.tag}</span>
            <h3>{runtimes.api.title}</h3>
            <ul>
              {runtimes.api.points.map((point) => (
                <li key={point} data-kind="pro">
                  {point}
                </li>
              ))}
            </ul>
            <p className="lp-runtime-note">{runtimes.api.note}</p>
          </article>

          <article className="lp-runtime-card">
            <span className="lp-runtime-tag">{runtimes.local.tag}</span>
            <h3>{runtimes.local.title}</h3>
            <ul>
              {runtimes.local.pros.map((point) => (
                <li key={point} data-kind="pro">
                  {point}
                </li>
              ))}
              {runtimes.local.cons.map((point) => (
                <li key={point} data-kind="con">
                  {point}
                </li>
              ))}
            </ul>
          </article>
        </div>

        <p className="lp-runtime-closing">{runtimes.closing}</p>
      </div>
    </section>
  );
}
