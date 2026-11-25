// FILE: motion.ts
// Purpose: Animation loop, spring physics and reduced-motion helpers for the effort slider.

import * as React from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_MOTION_QUERY).matches
    : false;
}

export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const query = window.matchMedia(REDUCED_MOTION_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    prefersReducedMotion,
    () => false,
  );
}

/** A ref whose value is created once, on first read. */
export function useLazyRef<T>(create: () => T): React.RefObject<T> {
  const ref = React.useRef<T | null>(null);
  if (ref.current === null) ref.current = create();
  return ref as React.RefObject<T>;
}

// Slightly under-damped: a small, quick overshoot when the thumb snaps to a stop.
const STIFFNESS = 420;
const DAMPING = 28;

/** Advances a spring toward `target` by `delta` seconds (semi-implicit Euler, sub-stepped). */
export function springStep(
  state: { position: number; velocity: number },
  target: number,
  delta: number,
): void {
  const steps = Math.max(1, Math.ceil(delta / (1 / 240)));
  const dt = delta / steps;
  for (let i = 0; i < steps; i++) {
    const force = -STIFFNESS * (state.position - target) - DAMPING * state.velocity;
    state.velocity += force * dt;
    state.position += state.velocity * dt;
  }
}

/**
 * Runs `step(timeSeconds, deltaSeconds)` on animation frames while it returns true. `kick()` starts
 * it again after it settled. The latest `step` is always used, so it may close over render state.
 */
export function useAnimationLoop(
  elementRef: React.RefObject<Element | null>,
  step: (time: number, delta: number) => boolean,
): { kick: () => void } {
  const stepRef = React.useRef(step);
  stepRef.current = step;
  const frame = React.useRef<number | null>(null);
  const last = React.useRef<number | null>(null);

  const kick = React.useCallback(() => {
    if (frame.current !== null || typeof window === "undefined") return;
    const tick = (now: number) => {
      frame.current = null;
      const previous = last.current ?? now;
      last.current = now;
      // A long gap (hidden tab, first frame) must not fling the spring.
      const delta = Math.min(1 / 30, Math.max(0, (now - previous) / 1000));
      const element = elementRef.current;
      if (element && !element.isConnected) {
        last.current = null;
        return;
      }
      if (stepRef.current(now / 1000, delta)) frame.current = window.requestAnimationFrame(tick);
      else last.current = null;
    };
    frame.current = window.requestAnimationFrame(tick);
  }, [elementRef]);

  React.useEffect(() => {
    kick();
    return () => {
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
      last.current = null;
    };
  }, [kick]);

  return React.useMemo(() => ({ kick }), [kick]);
}
