"use client";

// Aceternity UI — SVG Mask Effect (a cursor-shaped hole revealing the layer beneath)
// Adapted in four ways that upstream needs before it can carry real content:
//  1. It reveals only on mousemove. On touch or keyboard the revealed text would be unreachable
//     forever, so devices without a fine hovering pointer get both layers rendered plainly.
//  2. `any` types and a stale-ref cleanup are replaced with typed refs and a captured element.
//  3. The animated background used var(--slate-900)/var(--white), which are not defined in this
//     project, so the animation was a no-op. Naming real colours makes it run — and it has to be
//     caller-supplied, because upstream's white base paints a glaring slab on a dark page.
//  4. h-screen is a default, not a hard-coded height.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "../cn";

export function MaskContainer({
  children,
  revealText,
  size = 10,
  revealSize = 400,
  className,
  baseColor = "#ffffff",
  hoverColor = "#020617",
}: {
  children?: ReactNode;
  revealText?: ReactNode;
  size?: number;
  revealSize?: number;
  className?: string;
  /** Container colour at rest. Must match the surrounding surface or it reads as a slab. */
  baseColor?: string;
  hoverColor?: string;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  // Until the pointer has actually been over the container, there is no meaningful position, and
  // upstream's {0,0} default parks a visible dot in the top-left corner. Hold the mask closed.
  const [hasPointer, setHasPointer] = useState(false);
  // Starts null so the first paint does not commit to either branch before matchMedia is read.
  const [canHover, setCanHover] = useState<boolean | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    setCanHover(query.matches);

    const onChange = (event: MediaQueryListEvent) => setCanHover(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || canHover !== true) return;

    const onMove = (event: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      setPosition({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      setHasPointer(true);
    };

    element.addEventListener("mousemove", onMove);
    return () => element.removeEventListener("mousemove", onMove);
  }, [canHover]);

  // Without a hovering pointer the mask is not an interaction, it is a wall. Show both layers.
  if (canHover === false) {
    return (
      <div className={cn("relative", className)}>
        <div>{children}</div>
        <div>{revealText}</div>
      </div>
    );
  }

  const maskSize = hasPointer ? (isHovered ? revealSize : size) : 0;

  return (
    <motion.div
      ref={containerRef}
      className={cn("relative h-screen", className)}
      animate={{ backgroundColor: isHovered ? hoverColor : baseColor }}
      transition={{ backgroundColor: { duration: 0.3 } }}
    >
      <motion.div
        className="absolute flex h-full w-full items-center justify-center bg-black [mask-image:url(/mask.svg)] [mask-repeat:no-repeat] [mask-size:40px] dark:bg-white"
        animate={{
          maskPosition: `${position.x - maskSize / 2}px ${position.y - maskSize / 2}px`,
          maskSize: `${maskSize}px`,
        }}
        transition={{
          maskSize: { duration: 0.3, ease: "easeInOut" },
          maskPosition: { duration: 0.15, ease: "linear" },
        }}
      >
        <div className="absolute inset-0 z-0 h-full w-full bg-black opacity-50 dark:bg-white" />
        <div
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className="relative z-20 mx-auto w-full"
        >
          {children}
        </div>
      </motion.div>

      <div className="flex h-full w-full items-center justify-center">{revealText}</div>
    </motion.div>
  );
}
