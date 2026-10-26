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
import { admin } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { useI18n } from "@/components/LocaleProvider";
import type { MessageKey } from "@/lib/i18n";
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

const SOURCE = {
  admin: "role.admin",
  bulk: "usage.bulk",
  plan_schedule: "usage.schedule",
} as const;
const EVENT: Record<string, MessageKey> = {
  bank_granted: "usage.granted",
  bank_redeemed: "usage.redeemed",
  bank_revoked: "usage.revoked",
  bank_expired: "usage.expired",
  admin_reset: "usage.resetLimits",
};
function bankState(b: Bank): { label: MessageKey; tone: "success" | "danger" | "neutral" } {
  if (b.redeemedAt) return { label: "usage.redeemed", tone: "neutral" };
  if (b.revokedAt) return { label: "usage.revoked", tone: "danger" };
  if (new Date(b.expiresAt) <= new Date()) return { label: "usage.expired", tone: "neutral" };
  return { label: "usage.available", tone: "success" };
}

function Meter({ label, window }: { label: string; window: Window }) {
  const { t, credits, date } = useI18n();
  const limit = BigInt(window.limit);
  const used = BigInt(window.used);
  const percent = limit > 0n ? Number((used * 100n) / limit) : 100;
  const full = BigInt(window.remaining) === 0n;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {t("usage.meter", { used: credits(window.used), limit: credits(window.limit) })}
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
          ? t(full ? "usage.fullUntil" : "usage.freesFrom", {
              date: date(window.resetsAt, { dateStyle: "medium", timeStyle: "short" }),
            })
          : t("usage.nothingUsed")}
      </p>
    </div>
  );
}

/** Both usage windows, banked resets, and window history for one user, with admin actions. */
export function UsagePanel({ userId }: { userId: string }) {
  const { t, number, date } = useI18n();
  const usage = useLoad(() => admin<UserUsage>(`/users/${userId}/usage`), [userId]);
  const u = usage.data;
  const live = u?.banks.filter((b) => bankState(b).label === "usage.available").length ?? 0;
  return (
    <PageCard
      title={t("nav.usage")}
      action={
        <div className="flex gap-2">
          <ReasonDialog
            trigger={
              <Button size="sm" variant="secondary">
                {t("usage.grantReset")}
              </Button>
            }
            title={t("usage.grantMany")}
            description={t("usage.userGrantDescription")}
            fields={[
              {
                name: "count",
                label: t("usage.howMany"),
                inputMode: "numeric",
                validate: integer(1, 10, t("usage.howMany")),
                defaultValue: "1",
              },
            ]}
            confirmLabel={t("common.grant")}
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
                {t("usage.resetLimits")}
              </Button>
            }
            title={t("usage.resetLimits")}
            description={t("usage.limitsDescription")}
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
            <Meter label={t("usage.fiveWindow")} window={u.windows.fiveHour} />
            <Meter label={t("usage.weekWindow")} window={u.windows.week} />
          </div>
          <p className="text-sm text-muted-foreground">
            {t("usage.availableSummary", { plan: u.planId, count: number(live) })}
          </p>
          {u.banks.length ? (
            <Table>
              <TableHeader>
                <TableRow className={headRowClass}>
                  <TableHead>{t("usage.granted")}</TableHead>
                  <TableHead>{t("common.source")}</TableHead>
                  <TableHead>{t("usage.expires")}</TableHead>
                  <TableHead>{t("common.state")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {u.banks.map((b) => {
                  const state = bankState(b);
                  return (
                    <TableRow key={b.id} className={rowClass}>
                      <TableCell className="text-muted-foreground">
                        {date(b.grantedAt, { dateStyle: "medium", timeStyle: "short" })}
                      </TableCell>
                      <TableCell>
                        {t(SOURCE[b.source])}
                        {b.reason ? (
                          <div className="text-xs text-muted-foreground">{b.reason}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{date(b.expiresAt)}</TableCell>
                      <TableCell>
                        <StatusPill tone={state.tone}>{t(state.label)}</StatusPill>
                      </TableCell>
                      <TableCell className="text-right">
                        {state.label === "usage.available" ? (
                          <ReasonDialog
                            trigger={
                              <Button size="sm" variant="ghost">
                                {t("usage.revoke")}
                              </Button>
                            }
                            title={t("usage.revokeReset")}
                            destructive
                            confirmLabel={t("usage.revoke")}
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
            <p className="text-sm text-muted-foreground">{t("usage.noBanks")}</p>
          )}
          {u.events.length ? (
            <div>
              <h3 className="mb-2 text-sm font-medium">{t("common.history")}</h3>
              <ul className="space-y-1 text-sm">
                {u.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap gap-x-3 text-muted-foreground">
                    <span className="text-foreground">
                      {EVENT[e.kind] ? t(EVENT[e.kind]!) : e.kind}
                    </span>
                    <span>{date(e.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                    <span>{e.actor}</span>
                    {e.reason ? <span>· {e.reason}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      )}
    </PageCard>
  );
}
