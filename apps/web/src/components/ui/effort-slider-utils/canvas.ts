// FILE: canvas.ts
// Purpose: Keeps a canvas sized to its box at the device pixel ratio and hands out its 2D context.

import * as React from "react";

export interface CanvasSurface {
  readonly context: CanvasRenderingContext2D;
  /** Size in CSS pixels; the context is already scaled for the device pixel ratio. */
  readonly width: number;
  readonly height: number;
}

/** Tracks the canvas's box; calls `onResize` after every resize with the fresh surface. */
export function useCanvas(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  onResize: (surface: CanvasSurface) => void,
): React.RefObject<CanvasSurface | null> {
  const surface = React.useRef<CanvasSurface | null>(null);
  const onResizeRef = React.useRef(onResize);
  onResizeRef.current = onResize;

  React.useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      surface.current = { context, width, height };
      onResizeRef.current(surface.current);
    };

    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef]);

  return surface;
}
