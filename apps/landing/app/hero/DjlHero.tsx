"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import type { Content } from "../content";
import "./demo-hero.css";

gsap.registerPlugin(ScrollToPlugin);

/* Light "neobot" hero ported from Demo/. A self-contained client island: a boot
   screen that reveals the DJL logo then fades into the scene, a Spline robot
   stage on a light blueprint backdrop, drifting data particles, a pointer light
   + 3D tilt, a glass nav, a bottom glass copy bar and a MODEL / STATE HUD.
   All effects honour prefers-reduced-motion and clean up on unmount. */

const SPLINE_SRC = "https://my.spline.design/nexbotrobotcharacterconcept-iupgrmPA7dwDJtRLY7VIMaZF/";

type Particle = {
  x: number;
  y: number;
  speed: number;
  length: number;
  alpha: number;
};

export function DjlHero({ t }: { t: Content }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bootRef = useRef<HTMLDivElement>(null);
  // true while the boot reveal plays; locks scrolling so the intro is seen first
  const [booting, setBooting] = useState(true);
  const [splineMounted, setSplineMounted] = useState(false);

  // Always open at the hero on (re)load. Browsers restore the previous scroll
  // position by default, which left a refresh stuck mid-page; disable that and
  // jump to the top before paint so the boot reveal plays over the hero.
  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    window.scrollTo(0, 0);
  }, []);

  // Announce when the splash/boot intro has finished so the sticky nav (which
  // lives outside the hero's stacking context) can reveal itself only then.
  useEffect(() => {
    if (booting) return;
    (window as unknown as { __djlIntroDone?: boolean }).__djlIntroDone = true;
    window.dispatchEvent(new Event("djl:intro-done"));
  }, [booting]);

  useEffect(() => {
    if (booting) return;
    const timer = window.setTimeout(() => setSplineMounted(true), 220);
    return () => window.clearTimeout(timer);
  }, [booting]);

  // Hold the page on the hero until the boot reveal finishes. React owns the
  // lock/unlock via the `booting` flag, so it stays correct under StrictMode.
  useEffect(() => {
    if (!booting) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    window.scrollTo(0, 0);

    // overflow:hidden only blocks the scrollbar; also swallow the actual scroll
    // input (wheel / touch / scroll keys) so nothing moves during the intro.
    const prevent = (event: Event) => event.preventDefault();
    const scrollKeys = new Set([" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End"]);
    const preventKey = (event: KeyboardEvent) => {
      if (scrollKeys.has(event.key)) event.preventDefault();
    };
    window.addEventListener("wheel", prevent, { passive: false });
    window.addEventListener("touchmove", prevent, { passive: false });
    window.addEventListener("keydown", preventKey, { passive: false });

    // Deterministic end of the intro: fade the boot screen and release the
    // scroll lock after the reveal has played (~2.6s + buffer). Reduced motion
    // skips the intro, so it unlocks on the next tick instead.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const unlockTimer = window.setTimeout(() => setBooting(false), reduce ? 0 : 2900);
    return () => {
      window.clearTimeout(unlockTimer);
      window.removeEventListener("wheel", prevent);
      window.removeEventListener("touchmove", prevent);
      window.removeEventListener("keydown", preventKey);
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, [booting]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let targetX = 0.5;
    let targetY = 0.45;
    let pointerX = 0.5;
    let pointerY = 0.45;
    let rafParticles = 0;
    let rafPointer = 0;
    let heroVisible = true;
    let lastParticleFrame = 0;
    let lastPointerFrame = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.35);
      const rect = root.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(64, Math.max(28, Math.floor(width / 28)));
      particles = Array.from({ length: count }, (_, index) => ({
        x: (index / count) * width + Math.random() * 90,
        y: Math.random() * height,
        speed: 0.22 + Math.random() * 0.88,
        length: 42 + Math.random() * 120,
        alpha: 0.12 + Math.random() * 0.34,
      }));
    };

    const renderParticles = (loop: boolean, now = 0) => {
      if (!heroVisible || document.hidden) {
        if (loop) rafParticles = requestAnimationFrame((time) => renderParticles(true, time));
        return;
      }
      if (loop && now - lastParticleFrame < 34) {
        rafParticles = requestAnimationFrame((time) => renderParticles(true, time));
        return;
      }
      lastParticleFrame = now;
      ctx.clearRect(0, 0, width, height);
      const driftX = (pointerX - 0.5) * 24;
      const driftY = (pointerY - 0.5) * 18;
      for (const p of particles) {
        if (loop) {
          p.y += p.speed;
          p.x += Math.sin((p.y + p.length) * 0.006) * 0.18;
          if (p.y - p.length > height) {
            p.y = -p.length;
            p.x = Math.random() * width;
          }
        }
        const gradient = ctx.createLinearGradient(
          p.x + driftX,
          p.y + driftY - p.length,
          p.x + driftX,
          p.y + driftY,
        );
        gradient.addColorStop(0, "rgba(126, 214, 255, 0)");
        gradient.addColorStop(0.5, `rgba(126, 214, 255, ${p.alpha})`);
        gradient.addColorStop(1, "rgba(126, 214, 255, 0)");
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x + driftX, p.y + driftY - p.length);
        ctx.lineTo(p.x + driftX, p.y + driftY);
        ctx.stroke();
      }
      if (loop) rafParticles = requestAnimationFrame((time) => renderParticles(true, time));
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      targetX = (event.clientX - rect.left) / rect.width;
      targetY = (event.clientY - rect.top) / rect.height;
    };

    const animatePointer = (now = 0) => {
      if (!heroVisible || document.hidden || now - lastPointerFrame < 34) {
        rafPointer = requestAnimationFrame(animatePointer);
        return;
      }
      lastPointerFrame = now;
      pointerX += (targetX - pointerX) * 0.12;
      pointerY += (targetY - pointerY) * 0.12;
      const tiltY = (pointerX - 0.5) * 3.4;
      const tiltX = (0.5 - pointerY) * 2.8;
      const depthX = (pointerX - 0.5) * 34;
      const depthY = (pointerY - 0.5) * 22;
      root.style.setProperty("--dh-mx", `${pointerX * 100}%`);
      root.style.setProperty("--dh-my", `${pointerY * 100}%`);
      root.style.setProperty("--dh-tilt-x", `${tiltX.toFixed(2)}deg`);
      root.style.setProperty("--dh-tilt-y", `${tiltY.toFixed(2)}deg`);
      root.style.setProperty("--dh-far-x", `${(-depthX * 0.22).toFixed(2)}px`);
      root.style.setProperty("--dh-far-y", `${(-depthY * 0.18).toFixed(2)}px`);
      root.style.setProperty("--dh-mid-x", `${(depthX * 0.18).toFixed(2)}px`);
      root.style.setProperty("--dh-mid-y", `${(depthY * 0.14).toFixed(2)}px`);
      root.style.setProperty("--dh-near-x", `${(depthX * 0.34).toFixed(2)}px`);
      root.style.setProperty("--dh-near-y", `${(depthY * 0.24).toFixed(2)}px`);
      rafPointer = requestAnimationFrame(animatePointer);
    };

    resize();
    if (reduce) {
      renderParticles(false);
    } else {
      renderParticles(true);
      animatePointer();
    }

    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove);
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        heroVisible = entry?.isIntersecting ?? true;
        if (heroVisible) renderParticles(false);
      },
      { threshold: 0.08 },
    );
    visibilityObserver.observe(root);

    // Boot reveal: fade the DJL logo in, sweep a scan line, brighten, then fade
    // the whole black screen out and hide it.
    const boot = bootRef.current;
    let bootTl: gsap.core.Timeline | null = null;
    // Reduced motion has no intro; the lock effect unlocks immediately (delay 0).
    if (boot && !reduce) {
      bootTl = gsap.timeline({ defaults: { ease: "power3.out" } });
      bootTl
        .to(boot.querySelector(".dh-boot-logo"), {
          opacity: 1,
          scale: 1,
          duration: 0.85,
        })
        .to(boot.querySelector(".dh-boot-scan"), { x: "115%", duration: 0.95 }, "-=0.35")
        .to(
          boot.querySelector(".dh-boot-logo"),
          {
            filter: "invert(1) drop-shadow(0 0 48px rgba(125, 215, 255, 0.72))",
            duration: 0.42,
          },
          "-=0.28",
        );
      // NOTE: the black screen fade-out + scroll unlock are React-driven via the
      // `booting` flag (see the lock effect), not GSAP onComplete, so the intro
      // can never get stuck if the timeline lags.
    }

    // Scroll parallax (scene push-in + giant word drift), scoped to the hero.
    // One ScrollTrigger drives a single timeline (instead of two competing
    // triggers) and a numeric `scrub` adds a short lerp so the motion catches
    // up smoothly to the scroll without re-rendering on every raw scroll tick.
    gsap.registerPlugin(ScrollTrigger);
    const triggers: ScrollTrigger[] = [];
    let scrollTl: gsap.core.Timeline | null = null;
    if (!reduce) {
      scrollTl = gsap.timeline({
        defaults: { ease: "none", force3D: true },
        scrollTrigger: {
          trigger: root,
          start: "top top",
          end: "bottom top",
          scrub: 0.4,
          invalidateOnRefresh: true,
          fastScrollEnd: true,
        },
      });
      scrollTl
        .to(root.querySelector(".dh-motion"), { y: -120, opacity: 0.32 }, 0)
        .to(root.querySelector(".dh-giant"), { y: -120, opacity: 0.2 }, 0);
      if (scrollTl.scrollTrigger) triggers.push(scrollTl.scrollTrigger);
    }

    return () => {
      scrollTl?.kill();
      cancelAnimationFrame(rafParticles);
      cancelAnimationFrame(rafPointer);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      visibilityObserver.disconnect();
      bootTl?.kill();
      triggers.forEach((trigger) => trigger.kill());
    };
  }, []);

  // When the hero scrolls back into view (e.g. clicking "Open workspace" jumps
  // up from the footer), the Spline embed can be left at a stale canvas size and
  // render stretched, especially on tablet/landscape where the browser throttled
  // it off-screen. Nudge the iframe's width so the embed re-measures and re-fits.
  useEffect(() => {
    const root = rootRef.current;
    const frame = root?.querySelector<HTMLIFrameElement>(".dh-frame iframe");
    if (!root || !frame) return;
    const refit = () => {
      frame.style.width = "99.9%";
      requestAnimationFrame(() => {
        frame.style.width = "100%";
      });
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) refit();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(root);
    return () => io.disconnect();
  }, [splineMounted]);

  return (
    <div className="djl-hero" id="top" ref={rootRef}>
      <div
        className="dh-boot"
        data-done={booting ? "false" : "true"}
        ref={bootRef}
        aria-hidden="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/djl-logo.png" alt="" className="dh-boot-logo" />
        <div className="dh-boot-scan" />
      </div>

      <canvas className="dh-particles" ref={canvasRef} aria-hidden="true" />

      <div className="dh-scene" aria-hidden="true">
        <div className="dh-giant">DJL</div>
        <div className="dh-glow" />
        <div className="dh-motion">
          <div className="dh-frame">
            {splineMounted ? (
              <iframe
                title="DJL AI 3D assistant"
                src={SPLINE_SRC}
                loading="lazy"
                allow="autoplay; fullscreen; xr-spatial-tracking"
                tabIndex={-1}
              />
            ) : (
              <div className="dh-spline-placeholder" aria-hidden="true">
                <span />
              </div>
            )}
          </div>
        </div>
        <div className="dh-vignette" />
        <div className="dh-pointer" />
      </div>

      <section className="dh-content">
        <div className="dh-hud" aria-hidden="true">
          <div className="dh-hud-line" />
          <div className="dh-metric">
            <span>{t.hero.hud.model}</span>
            <strong>{t.hero.hud.modelValue}</strong>
          </div>
          <div className="dh-metric">
            <span>{t.hero.hud.state}</span>
            <strong>{t.hero.hud.stateValue}</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
