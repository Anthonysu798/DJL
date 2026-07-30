"use client";

// Aceternity UI — Aurora Background (animated northern-lights wash)
// Adapted: upstream wraps its children in <main>, which would nest a second <main> inside a page
// that already has one — that is invalid and costs the document outline, so it is a <div> here.
// The fixed h-[100vh] is also dropped so this can head a page rather than fill the screen.
// Requires the --animate-aurora keyframes registered in globals.css.
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "../cn";

// Upstream reads these through CSS variables so the long arbitrary-property chain below stays
// readable. Keeping them here rather than in globals.css keeps the component self-contained.
//
// The gradients use real spaces, NOT the `_` that upstream copied from its own Tailwind classes.
// Tailwind rewrites `_` to a space when it compiles an arbitrary *class* value, but an inline style
// attribute is raw CSS: the underscores survive, the gradient fails to parse, and because custom
// properties accept almost any token the failure only surfaces later — `background-image` resolves
// to `none` and the whole aurora silently disappears.
const AURORA_VARS = {
  "--aurora":
    "repeating-linear-gradient(100deg, #3b82f6 10%, #a5b4fc 15%, #93c5fd 20%, #ddd6fe 25%, #60a5fa 30%)",
  "--dark-gradient":
    "repeating-linear-gradient(100deg, #000 0%, #000 7%, transparent 10%, transparent 12%, #000 16%)",
  "--white-gradient":
    "repeating-linear-gradient(100deg, #fff 0%, #fff 7%, transparent 10%, transparent 12%, #fff 16%)",
  "--transparent": "transparent",
} as CSSProperties;

export function AuroraBackground({
  className,
  children,
  showRadialGradient = true,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  showRadialGradient?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center bg-zinc-50 text-slate-950 dark:bg-zinc-900",
        className,
      )}
      {...props}
    >
      <div className="absolute inset-0 overflow-hidden" style={AURORA_VARS} aria-hidden="true">
        <div
          className={cn(
            // Upstream also re-declares --aurora/--dark-gradient/--white-gradient here as arbitrary
            // properties. They are dead weight: an inline style always wins over a class for the
            // same custom property, so the values in AURORA_VARS are the ones that apply.
            `pointer-events-none absolute -inset-[10px] opacity-50 blur-[10px] invert filter will-change-transform [background-image:var(--white-gradient),var(--aurora)] [background-position:50%_50%,50%_50%] [background-size:300%,_200%] after:absolute after:inset-0 after:animate-aurora after:mix-blend-difference after:content-[""] after:[background-attachment:fixed] after:[background-image:var(--white-gradient),var(--aurora)] after:[background-size:200%,_100%] dark:invert-0 dark:[background-image:var(--dark-gradient),var(--aurora)] after:dark:[background-image:var(--dark-gradient),var(--aurora)]`,
            // The aurora is decoration, so it holds still when the visitor asked for less motion.
            "motion-reduce:after:animate-none",
            showRadialGradient &&
              "[mask-image:radial-gradient(ellipse_at_100%_0%,black_10%,var(--transparent)_70%)]",
          )}
        />
      </div>
      {children}
    </div>
  );
}
