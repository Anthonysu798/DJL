"use client";

// Magic UI — Animated Beam
import { type RefObject, useEffect, useId, useState } from "react";
import { motion } from "motion/react";
import { cn } from "../cn";

export interface AnimatedBeamProps {
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
  curvature?: number;
  reverse?: boolean;
  duration?: number;
  delay?: number;
  pathColor?: string;
  pathWidth?: number;
  pathOpacity?: number;
  gradientStartColor?: string;
  gradientStopColor?: string;
  startXOffset?: number;
  startYOffset?: number;
  endXOffset?: number;
  endYOffset?: number;
  className?: string;
}

export function AnimatedBeam({
  containerRef,
  fromRef,
  toRef,
  curvature = 0,
  reverse = false,
  duration = 4.5,
  delay = 0,
  pathColor = "rgba(236,237,244,0.12)",
  pathWidth = 1.5,
  pathOpacity = 1,
  gradientStartColor = "#ffb454",
  gradientStopColor = "#5aa9ff",
  startXOffset = 0,
  startYOffset = 0,
  endXOffset = 0,
  endYOffset = 0,
  className,
}: AnimatedBeamProps) {
  const id = useId();
  const [pathD, setPathD] = useState("");
  const [svg, setSvg] = useState({ width: 0, height: 0 });

  const gradientCoordinates = reverse
    ? { x1: ["90%", "-10%"], x2: ["100%", "0%"], y1: ["0%", "0%"], y2: ["0%", "0%"] }
    : { x1: ["10%", "110%"], x2: ["0%", "100%"], y1: ["0%", "0%"], y2: ["0%", "0%"] };

  useEffect(() => {
    const update = () => {
      if (!containerRef.current || !fromRef.current || !toRef.current) return;
      const c = containerRef.current.getBoundingClientRect();
      const a = fromRef.current.getBoundingClientRect();
      const b = toRef.current.getBoundingClientRect();
      setSvg({ width: c.width, height: c.height });
      const startX = a.left - c.left + a.width / 2 + startXOffset;
      const startY = a.top - c.top + a.height / 2 + startYOffset;
      const endX = b.left - c.left + b.width / 2 + endXOffset;
      const endY = b.top - c.top + b.height / 2 + endYOffset;
      const controlY = startY - curvature;
      setPathD(`M ${startX},${startY} Q ${(startX + endX) / 2},${controlY} ${endX},${endY}`);
    };

    const ro = new ResizeObserver(() => update());
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", update);
    update();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [containerRef, fromRef, toRef, curvature, startXOffset, startYOffset, endXOffset, endYOffset]);

  return (
    <svg
      fill="none"
      width={svg.width}
      height={svg.height}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${svg.width} ${svg.height}`}
      className={cn("pointer-events-none absolute left-0 top-0 transform-gpu", className)}
      aria-hidden="true"
    >
      <path
        d={pathD}
        stroke={pathColor}
        strokeWidth={pathWidth}
        strokeOpacity={pathOpacity}
        strokeLinecap="round"
      />
      <path d={pathD} strokeWidth={pathWidth} stroke={`url(#${id})`} strokeLinecap="round" />
      <defs>
        <motion.linearGradient
          className="transform-gpu"
          id={id}
          gradientUnits="userSpaceOnUse"
          initial={{ x1: "0%", x2: "0%", y1: "0%", y2: "0%" }}
          animate={{
            x1: gradientCoordinates.x1,
            x2: gradientCoordinates.x2,
            y1: gradientCoordinates.y1,
            y2: gradientCoordinates.y2,
          }}
          transition={{
            delay,
            duration,
            ease: [0.16, 1, 0.3, 1],
            repeat: Infinity,
            repeatDelay: 0,
          }}
        >
          <stop stopColor={gradientStartColor} stopOpacity="0" />
          <stop stopColor={gradientStartColor} />
          <stop offset="32.5%" stopColor={gradientStopColor} />
          <stop offset="100%" stopColor={gradientStopColor} stopOpacity="0" />
        </motion.linearGradient>
      </defs>
    </svg>
  );
}
