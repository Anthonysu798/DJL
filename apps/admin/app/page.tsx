"use client";
import Link from "next/link";
import { useState } from "react";

import { Donut } from "@/components/charts/Donut";
import { GlassBars } from "@/components/charts/GlassBars";
import { StatTile } from "@/components/charts/StatTile";
import { Shell } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { admin, credits, usd } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Stats {
  range: string;
  totals: { users: number; orgs: number; paid: number };
  previous: { signups: number; requests: number; active: number; cents: number };
  byPlan: { planId: string; orgs: number }[];
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
interface UserRow {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  banned: boolean;
  createdAt: string;
}

type Range = "day" | "week" | "month" | "year";
type Metric = "requests" | "signups" | "active" | "revenue";
const RANGE_LABEL: Record<Range, string> = {
  day: "Today",
  week: "Last 7 days",
  month: "Last 30 days",
  year: "Last 12 months",
};
const PLAN_LABEL: Record<string, string> = {
  trial: "Trial",
  starter: "Starter",
  business: "Business",
  autopilot: "Autopilot",
};
const sum = (rows: readonly Record<string, unknown>[], key: string) =>
  rows.reduce((a, r) => a + Number(r[key] ?? 0), 0);

/** Every day of the range, zero-filled, so the bars keep their width when data is sparse. */
function fillDays(
  range: Range,
  rows: readonly { day: string; value: number }[],
): { day: string; value: number }[] {
  const days = range === "day" ? 1 : range === "week" ? 7 : range === "month" ? 30 : 365;
  const byDay = new Map(rows.map((r) => [r.day, r.value]));
  const out: { day: string; value: number }[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i),
    );
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, value: byDay.get(key) ?? 0 });
  }
  return out;
}

export default function Overview() {
  const [range, setRange] = useState<Range>("week");
  const [metric, setMetric] = useState<Metric>("requests");
  const stats = useLoad(() => admin<Stats>(`/stats?range=${range}`), [range]);
  const status = useLoad(() => admin<Status>("/status"), []);
  const recent = useLoad(() => admin<{ users: UserRow[] }>("/users?limit=8"), []);
  const s = stats.data;
  const series: Record<
    Metric,
    { title: string; rows: { day: string; value: number }[]; format?: (v: number) => string }
  > = s
    ? {
        requests: {
          title: "Gateway requests",
          rows: fillDays(
            range,
            s.usage.map((r) => ({ day: r.day, value: r.requests })),
          ),
        },
        signups: {
          title: "Signups",
          rows: fillDays(
            range,
            s.signups.map((r) => ({ day: r.day, value: r.n })),
          ),
        },
        active: {
          title: "Active users",
          rows: fillDays(
            range,
            s.usage.map((r) => ({ day: r.day, value: r.active })),
          ),
        },
        revenue: {
          title: "Revenue",
          rows: fillDays(
            range,
            s.revenue.map((r) => ({ day: r.day, value: r.cents / 100 })),
          ),
          format: (v) => `$${v.toFixed(2)}`,
        },
      }
    : {
        requests: { title: "", rows: [] },
        signups: { title: "", rows: [] },
        active: { title: "", rows: [] },
        revenue: { title: "", rows: [] },
      };

  const rangeSelect = (
    <Select value={range} onValueChange={(v) => setRange(v as Range)}>
      <SelectTrigger className="pill h-10 w-44 px-4" aria-label="Range">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="glass-strong">
        {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
          <SelectItem key={r} value={r}>
            {RANGE_LABEL[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Shell
      title="Dashboard"
      subtitle="Signups, usage, revenue, and the state of the platform."
      actions={rangeSelect}
    >
      {stats.error ? (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {stats.error}
        </p>
      ) : null}
      {s ? (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Total users"
              value={s.totals.users.toLocaleString()}
              hint={`${s.totals.orgs.toLocaleString()} organizations · ${s.totals.paid.toLocaleString()} paying`}
              menu={[{ label: "Open users", onSelect: () => (window.location.href = "/users") }]}
            />
            <StatTile
              label={`Signups · ${RANGE_LABEL[range]}`}
              value={sum(s.signups, "n").toLocaleString()}
              current={sum(s.signups, "n")}
              previous={s.previous.signups}
            />
            <StatTile
              label={`Gateway requests · ${RANGE_LABEL[range]}`}
              value={sum(s.usage, "requests").toLocaleString()}
              current={sum(s.usage, "requests")}
              previous={s.previous.requests}
              hint={`${credits(String(sum(s.usage, "settled")))} credits settled`}
            />
            <StatTile
              label={`Revenue · ${RANGE_LABEL[range]}`}
              value={usd(sum(s.revenue, "cents"))}
              current={sum(s.revenue, "cents")}
              previous={s.previous.cents}
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
            <GlassBars
              title={series[metric].title}
              rows={series[metric].rows}
              format={series[metric].format}
              controls={
                <Select value={metric} onValueChange={(v) => setMetric(v as Metric)}>
                  <SelectTrigger className="pill h-9 w-44" aria-label="Metric">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-strong">
                    <SelectItem value="requests">Gateway requests</SelectItem>
                    <SelectItem value="signups">Signups</SelectItem>
                    <SelectItem value="active">Active users</SelectItem>
                    <SelectItem value="revenue">Revenue</SelectItem>
                  </SelectContent>
                </Select>
              }
            />
            <Donut
              title="Organizations by plan"
              total={s.totals.orgs}
              totalLabel="organizations"
              slices={["trial", "starter", "business", "autopilot"].map((id) => ({
                label: PLAN_LABEL[id] ?? id,
                value: s.byPlan.find((p) => p.planId === id)?.orgs ?? 0,
              }))}
              action={
                <Link
                  href="/plans"
                  className="pill px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  View plans
                </Link>
              }
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
            <div className="glass p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-medium">Recent users</h2>
                <Link
                  href="/users"
                  className="pill px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  All users
                </Link>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="border-white/[0.06] hover:bg-transparent">
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.data?.users.map((u) => (
                    <TableRow key={u.id} className="border-white/[0.06]">
                      <TableCell>
                        <Link href={`/users/${u.id}`} className="flex items-center gap-3">
                          <span className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-primary/80 to-fuchsia-500/80 text-xs font-semibold text-white">
                            {u.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="font-medium">{u.name}</span>
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{u.email}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span
                            className={`size-2 rounded-full ${u.banned ? "bg-chart-5" : u.emailVerified ? "bg-primary" : "bg-chart-2"}`}
                          />
                          {u.banned ? "Suspended" : u.emailVerified ? "Active" : "Unverified"}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="space-y-4">
              <div className="glass p-5">
                <h2 className="mb-3 text-lg font-medium">Top models</h2>
                {s.byModel.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No settled requests in this range.
                  </p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {s.byModel.slice(0, 6).map((m) => (
                      <li key={m.model_id} className="flex items-center justify-between gap-3">
                        <span className="truncate">{m.model_id}</span>
                        <span className="flex items-center gap-3 text-muted-foreground">
                          <span>{m.requests} req</span>
                          <Badge variant="secondary" className="tabular-nums">
                            {credits(m.settled)} cr
                          </Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="glass p-5">
                <h2 className="mb-3 text-lg font-medium">Servers</h2>
                {status.data ? (
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Version</dt>
                      <dd className="font-medium">{status.data.version}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">In-flight streams</dt>
                      <dd className="font-medium tabular-nums">{status.data.inFlight}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Open reservations</dt>
                      <dd className="font-medium tabular-nums">{status.data.openReservations}</dd>
                    </div>
                    {Object.entries(status.data.breakers).map(([p, st]) => (
                      <div key={p}>
                        <dt className="text-muted-foreground">{p} breaker</dt>
                        <dd className="font-medium">{st}</dd>
                      </div>
                    ))}
                    {Object.keys(status.data.breakers).length === 0 ? (
                      <div>
                        <dt className="text-muted-foreground">Provider breakers</dt>
                        <dd className="font-medium">all closed</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">{status.error ?? "Loading…"}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </Shell>
  );
}
