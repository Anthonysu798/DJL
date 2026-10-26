"use client";
import { statusLabel } from "@/lib/i18n/status";
import { useI18n } from "@/components/LocaleProvider";
import { useParams } from "next/navigation";
import { useState } from "react";

import { PageCard, StatusPill, headRowClass, rowClass } from "@/components/PageCard";
import { ReasonDialog } from "@/components/ReasonDialog";
import { Shell } from "@/components/Shell";
import { ProductActivityPanel } from "@/components/users/ProductActivityPanel";
import { UsagePanel } from "@/components/users/UsagePanel";
import { Badge } from "@/components/ui/badge";
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
import { integer } from "@/lib/validation";

interface Detail {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    phoneVerified: boolean | null;
    twoFactorEnabled: boolean | null;
    banned: boolean | null;
    banReason: string | null;
    createdAt: string;
  };
  organizations: {
    id: string;
    name: string;
    role: string;
    personal: boolean;
    total: string;
    plan: string;
    subscriptionStatus: string | null;
  }[];
  devices: {
    id: string;
    kind: string;
    name: string | null;
    trustState: string;
    syncEnabled: boolean;
    lastSeenAt: string | null;
  }[];
  abuseFlags: {
    id: string;
    kind: string;
    severity: string;
    createdAt: string;
    resolvedAt: string | null;
  }[];
  activeSessions: number;
  trial: { status: string; reasons: string[] } | null;
  recentUsage: {
    id: string;
    model: string;
    status: string;
    settled: string | null;
    createdAt: string;
  }[];
}

export default function UserDetailPage() {
  const { t, number, date, credits } = useI18n();
  const { id } = useParams<{ id: string }>();
  const detail = useLoad(() => admin<Detail>(`/users/${id}`), [id]);
  const [message, setMessage] = useState<string | null>(null);
  const done = (label: string) => {
    setMessage(t("users.actionDone", { action: label }));
    detail.reload();
  };
  const d = detail.data;
  return (
    <Shell
      title={d?.user.email ?? t("common.user")}
      subtitle={
        d
          ? t("users.joined", {
              name: d.user.name,
              date: date(d.user.createdAt),
              count: number(d.activeSessions),
            })
          : undefined
      }
    >
      {detail.error ? (
        <p role="alert" className="text-sm text-destructive">
          {detail.error}
        </p>
      ) : null}
      {d ? (
        <div className="space-y-4">
          <PageCard>
            <div className="flex flex-wrap items-center gap-2">
              {d.user.banned ? (
                <StatusPill tone="danger">
                  {t("common.suspended")}
                  {d.user.banReason ? ` · ${d.user.banReason}` : ""}
                </StatusPill>
              ) : (
                <StatusPill tone="success">{t("common.active")}</StatusPill>
              )}
              <Badge variant="secondary">
                {d.user.twoFactorEnabled ? t("users.twoFactorOn") : t("users.twoFactorOff")}
              </Badge>
              <Badge variant="secondary">
                {t("users.phoneStatus", {
                  status: d.user.phoneVerified ? t("common.verified") : t("common.unverified"),
                })}
              </Badge>
              {d.trial ? (
                <Badge variant="secondary">
                  {t("users.trialStatus", { status: d.trial.status })}
                  {d.trial.reasons.length ? ` · ${d.trial.reasons.join(", ")}` : ""}
                </Badge>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {d.user.banned ? (
                <ReasonDialog
                  trigger={<Button variant="secondary">{t("users.unsuspend")}</Button>}
                  title={t("users.unsuspendAccount")}
                  onConfirm={(_v, reason) =>
                    admin(`/users/${id}/suspend`, {
                      method: "POST",
                      json: { suspend: false, reason },
                    }).then(() => done(t("users.unsuspend")))
                  }
                />
              ) : (
                <ReasonDialog
                  trigger={<Button variant="destructive">{t("users.suspend")}</Button>}
                  title={t("users.suspendAccount")}
                  description={t("users.sessionsRevoked")}
                  destructive
                  onConfirm={(_v, reason) =>
                    admin(`/users/${id}/suspend`, {
                      method: "POST",
                      json: { suspend: true, reason },
                    }).then(() => done(t("users.suspend")))
                  }
                />
              )}
              <Button
                variant="secondary"
                onClick={() =>
                  admin(`/users/${id}/sessions/revoke`, { method: "POST", json: {} }).then(() =>
                    done(t("users.revokeSessions")),
                  )
                }
              >
                {t("users.revokeSessions")}
              </Button>
              <ReasonDialog
                trigger={<Button variant="destructive">{t("users.deleteAccount")}</Button>}
                title={t("users.deleteAccount")}
                description={t("users.deleteDescription")}
                destructive
                confirmLabel={t("common.delete")}
                onConfirm={(_v, reason) =>
                  admin(`/users/${id}`, { method: "DELETE", json: { reason } }).then(() =>
                    done(t("common.delete")),
                  )
                }
              />
            </div>
            {message ? (
              <p role="status" className="mt-3 text-sm text-muted-foreground">
                {message}
              </p>
            ) : null}
          </PageCard>
          <PageCard title={t("users.organizations")}>
            <Table>
              <TableHeader>
                <TableRow className={headRowClass}>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("team.role")}</TableHead>
                  <TableHead>{t("common.plan")}</TableHead>
                  <TableHead>{t("settings.credits")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.organizations.map((o) => (
                  <TableRow key={o.id} className={rowClass}>
                    <TableCell>
                      {o.name}
                      {o.personal ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t("users.personal")}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{statusLabel(o.role, t)}</TableCell>
                    <TableCell>
                      {o.plan}
                      {o.subscriptionStatus ? ` · ${o.subscriptionStatus}` : ""}
                    </TableCell>
                    <TableCell className="tabular-nums">{credits(o.total)}</TableCell>
                    <TableCell className="text-right">
                      <ReasonDialog
                        trigger={
                          <Button size="sm" variant="secondary">
                            {t("users.grantCredits")}
                          </Button>
                        }
                        title={t("users.grantTo", { name: o.name })}
                        fields={[
                          {
                            name: "credits",
                            label: t("settings.credits"),
                            inputMode: "numeric",
                            validate: integer(1, 1_000_000, t("settings.credits")),
                            hint: t("users.grantHint"),
                            placeholder: "200",
                          },
                        ]}
                        confirmLabel={t("common.grant")}
                        onConfirm={(v, reason) =>
                          admin(`/orgs/${o.id}/credits/grant`, {
                            method: "POST",
                            json: { credits: Number(v.credits), reason },
                          }).then(() =>
                            done(t("users.grantCount", { count: number(Number(v.credits)) })),
                          )
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PageCard>
          <UsagePanel userId={id} />
          <ProductActivityPanel userId={id} />
          <div className="grid gap-4 xl:grid-cols-2">
            <PageCard title={t("users.devices")}>
              {d.devices.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("users.noDevices")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className={headRowClass}>
                      <TableHead>{t("users.kind")}</TableHead>
                      <TableHead>{t("common.name")}</TableHead>
                      <TableHead>{t("users.trust")}</TableHead>
                      <TableHead>{t("switches.sync")}</TableHead>
                      <TableHead>{t("users.lastSeen")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.devices.map((v) => (
                      <TableRow key={v.id} className={rowClass}>
                        <TableCell>{v.kind}</TableCell>
                        <TableCell>{v.name ?? "—"}</TableCell>
                        <TableCell>{statusLabel(v.trustState, t)}</TableCell>
                        <TableCell>{v.syncEnabled ? t("common.on") : t("common.off")}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {v.lastSeenAt
                            ? date(v.lastSeenAt, { dateStyle: "medium", timeStyle: "short" })
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </PageCard>
            <PageCard title={t("users.abuse")}>
              {d.abuseFlags.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("users.none")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className={headRowClass}>
                      <TableHead>{t("users.kind")}</TableHead>
                      <TableHead>{t("users.severity")}</TableHead>
                      <TableHead>{t("common.when")}</TableHead>
                      <TableHead>{t("common.state")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.abuseFlags.map((f) => (
                      <TableRow key={f.id} className={rowClass}>
                        <TableCell>{f.kind}</TableCell>
                        <TableCell>
                          <Badge variant={f.severity === "suspend" ? "destructive" : "secondary"}>
                            {statusLabel(f.severity, t)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {date(f.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                        </TableCell>
                        <TableCell>
                          {f.resolvedAt ? t("common.resolved") : t("common.open")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </PageCard>
          </div>
          <PageCard title={t("users.recentUsage")}>
            {d.recentUsage.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("users.noGateway")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className={headRowClass}>
                    <TableHead>{t("common.when")}</TableHead>
                    <TableHead>{t("common.model")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                    <TableHead>{t("users.settled")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.recentUsage.map((u) => (
                    <TableRow key={u.id} className={rowClass}>
                      <TableCell className="text-muted-foreground">
                        {date(u.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                      </TableCell>
                      <TableCell>{u.model}</TableCell>
                      <TableCell>{statusLabel(u.status, t)}</TableCell>
                      <TableCell className="tabular-nums">
                        {u.settled == null ? "—" : number(BigInt(u.settled))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </PageCard>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      )}
    </Shell>
  );
}
