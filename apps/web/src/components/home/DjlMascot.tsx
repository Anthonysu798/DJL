// FILE: DjlMascot.tsx
// Purpose: Volt, DJL's pixel dragon. It stands on the edge of the new-chat composer, idles and
//          blinks, waves when you point at it, and jumps when clicked.
// Layer: Home presentation. Frames come from `public/mascot/djl-dragon.webp`: the idle, waving
//        and jumping rows of a Codex-generated pet atlas (8 columns of 192x208 cells; the
//        full pet is also installed as a Codex pet). CSS lives in index.css (`.djl-mascot*`).
//        Under reduced motion it shows one still frame.

import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

const ATLAS_COLUMNS = 8;
const ATLAS_ROWS = 3;

/**
 * Atlas rows, with each frame's duration in ms (the Codex pet contract). The jump row was drawn
 * about 8% smaller than the others, so it is scaled back up from the feet.
 */
const ANIMATIONS = {
  idle: { row: 0, scale: 1, durations: [280, 110, 110, 140, 140, 320] },
  waving: { row: 1, scale: 1, durations: [140, 140, 140, 280] },
  jumping: { row: 2, scale: 1.08, durations: [140, 140, 140, 140, 280] },
} as const;

type MascotAnimation = keyof typeof ANIMATIONS;

/** Pause between idle loops, so the dragon rests instead of fidgeting nonstop. */
const IDLE_REST_MS = 2400;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

export function DjlMascot(props: { label: string; className?: string }) {
  const [animation, setAnimation] = useState<MascotAnimation>("idle");
  const [frame, setFrame] = useState(0);
  // Bumped on every click or hover so the same one-shot animation can restart.
  const [play, setPlay] = useState(0);
  const reducedMotion = useRef(prefersReducedMotion()).current;

  useEffect(() => {
    if (reducedMotion) {
      // Still frame only; a click still counts, then quietly ends.
      if (animation === "idle") return;
      const timer = window.setTimeout(() => setAnimation("idle"), 700);
      return () => window.clearTimeout(timer);
    }
    const { durations } = ANIMATIONS[animation];
    let index = 0;
    let timer = 0;
    const step = () => {
      const isLast = index === durations.length - 1;
      timer = window.setTimeout(
        () => {
          if (!isLast) {
            index += 1;
            setFrame(index);
            step();
            return;
          }
          if (animation !== "idle") {
            // A wave or jump plays once, then the dragon settles back into its idle loop.
            setAnimation("idle");
            setFrame(0);
            return;
          }
          index = 0;
          setFrame(0);
          step();
        },
        durations[index]! + (isLast && animation === "idle" ? IDLE_REST_MS : 0),
      );
    };
    setFrame(0);
    step();
    return () => window.clearTimeout(timer);
  }, [animation, play, reducedMotion]);

  const start = (next: MascotAnimation) => {
    setAnimation(next);
    setPlay((count) => count + 1);
  };

  const { row, scale } = ANIMATIONS[animation];
  const column = reducedMotion ? 0 : frame;

  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      data-happy={animation === "jumping" ? "" : undefined}
      onClick={() => start("jumping")}
      onPointerEnter={() => {
        if (animation === "idle") start("waving");
      }}
      className={cn(
        "djl-mascot relative block cursor-pointer select-none outline-none [-webkit-tap-highlight-color:transparent]",
        "focus-visible:rounded-2xl focus-visible:ring-2 focus-visible:ring-[var(--color-text-accent)]/60",
        props.className,
      )}
    >
      <span
        aria-hidden="true"
        className="djl-mascot-sprite block h-full w-full"
        style={{
          backgroundPosition: `${(column / (ATLAS_COLUMNS - 1)) * 100}% ${(row / (ATLAS_ROWS - 1)) * 100}%`,
          ...(scale === 1 ? {} : { transform: `scale(${scale})`, transformOrigin: "50% 97%" }),
        }}
      />
    </button>
  );
}
