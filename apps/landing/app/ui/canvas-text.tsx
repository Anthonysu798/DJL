"use client";

// Aceternity UI — Canvas Text (text knocked out of animated bezier lines)
// Adapted in three ways:
//  1. The default palette was a six-colour rainbow. Replaced with the DJL signal hues, since a
//     rainbow is precisely the generic look this redesign exists to remove.
//  2. The default `colors` array was declared inline, so it had a new identity on every render and
//     retriggered the colour effect and its MutationObserver each time. It is a module const now.
//  3. The requestAnimationFrame loop ran forever regardless of preference; it now paints one static
//     frame when the visitor asked for reduced motion.
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../cn";

// Amber is the local/private signal and azure the online one, the same encoding the rest of the
// site uses; cyan ties the lamp header to this closing moment.
const DEFAULT_COLORS = ["#1f6feb", "#22d3ee", "#b45309", "#5aa9ff"] as const;

function resolveColor(color: string): string {
  if (!color.startsWith("var(")) return color;
  const name = color.slice(4, -1).trim();
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return resolved || color;
}

export function CanvasText({
  text,
  className = "",
  backgroundClassName = "bg-white dark:bg-neutral-950",
  colors = DEFAULT_COLORS,
  animationDuration = 5,
  lineWidth = 1.5,
  lineGap = 10,
  curveIntensity = 60,
}: {
  text: string;
  className?: string;
  backgroundClassName?: string;
  colors?: readonly string[];
  animationDuration?: number;
  lineWidth?: number;
  lineGap?: number;
  curveIntensity?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const bgRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef<number>(0);
  const [bgColor, setBgColor] = useState("#0a0a0a");
  const [resolvedColors, setResolvedColors] = useState<readonly string[]>([]);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [font, setFont] = useState("");

  // Joined rather than passed by reference: a caller's inline array would otherwise invalidate this
  // callback on every render, which is the bug fixed in note 2 above.
  const colorKey = colors.join(",");

  const updateColors = useCallback(() => {
    if (bgRef.current) {
      setBgColor(window.getComputedStyle(bgRef.current).backgroundColor);
    }
    setResolvedColors(colorKey.split(",").map(resolveColor));
  }, [colorKey]);

  useEffect(() => {
    updateColors();
    const observer = new MutationObserver(updateColors);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => observer.disconnect();
  }, [updateColors]);

  // The measuring span carries the real type styles, so the canvas inherits the page font instead
  // of hardcoding one.
  useEffect(() => {
    const element = textRef.current;
    if (!element) return;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      const computed = window.getComputedStyle(element);
      setDimensions({
        width: Math.ceil(rect.width) || 400,
        height: Math.ceil(rect.height) || 200,
      });
      setFont(`${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, className]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || resolvedColors.length === 0 || dimensions.width === 0 || !font) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const { width, height } = dimensions;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    ctx.font = font;
    const metrics = ctx.measureText(text);
    const baselineY =
      (height + metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
    const lineCount = Math.floor(height / lineGap) + 10;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();

    const paint = (now: number) => {
      const elapsed = (now - start) / 1000;
      const phase = reduceMotion ? 0 : (elapsed / animationDuration) * Math.PI * 2;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Draw the glyphs, keep only their pixels, then stroke lines inside that silhouette.
      ctx.globalCompositeOperation = "source-over";
      ctx.font = font;
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      ctx.fillStyle = "#000";
      ctx.fillText(text, 0, baselineY);

      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);

      ctx.globalCompositeOperation = "source-atop";
      for (let i = 0; i < lineCount; i += 1) {
        const y = i * lineGap;
        const curve1 = Math.sin(phase) * curveIntensity;
        const curve2 = Math.sin(phase + 0.5) * curveIntensity * 0.6;

        ctx.strokeStyle = resolvedColors[i % resolvedColors.length] ?? "#1f6feb";
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(width * 0.33, y + curve1, width * 0.66, y + curve2, width, y);
        ctx.stroke();
      }

      if (!reduceMotion) {
        frameRef.current = requestAnimationFrame(paint);
      }
    };

    frameRef.current = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frameRef.current);
  }, [
    text,
    font,
    bgColor,
    resolvedColors,
    animationDuration,
    lineWidth,
    lineGap,
    curveIntensity,
    dimensions,
  ]);

  return (
    <span className={cn("relative inline-block", className)}>
      <span
        ref={bgRef}
        className={cn("pointer-events-none absolute h-0 w-0 opacity-0", backgroundClassName)}
        aria-hidden="true"
      />
      <span ref={textRef} className="invisible inline-block" aria-hidden="true">
        {text}
      </span>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute top-0 left-0"
        style={{ width: dimensions.width || "auto", height: dimensions.height || "auto" }}
        role="img"
        aria-label={text}
      />
    </span>
  );
}
