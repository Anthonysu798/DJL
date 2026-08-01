"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import type { Content } from "./content";
import { AppWindowFrame } from "./AppWindowFrame";
import { AppWindowVideo } from "./AppWindowVideo";
import "./product-section.css";

gsap.registerPlugin(ScrollTrigger, SplitText);

export function ProductSection({ t }: { t: Content }) {
  const product = t.landing.product;
  const isZh = t.htmlLang === "zh-CN";
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const header = root.current?.querySelector(".lp-product-head");
      if (header) {
        gsap.from(header, {
          y: 24,
          autoAlpha: 0,
          duration: 0.6,
          ease: "power3.out",
          scrollTrigger: { trigger: header, start: "top 80%", once: true },
        });
      }

      const manifesto = root.current?.querySelector(".lp-product-manifesto");
      if (manifesto) {
        // Chinese has no word boundaries, so the scrub reveal steps per character there.
        const split = new SplitText(manifesto, { type: isZh ? "chars" : "words" });
        const targets = isZh ? split.chars : split.words;
        const mm = gsap.matchMedia();

        // Desktop: the page's one pinned chapter — the line holds center-viewport
        // while its words materialize, then releases.
        mm.add("(min-width: 769px)", () => {
          gsap.fromTo(
            targets,
            { opacity: 0.12 },
            {
              opacity: 1,
              stagger: 0.06,
              ease: "none",
              scrollTrigger: {
                trigger: manifesto,
                start: "center 55%",
                end: "+=40%",
                scrub: true,
                pin: true,
              },
            },
          );
        });

        // Mobile: same reveal without pinning.
        mm.add("(max-width: 768px)", () => {
          gsap.fromTo(
            targets,
            { opacity: 0.15 },
            {
              opacity: 1,
              stagger: 0.05,
              ease: "none",
              scrollTrigger: {
                trigger: manifesto,
                start: "top 75%",
                end: "top 30%",
                scrub: true,
              },
            },
          );
        });
      }

      const frame = root.current?.querySelector(".lp-product-shot");
      if (frame) {
        gsap.set(frame, { transformOrigin: "center top" });
        gsap.fromTo(
          frame,
          { scale: 0.9, opacity: 0.5 },
          {
            scale: 1,
            opacity: 1,
            ease: "none",
            scrollTrigger: { trigger: frame, start: "top 90%", end: "top 50%", scrub: 0.6 },
          },
        );
      }
    },
    { scope: root },
  );

  return (
    <section id="product" className="lp-section lp-product" ref={root}>
      <div className="lp-container">
        <div className="lp-product-head">
          <p className="lp-eyebrow">{product.eyebrow}</p>
          <h2 className="lp-product-title">{product.title}</h2>
          <p className="lp-product-body">{product.body}</p>
        </div>
        <p className="lp-product-manifesto">{product.manifesto}</p>
        <AppWindowFrame className="lp-product-shot" alt={product.screenshotAlt}>
          <AppWindowVideo label={product.screenshotAlt} />
        </AppWindowFrame>
      </div>
    </section>
  );
}
