"use client";

// Aceternity UI — Layout Text Flip (a static phrase beside one rotating word)
// Adapted in four ways:
//  1. The rotation interval depends on the props it reads. Upstream passes [] to useEffect and so
//     keeps the first `words`/`duration` forever.
//  2. mode="wait" replaces upstream's mode="popLayout" + `layout`. Both depend on an exit animation
//     completing, but popLayout keeps the outgoing word mounted and absolutely positioned meanwhile,
//     so if an exit is ever interrupted the words pile up on top of each other. "wait" keeps exactly
//     one word mounted, which matters for a heading that has to stay readable.
//  3. The word styling is overridable, so it can sit in a light layout without the heavy default
//     white pill, ring and two shadows.
//  4. Rotation and blur stop for reduced motion.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "../cn";
// The project's own matchMedia hook rather than motion's, for consistency with Wake, IntroStage and
// ThreeSignalCore, which all already use it.
import { useReducedMotion } from "../effects";

export function LayoutTextFlip({
  text,
  words,
  duration = 3000,
  className,
  wordClassName,
}: {
  text: string;
  words: readonly string[];
  duration?: number;
  className?: string;
  wordClassName?: string;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion || words.length < 2) return;

    const interval = setInterval(() => {
      setCurrentIndex((previous) => (previous + 1) % words.length);
    }, duration);

    return () => clearInterval(interval);
  }, [duration, reduceMotion, words.length]);

  // Guards the case where `words` shrinks between renders and the index is left out of range.
  const word = words[currentIndex % words.length] ?? words[0] ?? "";

  return (
    <>
      <span className={className}>{text}</span>

      <span
        className={cn("relative inline-block w-fit overflow-hidden whitespace-nowrap", wordClassName)}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={word}
            initial={reduceMotion ? false : { y: -28, filter: "blur(8px)", opacity: 0 }}
            animate={{ y: 0, filter: "blur(0px)", opacity: 1 }}
            exit={reduceMotion ? undefined : { y: 28, filter: "blur(8px)", opacity: 0 }}
            transition={{ duration: 0.32, ease: "easeOut" }}
            className="inline-block whitespace-nowrap"
          >
            {word}
          </motion.span>
        </AnimatePresence>
      </span>
    </>
  );
}
