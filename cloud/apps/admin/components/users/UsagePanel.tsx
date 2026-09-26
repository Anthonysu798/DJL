"use client";
import { PageCard, StatusPill, headRowClass, rowClass } from "@/components/PageCard";
import { ReasonDialog } from "@/components/ReasonDialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { admin, credits } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { integer } from "@/lib/validation";

interface Window {
  kind: "five_hour" | "week";
  limit: string;
  used: string;
  remaining: string;
  resetsAt: string | null;
}
interface Bank {
  id: string;
  source: "admin" | "bulk" | "plan_schedule";
  reason: string | null;
  grantedAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  revokedAt: string | null;
}
interface WindowEvent {
  id: string;
  kind: string;
  actor: string;
  reason: string | null;
  createdAt: string;
}
interface UserUsage {
  planId: string;
  windows: { fiveHour: Window; week: Window };
  banks: Bank[];
  events: WindowEvent[];
}

const SOURCE = { admin: "Admin", bulk: "Bulk", plan_schedule: "Plan schedule" } as const;
const EVENT: Record<string, string> = {
  bank_granted: "Bank granted",
  bank_redeemed: "Bank redeemed",
  bank_revoked: "Bank revoked",
  bank_expired: "Bank expired",
  admin_reset: "Admin reset",
};

function bankState(b: Bank): { label: string; tone: "success" | "danger" | "neutral" } {
  if (b.redeemedAt) return { label: "Redeemed", tone: "neutral" };
  if (b.revokedAt) return { label: "Revoked", tone: "danger" };
  if (new Date(b.expiresAt) <= new Date()) return { label: "Expired", tone: "neutral" };
  return { label: "Available", tone: "success" };
}

function Meter({ label, window }: { label: string; window: Window }) {
  const limit = BigInt(window.limit);
  const used = BigInt(window.used);
  const percent = limit > 0n ? Number((used * 100n) / limit) : 100;
  const full = BigInt(window.remaining) === 0n;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {credits(window.used)} of {credits(window.limit)}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-secondary"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percent, 100)}
      >
        <div
          className={`h-full rounded-full ${full ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <p className="text-[13px] text-muted-foreground">
        {window.resetsAt
          ? `${full ? "Full until" : "Frees up from"} ${new Date(window.resetsAt).toLocaleString()}`
          : "Nothing used"}
      </p>
    </div>
  );
}

/** Both usage windows, banked resets, and window history for one user, with admin actions. */
export function UsagePanel({ userId }: { userId: string }) {
  const usage = useLoad(() => admin<UserUsage>(`/users/${userId}/usage`), [userId]);
  const u = usage.data;
  const live = u?.banks.filter((b) => bankState(b).label === "Available").length ?? 0;
  return (
    <PageCard
      title="Usage windows"
      action={
        <div className="flex gap-2">
          <ReasonDialog
            trigger={
              <Button size="sm" variant="secondary">
                Grant banked reset
              </Button>
            }
            title="Grant banked resets"
            description="The user can redeem each one to zero both windows. Banks expire after 90 days."
            fields={[
              {
                name: "count",
                label: "How many",
                inputMode: "numeric",
                validate: integer(1, 10, "How many"),
                defaultValue: "1",
              },
            ]}
            confirmLabel="Grant"
            onConfirm={(v, reason) =>
              admin(`/users/${userId}/usage/banks`, {
                method: "POST",
                json: { count: Number(v.count), reason },
              }).then(usage.reload)
            }
          />
          <ReasonDialog
            trigger={
              <Button size="sm" variant="secondary">
                Reset limits
              </Button>
            }
            title="Reset limits"
            description="Zeroes both usage windows and clears rate limits, concurrency holds, and open abuse flags. Credits and banked resets are never changed."
            onConfirm={(_v, reason) =>
              admin(`/users/${userId}/reset-limits`, { method: "POST", json: { reason } }).then(
                usage.reload,
              )
            }
          />
        </div>
      }
    >
      {usage.error ? (
        <p role="alert" className="text-sm text-destructive">
          {usage.error}
        </p>
      ) : null}
      {u ? (
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Meter label="5-hour window" window={u.windows.fiveHour} />
            <Meter label="Weekly window" window={u.windows.week} />
          </div>
          <p className="text-sm text-muted-foreground">
            Caps from the {u.planId} plan · {live} banked {live === 1 ? "reset" : "resets"}{" "}
            available
          </p>
          {u.banks.length ? (
            <Table>
              <TableHeader>
                <TableRow className={headRowClass}>
                  <TableHead>Granted</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {u.banks.map((b) => {
                  const state = bankState(b);
                  return (
                    <TableRow key={b.id} className={rowClass}>
                      <TableCell className="text-muted-foreground">
                        {new Date(b.grantedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {SOURCE[b.source]}
                        {b.reason ? (
                          <div className="text-xs text-muted-foreground">{b.reason}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(b.expiresAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={state.tone}>{state.label}</StatusPill>
                      </TableCell>
                      <TableCell className="text-right">
                        {state.label === "Available" ? (
                          <ReasonDialog
                            trigger={
                              <Button size="sm" variant="ghost">
                                Revoke
                              </Button>
                            }
                            title="Revoke banked reset"
                            destructive
                            confirmLabel="Revoke"
                            onConfirm={(_v, reason) =>
                              admin(`/usage/banks/${b.id}/revoke`, {
                                method: "POST",
                                json: { reason },
                              }).then(usage.reload)
                            }
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No banked resets yet.</p>
          )}
          {u.events.length ? (
            <div>
              <h3 className="mb-2 text-sm font-medium">History</h3>
              <ul className="space-y-1 text-sm">
                {u.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap gap-x-3 text-muted-foreground">
                    <span className="text-foreground">{EVENT[e.kind] ?? e.kind}</span>
                    <span>{new Date(e.createdAt).toLocaleString()}</span>
                    <span>{e.actor}</span>
                    {e.reason ? <span>· {e.reason}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </PageCard>
  );
}
