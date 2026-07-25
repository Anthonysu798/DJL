"use client";

/* ─────────────────────────────────────────────────────────────────────────
   HeroStage - the DJL hero centrepiece (deep-red cinematic).

   A full-bleed stage drenched in deep red: ONE vivid red stage glow, slow
   drifting red smoke, a bold solid "DJL" wordmark, a centred Spline robot
   read as black with red environment light, a bright red laser horizon at
   the robot's base, and a glossy floor reflection. Purely decorative: the
   root is position:absolute, inset:0, pointer-events:none, so it never traps
   scroll or clicks (the robot iframe is a backdrop).

   Entrance (Motion, gated on `active` AND reduced-motion):
     stage glow blooms in, the wordmark fades up + scales, the robot settles
     from a blurred over-scale. The ambient smoke drift is CSS-driven and
     runs only while the stage is live (data-live) and motion is allowed.
     If reduced-motion is on, or the component mounts with `active` already
     true, it renders the final state with no animation; the entrance only
     plays when it mounts inactive (behind the boot overlay) and `active`
     later flips true.
   ───────────────────────────────────────────────────────────────────────── */

import { useRef } from "react";
import { motion, type Variants } from "motion/react";
import { useReducedMotion } from "../effects";
import "./hero-stage.css";

const EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

const STAGEGLOW: Variants = {
  boot: { opacity: 0, scale: 0.96 },
  in: { opacity: 1, scale: 1, transition: { duration: 1.1, ease: EXPO } },
};

const WATERMARK: Variants = {
  boot: { opacity: 0, y: 26, scale: 0.92 },
  in: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 1.0, delay: 0.25, ease: EXPO },
  },
};

const ROBOT: Variants = {
  boot: { opacity: 0, scale: 1.06, filter: "blur(8px)" },
  in: {
    opacity: 1,
    scale: 1,
    filter: "blur(0px)",
    transition: { duration: 1.2, delay: 0.4, ease: EXPO },
  },
};

export function HeroStage({
  watermark = "DJL",
  active = true,
}: {
  watermark?: string;
  active?: boolean;
}) {
  const reduced = useReducedMotion();

  // Did we mount behind the boot overlay? Only then is there an entrance to
  // play; a stage that mounts already-active (or under reduced motion) jumps
  // straight to the final frame. useRef captures the first-render value once.
  const startedInactive = useRef(!active);
  const shouldAnimate = !reduced && startedInactive.current;

  // Reduced motion always rests on the final state regardless of `active`.
  const target = reduced || active ? "in" : "boot";
  const initial = shouldAnimate ? "boot" : "in";

  // Ambient smoke drift runs only when the stage is live and motion allowed.
  const live = active && !reduced;

  return (
    <div className="hs-root" data-live={live ? "true" : "false"} aria-hidden="true">
      {/* z0 :: stage glow + vignette + drifting red smoke */}
      <motion.div className="hs-backdrop" variants={STAGEGLOW} initial={initial} animate={target}>
        <div className="hs-fog">
          <span className="hs-fog-blob hs-fog-a" />
          <span className="hs-fog-blob hs-fog-b" />
          <span className="hs-fog-blob hs-fog-c" />
        </div>
      </motion.div>

      {/* z1 :: monumental solid wordmark (always Latin "DJL") */}
      <div className="hs-watermark">
        <motion.span
          className="hs-watermark-text"
          variants={WATERMARK}
          initial={initial}
          animate={target}
        >
          {watermark}
        </motion.span>
      </div>

      {/* z2 :: robot layer (floor, laser, glow, robot) */}
      <div className="hs-robotlayer">
        <div className="hs-contact" />
        <div className="hs-reflection" />
        <div className="hs-laser" />
        <div className="hs-robot-glow" />
        <div className="hs-robotwrap">
          <motion.div className="hs-robot-anim" variants={ROBOT} initial={initial} animate={target}>
            <iframe
              className="hs-robot"
              src="https://my.spline.design/nexbotrobotcharacterconcept-Nk9PfU4UDu1vmRbuCfnFwHef/"
              title="DJL agent robot"
              loading="eager"
              allow="autoplay; fullscreen"
              referrerPolicy="no-referrer-when-downgrade"
              tabIndex={-1}
              aria-hidden="true"
            />
          </motion.div>
        </div>
      </div>

      {/* z3 :: legibility scrims */}
      <div className="hs-scrim hs-scrim-top" />
      <div className="hs-scrim hs-scrim-bottom" />
    </div>
  );
}
