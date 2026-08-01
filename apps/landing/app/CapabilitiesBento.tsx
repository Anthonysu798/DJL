"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Content } from "./content";
import "./capabilities-bento.css";

gsap.registerPlugin(ScrollTrigger);

const VIDEO_SRC = "/demo/capabilities-models.mp4";
const POSTER_SRC = "/demo/capabilities-models-poster.webp";
const FEATURE_MARKS = ["文/A", "⇄", "API", "◐"] as const;

const PROOF_LABELS = {
  en: ["Multiple languages", "Hosted APIs", "Ollama + LM Studio", "Light + dark"],
  zh: ["多语言", "API 模型", "Ollama + LM Studio", "深色 + 浅色"],
} as const;

export function CapabilitiesBento({ t }: { t: Content }) {
  const caps = t.landing.capabilities;
  const root = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [manualStarted, setManualStarted] = useState(false);
  const isZh = t.htmlLang === "zh-CN";
  const proofLabels = isZh ? PROOF_LABELS.zh : PROOF_LABELS.en;
  const intro = isZh
    ? "用你最自然的语言工作。一键切换 API 与本地模型，深浅主题随环境变化，任务上下文始终不断。"
    : "Work in the language that feels natural. Switch between API and local models in one click, move from light to dark, and keep the task intact.";
  const videoLabel = isZh
    ? "DJL 模型选择器展示 API、LM Studio 与 Ollama 模型"
    : "DJL model picker showing API, LM Studio, and Ollama models";

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(media.matches);

    if (media.matches) return;
    const video = videoRef.current;
    if (!video) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) video.play().catch(() => {});
        else video.pause();
      },
      { threshold: 0.35 },
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  useGSAP(
    () => {
      const section = root.current;
      if (!section || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const head = section.querySelector(".lp-caps-head");
      const stage = section.querySelector<HTMLElement>(".lp-cap-stage");
      const videoFrame = section.querySelector<HTMLElement>(".lp-cap-video-shell");
      const features = gsap.utils.toArray<HTMLElement>(".lp-cap-feature", section);
      const proofItems = gsap.utils.toArray<HTMLElement>(".lp-cap-proof", section);
      const progress = section.querySelector<HTMLElement>(".lp-cap-progress-fill");
      const media = gsap.matchMedia();

      if (head) {
        gsap.from(head.children, {
          y: 28,
          autoAlpha: 0,
          duration: 0.75,
          ease: "power3.out",
          stagger: 0.08,
          scrollTrigger: { trigger: head, start: "top 82%", once: true },
        });
      }

      media.add("(min-width: 861px)", () => {
        if (!stage || !features.length || !videoFrame) return;

        gsap.set(features, { autoAlpha: 0.3, x: 0 });
        gsap.set(features[0], { autoAlpha: 1, x: 8 });
        gsap.set(videoFrame, { scale: 0.975, transformOrigin: "50% 50%" });
        gsap.set(proofItems, { y: 14, autoAlpha: 0 });
        if (progress) gsap.set(progress, { scaleX: 1 / features.length, transformOrigin: "0 50%" });

        const timeline = gsap.timeline({
          scrollTrigger: {
            trigger: stage,
            start: "top top+=104",
            end: "+=120%",
            pin: true,
            pinSpacing: true,
            scrub: 0.72,
            anticipatePin: 1,
          },
        });

        timeline
          .to(videoFrame, { scale: 1, duration: 0.45, ease: "power2.out" })
          .to(
            proofItems,
            { y: 0, autoAlpha: 1, stagger: 0.08, duration: 0.4, ease: "power2.out" },
            "-=0.2",
          );

        features.slice(1).forEach((feature, index) => {
          const previous = features[index];
          timeline
            .to(previous, { autoAlpha: 0.3, x: 0, duration: 0.35, ease: "power2.out" })
            .to(feature, { autoAlpha: 1, x: 8, duration: 0.35, ease: "power2.out" }, "<")
            .to(
              progress,
              { scaleX: (index + 2) / features.length, duration: 0.35, ease: "power2.out" },
              "<",
            );
        });

        timeline.to({}, { duration: 0.3 });
      });

      media.add("(max-width: 860px)", () => {
        if (!stage) return;
        gsap.from([videoFrame, ...features, ...proofItems], {
          y: 36,
          autoAlpha: 0,
          duration: 0.7,
          stagger: 0.07,
          ease: "power3.out",
          scrollTrigger: { trigger: stage, start: "top 82%", once: true },
        });
      });

      return () => media.revert();
    },
    { scope: root },
  );

  return (
    <section id="capabilities" className="lp-section lp-caps" ref={root}>
      <div className="lp-container lp-caps-scene">
        <header className="lp-caps-head">
          <p className="lp-caps-eyebrow">{caps.eyebrow}</p>
          <div className="lp-caps-heading-grid">
            <h2 className="lp-caps-title">{caps.title}</h2>
            <p className="lp-caps-intro">{intro}</p>
          </div>
        </header>

        <div className="lp-cap-stage">
          <div className="lp-cap-story">
            <div className="lp-cap-story-label" aria-hidden="true">
              <span>01</span>
              <i />
              <span>04</span>
            </div>

            <div className="lp-cap-features">
              {caps.cards.map((card, index) => (
                <article className="lp-cap-feature" key={card.title}>
                  <span className="lp-cap-feature-mark" aria-hidden="true">
                    {FEATURE_MARKS[index] ?? `0${index + 1}`}
                  </span>
                  <div>
                    <h3>{card.title}</h3>
                    <p>{card.body}</p>
                  </div>
                </article>
              ))}
            </div>

            <div className="lp-cap-progress" aria-hidden="true">
              <span className="lp-cap-progress-fill" />
            </div>
          </div>

          <figure className="lp-cap-media">
            <div className="lp-cap-video-shell">
              <div className="lp-cap-video-bar" aria-hidden="true">
                <span className="lp-cap-video-lights"><i /><i /><i /></span>
                <span>{isZh ? "模型、语言与主题，一处切换" : "Models, languages, and themes — one place"}</span>
                <span className="lp-cap-video-time">01:09</span>
              </div>
              <div className="lp-cap-video-viewport">
                <video
                  ref={videoRef}
                  src={VIDEO_SRC}
                  poster={POSTER_SRC}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  aria-label={videoLabel}
                  onPlay={() => setManualStarted(true)}
                  onClick={
                    reduceMotion
                      ? () => {
                          const video = videoRef.current;
                          if (!video) return;
                          if (video.paused) video.play().catch(() => {});
                          else video.pause();
                        }
                      : undefined
                  }
                />
                {reduceMotion && !manualStarted ? (
                  <button
                    type="button"
                    className="lp-cap-video-play"
                    aria-label={isZh ? "播放 DJL 功能演示" : "Play the DJL capabilities demo"}
                    onClick={() => videoRef.current?.play().catch(() => {})}
                  >
                    <span aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>

            <figcaption className="lp-cap-proofs">
              {proofLabels.map((label, index) => (
                <span className="lp-cap-proof" key={label}>
                  <i>{String(index + 1).padStart(2, "0")}</i>
                  {label}
                </span>
              ))}
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
