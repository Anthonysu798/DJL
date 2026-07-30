"use client";

// Aceternity UI — Timeline (sticky entry headings + scroll-driven progress beam)
// Adapted: upstream hardcodes its own <h2>/<p> header ("Changelog from my journey") inside the
// component. That is stripped — the page renders its own header, and two competing headers would
// fight for the same role. Entry titles are also a ReactNode so a release can carry a badge.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { cn } from "../cn";

export interface TimelineEntry {
  /** Stable key — upstream keys on the array index, which reorders badly when entries prepend. */
  id: string;
  title: ReactNode;
  content: ReactNode;
}

export function Timeline({
  data,
  className,
}: {
  data: readonly TimelineEntry[];
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  // The beam is drawn to the measured height of the entry list, so it has to be measured after
  // layout. A ResizeObserver keeps it correct when a release entry wraps at a new viewport width —
  // upstream measures once and leaves the beam short after any reflow.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => setHeight(element.getBoundingClientRect().height);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 10%", "end 50%"],
  });

  const heightTransform = useTransform(scrollYProgress, [0, 1], [0, height]);
  const opacityTransform = useTransform(scrollYProgress, [0, 0.1], [0, 1]);

  return (
    <div className={cn("w-full md:px-10", className)} ref={containerRef}>
      <div ref={ref} className="relative mx-auto max-w-5xl pb-20">
        {data.map((item) => (
          <div
            key={item.id}
            className="relative flex flex-col justify-start pt-10 md:flex-row md:gap-10 md:pt-32"
          >
            {/* Upstream renders `title` twice — once for desktop, once for mobile — and hides one
                with a breakpoint class. That duplicates every heading in the DOM. Rendering it once
                and letting flex-direction place it keeps one node per release. */}
            <div className="sticky top-24 z-40 self-start pl-20 md:top-32 md:w-full md:max-w-xs md:pl-20 lg:max-w-sm">
              <div className="absolute top-0 left-3 flex h-10 w-10 items-center justify-center rounded-full bg-white dark:bg-neutral-950">
                <div className="h-4 w-4 rounded-full border border-neutral-300 bg-neutral-200 p-2 dark:border-neutral-700 dark:bg-neutral-800" />
              </div>
              {item.title}
            </div>

            <div className="relative w-full pr-4 pl-20 md:pl-4">{item.content}</div>
          </div>
        ))}

        <div
          style={{ height: `${height}px` }}
          aria-hidden="true"
          className="absolute top-0 left-8 w-[2px] overflow-hidden bg-[linear-gradient(to_bottom,var(--tw-gradient-stops))] from-transparent from-[0%] via-neutral-200 to-transparent to-[99%] [mask-image:linear-gradient(to_bottom,transparent_0%,black_10%,black_90%,transparent_100%)] dark:via-neutral-700"
        >
          <motion.div
            style={{ height: heightTransform, opacity: opacityTransform }}
            className="absolute inset-x-0 top-0 w-[2px] rounded-full bg-gradient-to-t from-cyan-400 from-[0%] via-blue-500 via-[10%] to-transparent"
          />
        </div>
      </div>
    </div>
  );
}
