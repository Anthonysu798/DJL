"use client";
import { useParams } from "next/navigation";
import { useState } from "react";

import { Shell } from "@/components/Shell";
import { admin } from "@/lib/api";
import { askReason, useLoad } from "@/lib/useLoad";

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
  const run = async (
    label: string,
    fn: (reason: string) => Promise<unknown>,
    needsReason = true,
  ) => {
    const reason = needsReason ? askReason(label) : "";
    if (needsReason && !reason) return;
    setMessage(null);
    try {
      await fn(reason ?? "");
      setMessage(`${label}: done`);
      detail.reload();
    } catch (e) {
      setMessage(`${label}: ${(e as Error).message}`);
    }
  };
  const d = detail.data;
  return (
    <Shell>
      {detail.error ? (
        <p role="alert" className="text-sm text-red-600">
          {detail.error}
        </p>
      ) : null}
      {d ? (
        <div className="space-y-4">
          <div className="card">
            <h1 className="text-lg font-semibold">{d.user.email}</h1>
            <p className="text-sm text-neutral-500">
              {d.user.name} · joined {new Date(d.user.createdAt).toLocaleDateString()} ·{" "}
              {d.activeSessions} active sessions · {d.user.twoFactorEnabled ? "2FA on" : "2FA off"}{" "}
              · phone {d.user.phoneVerified ? "verified" : "unverified"}
            </p>
            <p className="mt-1 text-sm">
              {d.user.banned ? `Suspended: ${d.user.banReason ?? ""}` : "Active"}
              {d.trial
                ? ` · trial ${d.trial.status}${d.trial.reasons.length ? ` (${d.trial.reasons.join(", ")})` : ""}`
                : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {d.user.banned ? (
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() =>
                    run("Unsuspend", (reason) =>
                      admin(`/users/${id}/suspend`, {
                        method: "POST",
                        json: { suspend: false, reason },
                      }),
                    )
                  }
                >
                  Unsuspend
                </button>
              ) : (
                <button
                  className="btn-danger"
                  type="button"
                  onClick={() =>
                    run("Suspend", (reason) =>
                      admin(`/users/${id}/suspend`, {
                        method: "POST",
                        json: { suspend: true, reason },
                      }),
                    )
                  }
                >
                  Suspend
                </button>
              )}
              <button
                className="btn-secondary"
                type="button"
                onClick={() =>
                  run("Reset limits", (reason) =>
                    admin(`/users/${id}/reset-limits`, { method: "POST", json: { reason } }),
                  )
                }
              >
                Reset limits
              </button>
              <button
                className="btn-secondary"
                type="button"
                onClick={() =>
                  run(
                    "Revoke sessions",
                    () => admin(`/users/${id}/sessions/revoke`, { method: "POST", json: {} }),
                    false,
                  )
                }
              >
                Revoke sessions
              </button>
              <button
                className="btn-danger"
                type="button"
                onClick={() => {
                  if (window.confirm("Soft-delete this account? It is purged after 30 days."))
                    void run("Delete account", (reason) =>
                      admin(`/users/${id}`, { method: "DELETE", json: { reason } }),
                    );
                }}
              >
                Delete account
              </button>
            </div>
            {message ? (
              <p role="status" className="mt-2 text-sm">
                {message}
              </p>
            ) : null}
          </div>
          <div className="card">
            <h2 className="mb-2 text-sm font-medium">Organizations and credits</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Plan</th>
                  <th>Credits</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {d.organizations.map((o) => (
                  <tr key={o.id}>
                    <td>
                      {o.name}
                      {o.personal ? " (personal)" : ""}
                    </td>
                    <td>{o.role}</td>
                    <td>
                      {o.plan}
                      {o.subscriptionStatus ? ` · ${o.subscriptionStatus}` : ""}
                    </td>
                    <td className="tabular-nums">{o.total}</td>
                    <td>
                      <button
                        className="btn-secondary"
                        type="button"
                        onClick={() => {
                          const amount = Number(window.prompt("Credits to grant (whole number)"));
                          if (!Number.isInteger(amount) || amount <= 0) return;
                          void run(`Grant ${amount} credits`, (reason) =>
                            admin(`/orgs/${o.id}/credits/grant`, {
                              method: "POST",
                              json: { credits: amount, reason },
                            }),
                          );
                        }}
                      >
                        Grant credits
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card">
              <h2 className="mb-2 text-sm font-medium">Devices</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Name</th>
                    <th>Trust</th>
                    <th>Sync</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {d.devices.map((v) => (
                    <tr key={v.id}>
                      <td>{v.kind}</td>
                      <td>{v.name ?? "—"}</td>
                      <td>{v.trustState}</td>
                      <td>{v.syncEnabled ? "on" : "off"}</td>
                      <td>{v.lastSeenAt ? new Date(v.lastSeenAt).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h2 className="mb-2 text-sm font-medium">Abuse flags</h2>
              {d.abuseFlags.length === 0 ? (
                <p className="text-sm text-neutral-500">None.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Kind</th>
                      <th>Severity</th>
                      <th>When</th>
                      <th>Resolved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.abuseFlags.map((f) => (
                      <tr key={f.id}>
                        <td>{f.kind}</td>
                        <td>{f.severity}</td>
                        <td>{new Date(f.createdAt).toLocaleString()}</td>
                        <td>{f.resolvedAt ? "yes" : "open"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <div className="card">
            <h2 className="mb-2 text-sm font-medium">Recent usage</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Model</th>
                  <th>Status</th>
                  <th>Settled (µcr)</th>
                </tr>
              </thead>
              <tbody>
                {d.recentUsage.map((u) => (
                  <tr key={u.id}>
                    <td>{new Date(u.createdAt).toLocaleString()}</td>
                    <td>{u.model}</td>
                    <td>{u.status}</td>
                    <td className="tabular-nums">{u.settled ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-sm text-neutral-500">Loading…</p>
      )}
    </Shell>
  );
}
