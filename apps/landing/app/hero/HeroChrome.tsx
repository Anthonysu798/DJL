"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { Content, Locale } from "../content";
import { useReducedMotion } from "../effects";
import "./hero-chrome.css";

/* signature easing (matches --ease-expo) */
const EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];
const AUTOPLAY_MS = 5000;

const HIDDEN = { opacity: 0, y: 12 };
const SHOWN = { opacity: 1, y: 0 };

/* The cinematic carousel chrome overlaid on the hero: prev/next circle arrows
   at the vertical-center screen edges, a bottom bar with an eyebrow + a bold
   uppercase statement that cycles through bilingual DJL value-prop slides, a
   segmented progress indicator (white seen / red active / gray upcoming), and
   a pause/play autoplay toggle bottom-right. `active` flips true once the boot
   overlay clears; the entrance plays only on that inactive -> active
   transition and collapses to the final state under reduced motion or for
   returning visitors (active on mount). Autoplay advances every 5s while
   playing, active, and motion is allowed; reduced motion defaults it OFF. */
export function HeroChrome({
  t,
  locale,
  active = true,
}: {
  t: Content;
  locale: Locale;
  active?: boolean;
}) {
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);

  // Was the chrome already revealed on first mount? If so (or reduced motion),
  // skip the entrance and render the final state.
  const wasActiveOnMount = useRef(active);
  const entrance = active && !reduced && !wasActiveOnMount.current;

  const slides = [
    {
      eyebrow: locale === "zh" ? "了解 DJL" : "DISCOVER DJL",
      title: t.hero.titleLines.join(" "),
    },
    { eyebrow: t.routing.tag, title: t.routing.title },
    { eyebrow: t.bilingual.tag, title: t.bilingual.title },
    { eyebrow: t.pipeline.tag, title: t.pipeline.title },
  ];
  const count = slides.length;
  const go = (dir: number) => setI((prev) => (prev + dir + count) % count);

  // Autoplay: advance while playing, visible, and motion is allowed. Keyed on
  // `i` too, so manual navigation restarts the dwell timer for the next slide.
  const autoplay = playing && active && !reduced;
  useEffect(() => {
    if (!autoplay) return;
    const id = window.setInterval(() => {
      setI((prev) => (prev + 1) % count);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [autoplay, count, i]);

  // Entrance: arrows, bar, and toggle fade/slide up LAST in the page stagger.
  const reveal = (delay: number) =>
    entrance ? { duration: 0.7, delay, ease: EXPO } : { duration: 0 };
  // Eyebrow + title crossfade on slide change (instant under reduced motion).
  const swap = reduced ? { duration: 0 } : { duration: 0.4, ease: EXPO };

  const current = slides[i];
  const playingNow = playing && !reduced;

  return (
    <div className="hc-root" aria-hidden={active ? undefined : true}>
      <motion.button
        type="button"
        className="hc-arrow hc-arrow-left"
        aria-label="Previous slide"
        onClick={() => go(-1)}
        initial={entrance ? HIDDEN : false}
        animate={active ? SHOWN : HIDDEN}
        transition={reveal(0.9)}
        whileHover={reduced ? undefined : { y: -2, scale: 1.06 }}
        whileTap={reduced ? undefined : { scale: 0.94 }}
      >
        <ChevronLeft className="hc-arrow-icon" aria-hidden="true" />
      </motion.button>

      <motion.button
        type="button"
        className="hc-arrow hc-arrow-right"
        aria-label="Next slide"
        onClick={() => go(1)}
        initial={entrance ? HIDDEN : false}
        animate={active ? SHOWN : HIDDEN}
        transition={reveal(0.94)}
        whileHover={reduced ? undefined : { y: -2, scale: 1.06 }}
        whileTap={reduced ? undefined : { scale: 0.94 }}
      >
        <ChevronRight className="hc-arrow-icon" aria-hidden="true" />
      </motion.button>

      <motion.div
        className="hc-bar"
        initial={entrance ? HIDDEN : false}
        animate={active ? SHOWN : HIDDEN}
        transition={reveal(0.98)}
      >
        <div className="hc-bar-text">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={i}
              className="hc-bar-inner"
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={swap}
            >
              <span className="hc-eyebrow">{current.eyebrow}</span>
              <span className="hc-title">{current.title}</span>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="hc-segs" role="group" aria-label="Carousel slides">
          {slides.map((slide, k) => {
            const state = k === i ? "active" : k < i ? "seen" : "upcoming";
            return (
              <button
                key={slide.eyebrow + k}
                type="button"
                className={`hc-seg ${state}`}
                onClick={() => setI(k)}
                aria-label={`Go to slide ${k + 1}: ${slide.eyebrow}`}
                aria-current={k === i ? "true" : undefined}
              >
                <span className="hc-seg-bar" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </motion.div>

      <motion.button
        type="button"
        className="hc-playpause"
        onClick={() => setPlaying((p) => !p)}
        disabled={reduced}
        aria-label={playingNow ? "Pause autoplay" : "Start autoplay"}
        aria-pressed={playingNow}
        initial={entrance ? HIDDEN : false}
        animate={active ? SHOWN : HIDDEN}
        transition={reveal(1.02)}
        whileHover={reduced ? undefined : { scale: 1.08 }}
        whileTap={reduced ? undefined : { scale: 0.92 }}
      >
        {playingNow ? (
          <Pause className="hc-playpause-icon" aria-hidden="true" />
        ) : (
          <Play className="hc-playpause-icon" aria-hidden="true" />
        )}
      </motion.button>
    </div>
  );
}
