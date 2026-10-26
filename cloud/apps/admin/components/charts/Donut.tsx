"use client";
import { useI18n } from "../LocaleProvider";

/**
 * Composition donut with a hero number in the hole, a legend (identity never
 * by color alone), 2px surface gaps between segments, and a table view.
 * Each plan gets its own categorical hue; labels retain its identity in both themes.
 */
const HUES = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
] as const;

export function Donut({
  title,
  total,
  totalLabel,
  slices,
  action,
}: {
  title: string;
  total: number;
  totalLabel: string;
  slices: readonly { label: string; value: number }[];
  action?: React.ReactNode;
}) {
  const { number } = useI18n();
  const sum = Math.max(
    1,
    slices.reduce((a, s) => a + s.value, 0),
  );
  const r = 44;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <figure className="panel p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <figcaption className="flex items-center gap-3 text-lg font-medium">{title}</figcaption>
        {action}
      </div>
      <div className="flex flex-wrap items-center gap-8">
        <svg
          viewBox="0 0 120 120"
          className="size-44"
          role="img"
          aria-label={`${title}: ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`}
        >
          <circle
            cx="60"
            cy="60"
            r={r}
            fill="none"
            stroke="var(--color-secondary)"
            strokeWidth="12"
          />
          {slices.map((s, i) => {
            const len = (s.value / sum) * c;
            const el = (
              <circle
                key={s.label}
                cx="60"
                cy="60"
                r={r}
                fill="none"
                stroke={HUES[i % HUES.length]}
                strokeWidth="12"
                strokeDasharray={`${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                transform="rotate(-90 60 60)"
              />
            );
            offset += len;
            return el;
          })}
          <text
            x="60"
            y="58"
            textAnchor="middle"
            className="fill-foreground text-[15px] font-semibold"
          >
            {number(total)}
          </text>
          <text x="60" y="72" textAnchor="middle" className="fill-muted-foreground text-[7px]">
            {totalLabel}
          </text>
        </svg>
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-4 text-sm">
          {slices.map((s, i) => (
            <div key={s.label}>
              <dt className="flex items-center gap-2 text-muted-foreground">
                <span
                  className="size-2.5 rounded-sm"
                  style={{ background: HUES[i % HUES.length] }}
                />
                {s.label}
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{number(s.value)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </figure>
  );
}
