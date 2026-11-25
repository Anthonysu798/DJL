// FILE: color.ts
// Purpose: Reads theme colours (CSS custom properties) as RGB for canvas drawing, following
//          light/dark switches.

import * as React from "react";

import type { RGB } from "./math";

/** A CSS custom property and the colour to use when it is not set. */
export type ColorToken = readonly [variable: string, fallback: string];
export type Palette<K extends string> = Record<K, RGB>;

let probe: CanvasRenderingContext2D | null = null;

/**
 * Resolves any CSS colour (hex, rgb, oklch, color-mix…) to RGB by painting one pixel. A
 * see-through colour is painted over `backdrop`, so it reads as it looks on that surface.
 */
function toRgb(color: string, fallback: string, backdrop?: RGB): RGB {
  if (typeof document === "undefined") return [0, 0, 0];
  probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return [0, 0, 0];
  probe.clearRect(0, 0, 1, 1);
  if (backdrop) {
    probe.fillStyle = `rgb(${backdrop[0]},${backdrop[1]},${backdrop[2]})`;
    probe.fillRect(0, 0, 1, 1);
  }
  probe.fillStyle = fallback;
  probe.fillStyle = color.trim() || fallback;
  probe.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0] = probe.getImageData(0, 0, 1, 1).data;
  return [red, green, blue];
}

function readPalette<K extends string>(
  element: Element,
  tokens: Record<K, ColorToken>,
): Palette<K> {
  const style = getComputedStyle(element);
  // Colours sit on the card; translucent theme colours are read as they appear on it.
  const card = toRgb(style.getPropertyValue("--card"), "#ffffff");
  const palette = {} as Record<K, RGB>;
  for (const key of Object.keys(tokens) as K[]) {
    const [variable, fallback] = tokens[key];
    palette[key] = toRgb(style.getPropertyValue(variable), fallback, card);
  }
  return palette;
}

/** Keeps the palette current; calls `onChange` when the theme changes it. */
export function usePalette<K extends string>(
  elementRef: React.RefObject<Element | null>,
  tokens: Record<K, ColorToken>,
  onChange: () => void,
): React.RefObject<Palette<K> | null> {
  const palette = React.useRef<Palette<K> | null>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  React.useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const update = () => {
      palette.current = readPalette(element, tokens);
      onChangeRef.current();
    };
    update();
    // Themes switch by class or data attributes on <html>, or by the OS colour scheme.
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    scheme?.addEventListener("change", update);
    return () => {
      observer.disconnect();
      scheme?.removeEventListener("change", update);
    };
  }, [elementRef, tokens]);

  return palette;
}
