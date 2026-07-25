"use client";

import { useRef, type CSSProperties } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import type { Content } from "./content";
import { useReducedMotion } from "./effects";

gsap.registerPlugin(useGSAP);

const letters = ["D", "J", "L"] as const;
const sliceCount = 9;

export function Wake({
  boot,
  progress,
  zoom,
  onSkip,
}: {
  boot: Content["boot"];
  progress: number;
  zoom: boolean;
  onSkip: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const pct = Math.round(progress);
  const ready = pct >= 100;
  const visibleLines = Math.min(boot.lines.length, Math.ceil((progress / 92) * boot.lines.length));

  useGSAP(
    () => {
      const q = gsap.utils.selector(rootRef);

      if (reduced) {
        gsap.set(q(".wake-echo"), { autoAlpha: 0.12, y: 0, scale: 1 });
        gsap.set(q(".wake-letter, .wake-meta, .wake-line"), {
          autoAlpha: 1,
          x: 0,
          y: 0,
          yPercent: 0,
          rotateX: 0,
          scaleX: 1,
        });
        gsap.set(q(".wake-slice, .wake-play"), { autoAlpha: 0 });
        return;
      }

      const tl = gsap.timeline({
        defaults: { force3D: true },
      });

      tl.set(q(".wake-echo"), {
        autoAlpha: 0,
        y: 46,
        scale: 0.9,
        filter: "blur(14px)",
      })
        .set(q(".wake-letter"), {
          autoAlpha: 0,
          yPercent: 106,
          rotateX: -34,
          transformOrigin: "50% 100%",
        })
        .set(q(".wake-slice"), {
          autoAlpha: 0,
          x: (i) => (i % 2 === 0 ? -28 : 30),
        })
        .set(q(".wake-play"), {
          autoAlpha: 0,
          x: -180,
          scaleX: 0.18,
          transformOrigin: "0% 50%",
        })
        .set(q(".wake-line"), { autoAlpha: 1, scaleX: 0, transformOrigin: "0% 50%" })
        .set(q(".wake-meta"), { autoAlpha: 0, y: 16 })
        .to(
          q(".wake-echo"),
          {
            autoAlpha: (i) => (i === 1 ? 0.28 : 0.14),
            y: 0,
            scale: 1,
            filter: "blur(0px)",
            duration: 0.58,
            ease: "expo.out",
            stagger: { each: 0.08, from: "center" },
          },
          0.14,
        )
        .to(
          q(".wake-echo"),
          {
            x: (i) => [-26, 0, 26][i] ?? 0,
            autoAlpha: (i) => (i === 1 ? 0.2 : 0.08),
            duration: 0.72,
            ease: "sine.inOut",
          },
          0.48,
        )
        .to(
          q(".wake-letter"),
          {
            autoAlpha: 1,
            yPercent: 0,
            rotateX: 0,
            duration: 0.76,
            ease: "power4.out",
            stagger: { each: 0.075, from: "start" },
          },
          0.54,
        )
        .to(
          q(".wake-play"),
          {
            autoAlpha: 0.72,
            x: -16,
            scaleX: 1,
            duration: 0.34,
            ease: "expo.out",
          },
          0.78,
        )
        .to(
          q(".wake-play"),
          {
            autoAlpha: 0.16,
            x: 186,
            duration: 0.52,
            ease: "power3.in",
          },
          1.04,
        )
        .to(
          q(".wake-slice"),
          {
            autoAlpha: 1,
            x: 0,
            duration: 0.34,
            ease: "power4.out",
            stagger: { each: 0.018, from: "random" },
          },
          0.86,
        )
        .to(
          q(".wake-slice"),
          {
            autoAlpha: 0,
            x: (i) => (i % 2 === 0 ? 16 : -14),
            duration: 0.22,
            ease: "power2.in",
            stagger: { each: 0.01, from: "edges" },
          },
          1.24,
        )
        .to(q(".wake-line"), { scaleX: 1, duration: 0.46, ease: "expo.out" }, 1.2)
        .to(
          q(".wake-meta"),
          {
            autoAlpha: 1,
            y: 0,
            duration: 0.42,
            ease: "power3.out",
            stagger: 0.055,
          },
          1.26,
        )
        .to(
          q(".wake-word-main"),
          {
            textShadow: "0 0 42px rgba(255, 180, 84, 0.34)",
            duration: 0.7,
            ease: "sine.inOut",
          },
          1.46,
        );

      return () => tl.kill();
    },
    { scope: rootRef, dependencies: [reduced] },
  );

  return (
    <div
      ref={rootRef}
      className={`wake ${zoom ? "zoom" : ""}`}
      role="dialog"
      aria-label={boot.label}
      onClick={onSkip}
    >
      <div className="wake-backdrop" aria-hidden="true">
        <span>DJL</span>
      </div>
      <div className="wake-scan" aria-hidden="true" />

      <div className="wake-panel">
        <div className="wake-stack" aria-hidden="true">
          {[0, 1, 2].map((item) => (
            <span className="wake-echo" key={item}>
              DJL
            </span>
          ))}
        </div>

        <div className="wake-logo" aria-label="DJL">
          <div className="wake-sliced" aria-hidden="true">
            {Array.from({ length: sliceCount }, (_, i) => {
              const top = (i / sliceCount) * 100;
              const bottom = ((i + 1) / sliceCount) * 100;
              return (
                <span
                  key={i}
                  className="wake-slice"
                  style={
                    {
                      "--slice-top": `${top}%`,
                      "--slice-bottom": `${bottom}%`,
                    } as CSSProperties
                  }
                >
                  DJL
                </span>
              );
            })}
          </div>

          <span className="wake-play" aria-hidden="true" />

          <div className="wake-word-main" aria-hidden="true">
            {letters.map((letter) => (
              <span key={letter} className="wake-letter">
                {letter}
              </span>
            ))}
          </div>
        </div>

        <div className="wake-line" aria-hidden="true" />

        <div className="wake-meta-row">
          <div className="wake-meta">
            <span className="dot dot-amber" />
            <span>{boot.label}</span>
          </div>
          <div className="wake-meta wake-counter">
            <span>{ready ? boot.ready : "calibrating"}</span>
            <strong>{String(pct).padStart(3, "0")}%</strong>
          </div>
        </div>

        <div className="wake-log">
          {boot.lines.slice(0, visibleLines).map((line, i) => {
            const isLast = i === visibleLines - 1 && !ready;
            return (
              <div
                key={line.text}
                className="wake-log-row"
                style={{ color: line.ok ? "var(--paper-dim)" : "var(--mute)" }}
              >
                <span
                  style={{
                    color: line.ok ? "var(--amber)" : "var(--mute-2)",
                  }}
                >
                  {line.ok ? "OK" : ".."}
                </span>
                <span>{line.text}</span>
                {isLast && <span className="caret">▋</span>}
              </div>
            );
          })}
        </div>

        <div className="wake-meter" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>

        <div className="wake-hint">
          {ready ? "entering" : "press any key to enter"} /{" "}
          <button
            className="underline-offset-4 hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onSkip();
            }}
          >
            skip intro
          </button>
        </div>
      </div>
    </div>
  );
}
