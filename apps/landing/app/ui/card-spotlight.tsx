"use client";

// Aceternity UI — Card Spotlight (mouse-follow radial glow, no WebGL)
import { type ReactNode } from "react";
import { motion, useMotionTemplate, useMotionValue } from "motion/react";
import { cn } from "../cn";

export function CardSpotlight({
  children,
  className,
  color = "rgba(31, 111, 235, 0.12)",
  radius = 240,
}: {
  children: ReactNode;
  className?: string;
  color?: string;
  radius?: number;
}) {
  const mouseX = useMotionValue(-radius);
  const mouseY = useMotionValue(-radius);

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set(e.clientX - rect.left);
    mouseY.set(e.clientY - rect.top);
  }

  const background = useMotionTemplate`radial-gradient(${radius}px circle at ${mouseX}px ${mouseY}px, ${color}, transparent 72%)`;

  return (
    <div onMouseMove={onMouseMove} className={cn("group relative overflow-hidden", className)}>
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ background }}
      />
      {/* sweep highlight on the top border */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(31,111,235,0.55)] to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
