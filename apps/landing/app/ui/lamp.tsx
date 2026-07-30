"use client";

// Aceternity UI — Lamp (conic-gradient section header, Linear-style)
// Adapted: the bundled LampDemo is dropped, `bg-gradient-conic` removed (a v3 class that does not
// exist in Tailwind v4 — the inline conic-gradient already reads --tw-gradient-stops from
// from-/via-/to-), and the height is a prop so it can head a page instead of filling the screen.
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "../cn";
// The project's own matchMedia hook, matching Wake / IntroStage / ThreeSignalCore.
import { useReducedMotion } from "../effects";

export function LampContainer({
  children,
  className,
  // The children sit inside the glow rather than below it, which means lifting them back over the
  // rail. How far depends on how tall the caller made the lamp, so it is a prop.
  contentClassName = "-translate-y-80",
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const reduceMotion = useReducedMotion();

  // With reduced motion the lamp still renders at full width; only the sweep is skipped.
  const grow = (from: string, to: string) =>
    reduceMotion
      ? { initial: { opacity: 1, width: to }, whileInView: undefined }
      : {
          initial: { opacity: 0.5, width: from },
          whileInView: { opacity: 1, width: to },
        };

  const timing = { delay: 0.3, duration: 0.8, ease: "easeInOut" } as const;

  return (
    <div
      className={cn(
        "relative z-0 flex w-full flex-col items-center justify-center overflow-hidden bg-[#161412]",
        className,
      )}
    >
      <div className="relative isolate z-0 flex w-full flex-1 scale-y-125 items-center justify-center">
        <motion.div
          {...grow("15rem", "30rem")}
          transition={timing}
          style={{
            backgroundImage: "conic-gradient(var(--conic-position), var(--tw-gradient-stops))",
          }}
          className="absolute inset-auto right-1/2 h-56 w-[30rem] overflow-visible from-[#f08a46] via-transparent to-transparent text-white [--conic-position:from_70deg_at_center_top]"
        >
          <div className="absolute bottom-0 left-0 z-20 h-40 w-[100%] bg-[#161412] [mask-image:linear-gradient(to_top,white,transparent)]" />
          <div className="absolute bottom-0 left-0 z-20 h-[100%] w-40 bg-[#161412] [mask-image:linear-gradient(to_right,white,transparent)]" />
        </motion.div>

        <motion.div
          {...grow("15rem", "30rem")}
          transition={timing}
          style={{
            backgroundImage: "conic-gradient(var(--conic-position), var(--tw-gradient-stops))",
          }}
          className="absolute inset-auto left-1/2 h-56 w-[30rem] from-transparent via-transparent to-[#f08a46] text-white [--conic-position:from_290deg_at_center_top]"
        >
          <div className="absolute right-0 bottom-0 z-20 h-[100%] w-40 bg-[#161412] [mask-image:linear-gradient(to_left,white,transparent)]" />
          <div className="absolute right-0 bottom-0 z-20 h-40 w-[100%] bg-[#161412] [mask-image:linear-gradient(to_top,white,transparent)]" />
        </motion.div>

        <div className="absolute top-1/2 h-48 w-full translate-y-12 scale-x-150 bg-[#161412] blur-2xl" />
        <div className="absolute top-1/2 z-50 h-48 w-full bg-transparent opacity-10 backdrop-blur-md" />
        <div className="absolute inset-auto z-50 h-36 w-[28rem] -translate-y-1/2 rounded-full bg-[#f08a46] opacity-30 blur-3xl" />

        <motion.div
          {...grow("8rem", "16rem")}
          transition={timing}
          className="absolute inset-auto z-30 h-36 w-64 -translate-y-[6rem] rounded-full bg-[#f4a267] blur-2xl"
        />
        <motion.div
          {...grow("15rem", "30rem")}
          transition={timing}
          className="absolute inset-auto z-50 h-0.5 w-[30rem] -translate-y-[7rem] bg-[#f4a267]"
        />

        <div className="absolute inset-auto z-40 h-44 w-full -translate-y-[12.5rem] bg-[#161412]" />
      </div>

      <div className={cn("relative z-50 flex w-full flex-col items-center px-5", contentClassName)}>
        {children}
      </div>
    </div>
  );
}
