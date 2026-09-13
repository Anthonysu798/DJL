"use client";
import { Shell } from "@/components/Shell";
import { admin } from "@/lib/api";
import { askReason, useLoad } from "@/lib/useLoad";

interface Switch {
  name: "gateway" | "billing" | "sync";
  engaged: boolean;
  reason: string | null;
  changedBy: string | null;
  changedAt: string;
}
const DESCRIPTION: Record<Switch["name"], string> = {
  gateway: "Stops all model requests. Balances and history stay readable.",
  billing: "Stops checkouts and top-ups. Existing subscriptions keep running in Stripe.",
  sync: "Stops event and attachment uploads from devices. Pulling and reading continue.",
};

export default function SwitchesPage() {
  const switches = useLoad(() => admin<Switch[]>("/kill-switches"), []);
  const flip = async (s: Switch) => {
    const reason = askReason(`${s.engaged ? "Release" : "Engage"} ${s.name} kill switch`);
    if (!reason) return;
    if (!s.engaged && !window.confirm(`Engage the ${s.name} kill switch for every user?`)) return;
    await admin(`/kill-switches/${s.name}`, {
      method: "PUT",
      json: { engaged: !s.engaged, reason },
    });
    switches.reload();
  };
  return (
    <Shell>
      <h1 className="mb-1 text-lg font-semibold">Kill switches</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Each switch takes effect within seconds, is audited, and alerts the team.
      </p>
      {switches.error ? (
        <p role="alert" className="text-sm text-red-600">
          {switches.error}
        </p>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-3">
        {switches.data?.map((s) => (
          <div key={s.name} className="card space-y-2">
            <h2 className="text-sm font-medium">{s.name}</h2>
            <p className="text-sm text-neutral-500">{DESCRIPTION[s.name]}</p>
            <p className="text-sm">
              {s.engaged ? `ENGAGED — ${s.reason ?? ""}` : "released"}
              <br />
              <span className="text-xs text-neutral-500">
                {new Date(s.changedAt).toLocaleString()}
              </span>
            </p>
            <button
              className={s.engaged ? "btn" : "btn-danger"}
              type="button"
              onClick={() => flip(s)}
            >
              {s.engaged ? "Release" : "Engage"}
            </button>
          </div>
        ))}
      </div>
    </Shell>
  );
}
