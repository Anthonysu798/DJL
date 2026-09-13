/**
 * Single-series daily bars: thin marks, 2px gaps, one sequential hue, values
 * in text tokens, hover tooltip on every bar, and the same rows as a table for
 * accessibility. No legend: the title names the one series.
 */
export function DailyBars({
  title,
  rows,
  format,
}: {
  title: string;
  rows: readonly { day: string; value: number }[];
  format?: (v: number) => string;
}) {
  const fmt = format ?? ((v: number) => v.toLocaleString());
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className="card">
      <figcaption className="mb-3 text-sm font-medium">{title}</figcaption>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">No data in this range.</p>
      ) : (
        <>
          <div className="flex h-32 items-end gap-[2px]" role="img" aria-label={`${title} by day`}>
            {rows.map((r) => (
              <div
                key={r.day}
                className="group relative flex-1"
                title={`${r.day}: ${fmt(r.value)}`}
              >
                <div
                  className="w-full rounded-t-[4px] bg-sky-600 group-hover:bg-sky-700 dark:bg-sky-400 dark:group-hover:bg-sky-300"
                  style={{ height: `${Math.max(2, (r.value / max) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-neutral-500">
            <span>{rows[0]?.day}</span>
            <span>{rows.at(-1)?.day}</span>
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-neutral-500">Table view</summary>
            <table className="table mt-2">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>{title}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.day}>
                    <td>{r.day}</td>
                    <td>{fmt(r.value)}</td>
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

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <div className="text-xs font-medium text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs text-neutral-500">{hint}</div> : null}
    </div>
  );
}
