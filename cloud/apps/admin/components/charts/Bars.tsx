"use client";
import { useState } from "react";

/**
 * Single-series bars: one hue, rounded tops, 2px gaps, hover tooltip, table
 * view. The title names the series, so no legend.
 */
export function Bars({
  title,
  rows,
  format,
  controls,
}: {
  title: string;
  rows: readonly { day: string; value: number }[];
  format?: ((v: number) => string) | undefined;
  controls?: React.ReactNode | undefined;
}) {
  const fmt = format ?? ((v: number) => v.toLocaleString());
  const max = Math.max(1, ...rows.map((r) => r.value));
  const [hover, setHover] = useState<number | null>(null);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <figure className="panel p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <figcaption className="flex items-center gap-3 text-lg font-medium">
          <span className="size-2.5 rounded-full bg-primary ring-4 ring-primary/15" />
          {title}
        </figcaption>
        {controls}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data in this range.</p>
      ) : (
        <>
          <div className="relative h-56 pl-10">
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute right-0 left-10 border-t border-dashed border-border"
                style={{ bottom: `${t * 100}%` }}
              >
                <span className="absolute -top-2 -left-10 w-8 text-right text-[11px] text-muted-foreground">
                  {fmt(Math.round(max * t))}
                </span>
              </div>
            ))}
            <div
              className={`relative flex h-full items-end ${rows.length > 40 ? "gap-px" : rows.length > 12 ? "gap-[3px]" : "gap-2"}`}
              role="img"
              aria-label={`${title} by day`}
            >
              {rows.map((r, i) => (
                <div
                  key={r.day}
                  className="relative flex h-full flex-1 items-end"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <div
                    className={`w-full bg-primary transition-opacity ${rows.length > 40 ? "rounded-t-[2px]" : "rounded-t-md"}`}
                    style={{
                      height: `${Math.max(1.5, (r.value / max) * 100)}%`,
                      opacity: hover === null || hover === i ? 1 : 0.45,
                    }}
                  />
                  {hover === i ? (
                    <div
                      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded-lg border bg-popover px-3 py-2 text-xs whitespace-nowrap shadow-md"
                      role="tooltip"
                    >
                      <div className="text-muted-foreground">{r.day}</div>
                      <div className="mt-0.5 text-sm font-medium tabular-nums">{fmt(r.value)}</div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 flex justify-between pl-10 text-[11px] text-muted-foreground">
            {rows
              .filter(
                (_r, i) =>
                  i === 0 ||
                  i === rows.length - 1 ||
                  rows.length <= 8 ||
                  i % Math.ceil(rows.length / 6) === 0,
              )
              .map((r) => (
                <span key={r.day}>{r.day.slice(5)}</span>
              ))}
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">Table view</summary>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1">Day</th>
                  <th className="py-1">{title}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.day}>
                    <td className="py-1">{r.day}</td>
                    <td className="py-1 tabular-nums">{fmt(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </figure>
  );
}
