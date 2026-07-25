"use client";

// Aceternity UI — Tracing Beam (scroll-linked beam down the left edge)
import { type ReactNode, useEffect, useRef, useState } from "react";
import { motion, useScroll, useSpring, useTransform, useMotionValueEvent } from "motion/react";
import { cn } from "../cn";

export function TracingBeam({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  const [svgHeight, setSvgHeight] = useState(0);
  useEffect(() => {
    const measure = () => {
      if (contentRef.current) setSvgHeight(contentRef.current.offsetHeight);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const y1 = useSpring(useTransform(scrollYProgress, [0, 0.8], [50, svgHeight]), {
    stiffness: 500,
    damping: 90,
  });
  const y2 = useSpring(useTransform(scrollYProgress, [0, 1], [50, svgHeight - 200]), {
    stiffness: 500,
    damping: 90,
  });

  const [dotGlow, setDotGlow] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setDotGlow(v));

  return (
    <motion.div ref={ref} className={cn("relative w-full", className)}>
      <div className="absolute left-2 top-3 z-20 hidden md:left-5 md:block">
        <motion.div
          className="ml-[27px] flex h-4 w-4 items-center justify-center rounded-full border"
          style={{ borderColor: "var(--line-2)" }}
        >
          <motion.div
            className="h-2 w-2 rounded-full"
            style={{
              background: dotGlow > 0 ? "var(--amber)" : "transparent",
              border: "1px solid var(--amber)",
              boxShadow: dotGlow > 0 ? "0 0 12px var(--amber)" : "none",
            }}
          />
        </motion.div>
        <svg
          viewBox={`0 0 20 ${svgHeight}`}
          width="20"
          height={svgHeight}
          className="ml-4 block"
          aria-hidden="true"
        >
          <path
            d={`M 1 0 V ${svgHeight}`}
            fill="none"
            stroke="rgba(236,237,244,0.08)"
            strokeWidth="1.5"
          />
          <motion.path
            d={`M 1 0 V ${svgHeight}`}
            fill="none"
            stroke="url(#tb-grad)"
            strokeWidth="1.5"
            className="motion-reduce:hidden"
          />
          <defs>
            <motion.linearGradient
              id="tb-grad"
              gradientUnits="userSpaceOnUse"
              x1="0"
              x2="0"
              y1={y1}
              y2={y2}
            >
              <stop stopColor="#ffb454" stopOpacity="0" />
              <stop stopColor="#ffb454" />
              <stop offset="0.5" stopColor="#ff8a3d" />
              <stop offset="1" stopColor="#5aa9ff" stopOpacity="0" />
            </motion.linearGradient>
          </defs>
        </svg>
      </div>
      <div ref={contentRef}>{children}</div>
    </motion.div>
  );
}
