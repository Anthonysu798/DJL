"use client";
import { useState } from "react";

import { DailyBars, Stat } from "@/components/DailyBars";
import { Shell } from "@/components/Shell";
import { admin, credits, usd } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Stats {
  range: string;
  totals: { users: number; orgs: number; paid: number };
  signups: { day: string; n: number }[];
  usage: { day: string; requests: number; settled: string; active: number }[];
  revenue: { day: string; cents: number }[];
  byCountry: { country: string; signups: number }[];
  byModel: { model_id: string; requests: number; settled: string }[];
}
interface Status {
  version: string;
  inFlight: number;
  breakers: Record<string, string>;
  openReservations: number;
}

const sum = (rows: { [k: string]: unknown }[], key: string) =>
  rows.reduce((a, r) => a + Number(r[key] ?? 0), 0);

export default function Overview() {
  const [range, setRange] = useState<"day" | "week" | "month" | "year">("week");
  const stats = useLoad(() => admin<Stats>(`/stats?range=${range}`), [range]);
  const status = useLoad(() => admin<Status>("/status"), []);
  const s = stats.data;
  return (
    <Shell>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">Overview</h1>
        <div className="ml-auto flex gap-1">
          {(["day", "week", "month", "year"] as const).map((r) => (
            <button
              key={r}
              className={r === range ? "btn" : "btn-secondary"}
              type="button"
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {stats.error ? (
        <p role="alert" className="text-sm text-red-600">
          {stats.error}
        </p>
      ) : null}
      {s ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Users (all time)"
              value={s.totals.users.toLocaleString()}
              hint={`${s.totals.orgs.toLocaleString()} organizations`}
            />
            <Stat label="Paid organizations" value={s.totals.paid.toLocaleString()} />
            <Stat label={`Signups (${range})`} value={sum(s.signups, "n").toLocaleString()} />
            <Stat
              label={`Revenue (${range})`}
              value={usd(sum(s.revenue, "cents"))}
              hint={`${credits(String(sum(s.usage, "settled")))} credits settled`}
            />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <DailyBars title="Signups" rows={s.signups.map((r) => ({ day: r.day, value: r.n }))} />
            <DailyBars
              title="Gateway requests"
              rows={s.usage.map((r) => ({ day: r.day, value: r.requests }))}
            />
            <DailyBars
              title="Active users"
              rows={s.usage.map((r) => ({ day: r.day, value: r.active }))}
            />
            <DailyBars
              title="Revenue (USD)"
              rows={s.revenue.map((r) => ({ day: r.day, value: r.cents / 100 }))}
              format={(v) => `$${v.toFixed(2)}`}
            />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="card">
              <h2 className="mb-2 text-sm font-medium">Top models</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Requests</th>
                    <th>Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {s.byModel.map((m) => (
                    <tr key={m.model_id}>
                      <td>{m.model_id}</td>
                      <td>{m.requests}</td>
                      <td>{credits(m.settled)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h2 className="mb-2 text-sm font-medium">Signups by country</h2>
              {s.byCountry.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  Country rollups appear after the nightly stats job runs.
                </p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Country</th>
                      <th>Signups</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.byCountry.map((c) => (
                      <tr key={c.country}>
                        <td>{c.country}</td>
                        <td>{c.signups}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="card">
              <h2 className="mb-2 text-sm font-medium">Servers</h2>
              {status.data ? (
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-neutral-500">Version</dt>
                    <dd>{status.data.version}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-neutral-500">In-flight streams</dt>
                    <dd>{status.data.inFlight}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-neutral-500">Open reservations</dt>
                    <dd>{status.data.openReservations}</dd>
                  </div>
                  {Object.entries(status.data.breakers).map(([p, st]) => (
                    <div key={p} className="flex justify-between">
                      <dt className="text-neutral-500">{p} breaker</dt>
                      <dd>{st}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-neutral-500">{status.error ?? "Loading…"}</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-neutral-500">Loading…</p>
      )}
    </Shell>
  );
}
