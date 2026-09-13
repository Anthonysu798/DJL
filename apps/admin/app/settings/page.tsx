"use client";
import { Shell } from "@/components/Shell";
import { admin } from "@/lib/api";
import { askReason, useLoad } from "@/lib/useLoad";

interface Setting {
  key: string;
  value: unknown;
  updatedBy: string | null;
  updatedAt: string;
}
const KNOWN = [
  "trial.credits",
  "trial.expiry_days",
  "trial.daily_budget_usd_cents",
  "gateway.soft_cap_streams",
  "gateway.hard_cap_streams",
  "pricing.margin",
  "admin.ip_allowlist",
];

export default function SettingsPage() {
  const settings = useLoad(() => admin<Setting[]>("/settings"), []);
  const put = async (key: string, current: unknown) => {
    const raw = window.prompt(`${key} (JSON)`, JSON.stringify(current ?? null));
    if (raw === null) return;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      window.alert('Enter valid JSON, e.g. 200, 0.4, or ["1.2.3.4/32"].');
      return;
    }
    const reason = askReason(`Set ${key}`);
    if (!reason) return;
    await admin(`/settings/${key}`, { method: "PUT", json: { value, reason } });
    settings.reload();
  };
  const rows = [...(settings.data ?? [])];
  for (const key of KNOWN)
    if (!rows.some((r) => r.key === key))
      rows.push({ key, value: null, updatedBy: null, updatedAt: "" });
  return (
    <Shell>
      <h1 className="mb-1 text-lg font-semibold">Settings</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Runtime knobs read by the API on each use. admin.ip_allowlist is a JSON array of IPs or
        CIDRs; an empty list allows every network, so set it before production.
      </p>
      {settings.error ? (
        <p role="alert" className="text-sm text-red-600">
          {settings.error}
        </p>
      ) : null}
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Value</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.key}>
                <td>{s.key}</td>
                <td className="font-mono text-xs">{JSON.stringify(s.value)}</td>
                <td className="text-xs">
                  {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "default"}
                </td>
                <td>
                  <button
                    className="btn-secondary"
                    type="button"
                    onClick={() => put(s.key, s.value)}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
