"use client";

// Aceternity UI — Background Beams (travelling light along fanned paths)
import { memo } from "react";
import { motion } from "motion/react";
import { cn } from "../cn";

const W = 696;
const H = 316;
const COUNT = 18;

const paths = Array.from({ length: COUNT }, (_, i) => {
  const x = 20 + (i * (W - 40)) / (COUNT - 1);
  const sway = i % 2 === 0 ? 28 : -28;
  return `M ${x} ${H} C ${x + sway} ${H * 0.66} ${x - sway} ${H * 0.33} ${x + sway / 2} 0`;
});

export const BackgroundBeams = memo(function BackgroundBeams({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 flex items-end justify-center overflow-hidden",
        className,
      )}
      aria-hidden="true"
    >
      <svg
        className="h-full w-full"
        width="100%"
        height="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMax slice"
        fill="none"
      >
        <defs>
          <linearGradient id="bb-grad" x1="0" y1={H} x2="0" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ff8a3d" />
            <stop offset="0.5" stopColor="#ffb454" />
            <stop offset="1" stopColor="#5aa9ff" />
          </linearGradient>
        </defs>
        {paths.map((d, i) => (
          <path
            key={`base-${i}`}
            d={d}
            stroke="rgba(236,237,244,0.05)"
            strokeWidth="1"
            fill="none"
          />
        ))}
        {paths.map((d, i) => (
          <motion.path
            key={`beam-${i}`}
            d={d}
            stroke="url(#bb-grad)"
            strokeWidth="1.2"
            strokeLinecap="round"
            fill="none"
            strokeDasharray="50 600"
            initial={{ strokeDashoffset: 650 }}
            animate={{ strokeDashoffset: [650, 0] }}
            transition={{
              duration: 6 + (i % 5),
              delay: i * 0.28,
              repeat: Infinity,
              ease: "linear",
            }}
          />
        ))}
      </svg>
    </div>
  );
});
