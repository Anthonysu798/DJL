"use client";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";

/** Aceternity-style spotlight: a soft violet beam that drifts in behind the login card. */
export function Spotlight({ className }: { className?: string }) {
  return (
    <motion.svg
      aria-hidden
      initial={{ opacity: 0, x: -80 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 1.6, ease: "easeOut" }}
      className={cn("pointer-events-none absolute z-0 h-[170%] w-[140%] opacity-90", className)}
      viewBox="0 0 3787 2842"
      fill="none"
    >
      <g filter="url(#spot)">
        <ellipse
          cx="1924"
          cy="273"
          rx="1924"
          ry="273"
          transform="matrix(-0.82 -0.57 -0.57 0.82 3631 2291)"
          fill="oklch(0.7 0.2 295)"
          fillOpacity="0.38"
        />
      </g>
      <defs>
        <filter
          id="spot"
          x="0"
          y="0"
          width="3787"
          height="2842"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="151" />
        </filter>
      </defs>
    </motion.svg>
  );
}
