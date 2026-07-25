"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";

/* ───────────────────────── reduced motion ───────────────────────── */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/* ───────────────────────── reveal on scroll ───────────────────────── */
export function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  className = "",
  id,
}: {
  children: ReactNode;
  delay?: number;
  as?: "div" | "section" | "li" | "header" | "footer";
  className?: string;
  id?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.16, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const Comp = Tag as "div";
  return (
    <Comp
      id={id}
      ref={ref as React.Ref<HTMLDivElement>}
      className={`reveal ${className}`}
      style={{ ["--d" as string]: `${delay}ms` }}
    >
      {children}
    </Comp>
  );
}

/* ───────────────────────── magnetic ───────────────────────── */
export function Magnetic({
  children,
  strength = 0.4,
  className = "",
  href,
  onClick,
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
  href?: string;
  onClick?: () => void;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || window.matchMedia("(pointer: coarse)").matches) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) * strength;
      const y = (e.clientY - (r.top + r.height / 2)) * strength;
      el.style.transform = `translate(${x}px, ${y}px)`;
    };
    const leave = () => {
      el.style.transform = "translate(0,0)";
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [strength, reduced]);

  return (
    <a ref={ref} href={href} onClick={onClick} className={className}>
      {children}
    </a>
  );
}

/* ───────────────────────── signal field (canvas) ─────────────────────────
   A sparse drifting point lattice. Points link to nearby neighbours and to
   the cursor, drawn in the local-amber signal colour at low alpha. The whole
   field reads as the agent's ambient "thinking" without competing with type. */
export function SignalField() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    const pointer = { x: -9999, y: -9999 };

    type P = { x: number; y: number; vx: number; vy: number };
    let pts: P[] = [];

    const seed = () => {
      const target = Math.min(72, Math.floor((w * h) / 22000));
      pts = Array.from({ length: target }, (_, i) => ({
        // deterministic-ish spread; index-derived so no Math.random dependency at SSR
        x: (((i * 97) % 100) / 100) * w,
        y: (((i * 53) % 100) / 100) * h,
        vx: (((i * 31) % 20) - 10) / 90,
        vy: (((i * 17) % 20) - 10) / 90,
      }));
    };

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const draw = (animate: boolean) => {
      ctx.clearRect(0, 0, w, h);
      const linkDist = Math.min(150, w / 7);

      for (const p of pts) {
        if (animate) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;
        }
      }

      // links
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < linkDist) {
            const al = (1 - d / linkDist) * 0.14;
            ctx.strokeStyle = `rgba(255, 180, 84, ${al})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        // cursor link
        const cdx = a.x - pointer.x;
        const cdy = a.y - pointer.y;
        const cd = Math.hypot(cdx, cdy);
        if (cd < 200) {
          const al = (1 - cd / 200) * 0.4;
          ctx.strokeStyle = `rgba(255, 180, 84, ${al})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(pointer.x, pointer.y);
          ctx.stroke();
        }
        // node
        ctx.fillStyle = `rgba(255, 196, 120, ${cd < 200 ? 0.7 : 0.34})`;
        ctx.beginPath();
        ctx.arc(a.x, a.y, cd < 200 ? 1.9 : 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = () => {
      draw(true);
      raf = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
    };
    const onLeave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else if (!reduced) {
        raf = requestAnimationFrame(loop);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);

    if (reduced) {
      draw(false);
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced]);

  return <canvas ref={ref} className="signal" aria-hidden="true" />;
}

/* ───────────────────────── pointer depth scene ─────────────────────────
   The hero reads as the agent's field of vision. A single pointer listener
   normalises the cursor to [-0.5, 0.5] of the viewport and springs it, so
   nested DepthLayers can drift by depth × pointer — near layers move more
   than far ones, producing real parallax that *responds to the operator*.
   Disabled on coarse pointers and under prefers-reduced-motion. */
type PointerValue = { px: MotionValue<number>; py: MotionValue<number> };
const PointerCtx = createContext<PointerValue | null>(null);

export function PointerScene({
  children,
  className,
  style,
  id,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  id?: string;
}) {
  const reduced = useReducedMotion();
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const px = useSpring(rawX, { stiffness: 70, damping: 18, mass: 0.7 });
  const py = useSpring(rawY, { stiffness: 70, damping: 18, mass: 0.7 });

  useEffect(() => {
    if (reduced) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    const onMove = (e: PointerEvent) => {
      rawX.set(e.clientX / window.innerWidth - 0.5);
      rawY.set(e.clientY / window.innerHeight - 0.5);
    };
    const onLeave = () => {
      rawX.set(0);
      rawY.set(0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerout", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onLeave);
    };
  }, [reduced, rawX, rawY]);

  const value = useMemo<PointerValue>(() => ({ px, py }), [px, py]);

  return (
    <PointerCtx.Provider value={value}>
      <div id={id} className={className} style={style}>
        {children}
      </div>
    </PointerCtx.Provider>
  );
}

/* A layer that drifts with the pointer. `depth` is the px travel at the edge
   of the viewport — far strata get ~8, the nearest UI ~46. Optional `tilt`
   adds a subtle 3D rotation toward the cursor (hologram feel). */
export function DepthLayer({
  depth = 20,
  tilt = 0,
  children,
  className,
  style,
}: {
  depth?: number;
  tilt?: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ctx = useContext(PointerCtx);
  const fallback = useMotionValue(0);
  const sx = ctx?.px ?? fallback;
  const sy = ctx?.py ?? fallback;

  const x = useTransform(sx, (v) => v * depth);
  const y = useTransform(sy, (v) => v * depth);
  const rotY = useTransform(sx, (v) => v * tilt);
  const rotX = useTransform(sy, (v) => v * -tilt);
  const transform = useMotionTemplate`perspective(1100px) translate3d(${x}px, ${y}px, 0) rotateX(${rotX}deg) rotateY(${rotY}deg)`;

  return (
    <motion.div className={className} style={{ ...style, transform, willChange: "transform" }}>
      {children}
    </motion.div>
  );
}

/* ───────────────────────── scroll parallax ─────────────────────────
   Vertical drift driven by the element's transit through the viewport.
   Positive `speed` reads as foreground (moves up faster than the scroll);
   negative reads as background (lags behind). Subtle by design. */
export function Parallax({
  speed = 40,
  children,
  className,
  style,
  as = "div",
}: {
  speed?: number;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "section";
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const ty = useTransform(scrollYProgress, [0, 1], [speed, -speed]);
  const transform = useMotionTemplate`translate3d(0, ${ty}px, 0)`;

  if (reduced) {
    const Plain = as;
    return (
      <Plain ref={ref as never} className={className} style={style}>
        {children}
      </Plain>
    );
  }

  const Comp = as === "section" ? motion.section : motion.div;
  return (
    <Comp
      ref={ref as never}
      className={className}
      style={{ ...style, transform, willChange: "transform" }}
    >
      {children}
    </Comp>
  );
}

/* Scroll progress for the descent / depth gauge. Returns 0..1 spring. */
export function useDescent() {
  const { scrollYProgress } = useScroll();
  return useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
}
