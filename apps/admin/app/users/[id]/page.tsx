"use client";
import { useParams } from "next/navigation";
import { useState } from "react";

import { PageCard, headRowClass, rowClass } from "@/components/PageCard";
import { ReasonDialog } from "@/components/ReasonDialog";
import { Shell } from "@/components/Shell";
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
  const { id } = useParams<{ id: string }>();
  const detail = useLoad(() => admin<Detail>(`/users/${id}`), [id]);
  const [message, setMessage] = useState<string | null>(null);
  const done = (label: string) => {
    setMessage(`${label}: done`);
    detail.reload();
  };
  const d = detail.data;
  return (
    <Shell
      title={d?.user.email ?? "User"}
      subtitle={
        d
          ? `${d.user.name} · joined ${new Date(d.user.createdAt).toLocaleDateString()} · ${d.activeSessions} active sessions`
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
                <Badge variant="destructive">Suspended · {d.user.banReason ?? ""}</Badge>
              ) : (
                <Badge className="bg-primary/20 text-foreground">Active</Badge>
              )}
              <Badge variant="secondary">{d.user.twoFactorEnabled ? "2FA on" : "2FA off"}</Badge>
              <Badge variant="secondary">
                phone {d.user.phoneVerified ? "verified" : "unverified"}
              </Badge>
              {d.trial ? (
                <Badge variant="secondary">
                  trial {d.trial.status}
                  {d.trial.reasons.length ? ` · ${d.trial.reasons.join(", ")}` : ""}
                </Badge>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {d.user.banned ? (
                <ReasonDialog
                  trigger={<Button variant="secondary">Unsuspend</Button>}
                  title="Unsuspend account"
                  onConfirm={(_v, reason) =>
                    admin(`/users/${id}/suspend`, {
                      method: "POST",
                      json: { suspend: false, reason },
                    }).then(() => done("Unsuspend"))
                  }
                />
              ) : (
                <ReasonDialog
                  trigger={<Button variant="destructive">Suspend</Button>}
                  title="Suspend account"
                  description="All sessions are revoked immediately."
                  destructive
                  onConfirm={(_v, reason) =>
                    admin(`/users/${id}/suspend`, {
                      method: "POST",
                      json: { suspend: true, reason },
                    }).then(() => done("Suspend"))
                  }
                />
              )}
              <ReasonDialog
                trigger={<Button variant="secondary">Reset limits</Button>}
                title="Reset limits"
                description="Clears rate limits, concurrency holds, and open abuse flags. Credits are never changed."
                onConfirm={(_v, reason) =>
                  admin(`/users/${id}/reset-limits`, { method: "POST", json: { reason } }).then(
                    () => done("Reset limits"),
                  )
                }
              />
              <Button
                variant="secondary"
                onClick={() =>
                  admin(`/users/${id}/sessions/revoke`, { method: "POST", json: {} }).then(() =>
                    done("Revoke sessions"),
                  )
                }
              >
                Revoke sessions
              </Button>
              <ReasonDialog
                trigger={<Button variant="destructive">Delete account</Button>}
                title="Delete account"
                description="Soft delete: the account locks now and is purged after 30 days."
                destructive
                confirmLabel="Delete"
                onConfirm={(_v, reason) =>
                  admin(`/users/${id}`, { method: "DELETE", json: { reason } }).then(() =>
                    done("Delete"),
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
          <PageCard title="Organizations and credits">
            <Table>
              <TableHeader>
                <TableRow className={headRowClass}>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Credits</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.organizations.map((o) => (
                  <TableRow key={o.id} className={rowClass}>
                    <TableCell>
                      {o.name}
                      {o.personal ? (
                        <span className="ml-2 text-xs text-muted-foreground">personal</span>
                      ) : null}
                    </TableCell>
                    <TableCell>{o.role}</TableCell>
                    <TableCell>
                      {o.plan}
                      {o.subscriptionStatus ? ` · ${o.subscriptionStatus}` : ""}
                    </TableCell>
                    <TableCell className="tabular-nums">{o.total}</TableCell>
                    <TableCell className="text-right">
                      <ReasonDialog
                        trigger={
                          <Button size="sm" variant="secondary">
                            Grant credits
                          </Button>
                        }
                        title={`Grant credits to ${o.name}`}
                        fields={[
                          {
                            name: "credits",
                            label: "Credits (whole number)",
                            type: "number",
                            placeholder: "200",
                          },
                        ]}
                        confirmLabel="Grant"
                        onConfirm={(v, reason) =>
                          admin(`/orgs/${o.id}/credits/grant`, {
                            method: "POST",
                            json: { credits: Number(v.credits), reason },
                          }).then(() => done(`Grant ${v.credits} credits`))
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PageCard>
          <div className="grid gap-4 xl:grid-cols-2">
            <PageCard title="Devices">
              {d.devices.length === 0 ? (
                <p className="text-sm text-muted-foreground">No devices yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className={headRowClass}>
                      <TableHead>Kind</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Trust</TableHead>
                      <TableHead>Sync</TableHead>
                      <TableHead>Last seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.devices.map((v) => (
                      <TableRow key={v.id} className={rowClass}>
                        <TableCell>{v.kind}</TableCell>
                        <TableCell>{v.name ?? "—"}</TableCell>
                        <TableCell>{v.trustState}</TableCell>
                        <TableCell>{v.syncEnabled ? "on" : "off"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {v.lastSeenAt ? new Date(v.lastSeenAt).toLocaleString() : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </PageCard>
            <PageCard title="Abuse flags">
              {d.abuseFlags.length === 0 ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className={headRowClass}>
                      <TableHead>Kind</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>When</TableHead>
                      <TableHead>State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.abuseFlags.map((f) => (
                      <TableRow key={f.id} className={rowClass}>
                        <TableCell>{f.kind}</TableCell>
                        <TableCell>
                          <Badge variant={f.severity === "suspend" ? "destructive" : "secondary"}>
                            {f.severity}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(f.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>{f.resolvedAt ? "resolved" : "open"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </PageCard>
          </div>
          <PageCard title="Recent usage">
            {d.recentUsage.length === 0 ? (
              <p className="text-sm text-muted-foreground">No gateway requests yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className={headRowClass}>
                    <TableHead>When</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Settled (µcr)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.recentUsage.map((u) => (
                    <TableRow key={u.id} className={rowClass}>
                      <TableCell className="text-muted-foreground">
                        {new Date(u.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>{u.model}</TableCell>
                      <TableCell>{u.status}</TableCell>
                      <TableCell className="tabular-nums">{u.settled ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </PageCard>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </Shell>
  );
}
