"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Content } from "./content";
import "./local-ai-section.css";

gsap.registerPlugin(ScrollTrigger);

// The kept 3D robot. Code-split and mounted only when the section approaches the
// viewport so its three.js bundle and 2.6MB GLB never delay the hero.
const RobotLab = dynamic(() => import("./robot-lab/RobotLab").then((m) => m.RobotLab), {
  ssr: false,
});

export function LocalAiSection({ t }: { t: Content }) {
  const localAi = t.landing.localAi;
  const root = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [robotInView, setRobotInView] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRobotInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "60% 0px" },
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.from([".lp-localai-copy .lp-eyebrow", ".lp-localai-title", ".lp-localai-body"], {
        y: 24,
        autoAlpha: 0,
        duration: 0.6,
        ease: "power3.out",
        stagger: 0.08,
        scrollTrigger: { trigger: ".lp-localai-copy", start: "top 80%", once: true },
      });

      gsap.from(".lp-localai-bullets li", {
        x: -12,
        autoAlpha: 0,
        duration: 0.5,
        ease: "power2.out",
        stagger: 0.09,
        scrollTrigger: { trigger: ".lp-localai-bullets", start: "top 85%", once: true },
      });

      // A touch of depth: the robot stage drifts up slightly as it enters.
      gsap.fromTo(
        ".lp-robot-stage",
        { y: 48 },
        {
          y: 0,
          ease: "none",
          scrollTrigger: {
            trigger: ".lp-robot-stage",
            start: "top 95%",
            end: "top 45%",
            scrub: 0.5,
          },
        },
      );
    },
    { scope: root },
  );

  return (
    <section id="local-ai" className="lp-section lp-localai" ref={root}>
      <div className="lp-container lp-localai-grid">
        <div className="lp-localai-copy">
          <p className="lp-eyebrow">{localAi.eyebrow}</p>
          <h2 className="lp-localai-title">{localAi.title}</h2>
          <p className="lp-localai-body">{localAi.body}</p>
          <ul className="lp-localai-bullets">
            {localAi.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </div>
        <div className="lp-robot-stage" ref={stageRef}>
          {robotInView ? <RobotLab embedded /> : null}
        </div>
      </div>
    </section>
  );
}
