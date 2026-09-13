"use client";
import { Shell } from "@/components/Shell";
import { admin, credits } from "@/lib/api";
import { askReason, useLoad } from "@/lib/useLoad";

interface Plan {
  id: string;
  name: string;
  monthlyPriceUsdCents: number;
  annualPriceUsdCents: number;
  includedMicrocredits: string;
  concurrentStreams: number;
  requestsPerMinute: number;
  priorityWeight: number;
  syncQuotaBytes: string;
  requiresOwner2fa: boolean;
  stripeMonthlyPriceId: string | null;
  stripeAnnualPriceId: string | null;
  active: boolean;
}

const FIELDS: [keyof Plan, string][] = [
  ["monthlyPriceUsdCents", "Monthly price (cents)"],
  ["annualPriceUsdCents", "Annual price (cents)"],
  ["includedMicrocredits", "Included microcredits"],
  ["concurrentStreams", "Concurrent streams"],
  ["requestsPerMinute", "Requests per minute"],
  ["priorityWeight", "Priority weight"],
  ["syncQuotaBytes", "Sync quota bytes"],
  ["stripeMonthlyPriceId", "Stripe monthly price id"],
  ["stripeAnnualPriceId", "Stripe annual price id"],
];

export default function PlansPage() {
  const plans = useLoad(() => admin<Plan[]>("/plans"), []);
  const patch = async (p: Plan, field: keyof Plan, label: string) => {
    const value = window.prompt(label, String(p[field] ?? ""));
    if (value === null) return;
    const reason = askReason(`Update ${field} of ${p.id}`);
    if (!reason) return;
    const numeric = [
      "monthlyPriceUsdCents",
      "annualPriceUsdCents",
      "concurrentStreams",
      "requestsPerMinute",
      "priorityWeight",
    ].includes(field);
    await admin(`/plans/${p.id}`, {
      method: "PATCH",
      json: { [field]: numeric ? Number(value) : value, reason },
    });
    plans.reload();
  };
  return (
    <Shell>
      <h1 className="mb-1 text-lg font-semibold">Plans</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Limits, priority, and Stripe price ids live here; the code only carries defaults.
      </p>
      {plans.error ? (
        <p role="alert" className="text-sm text-red-600">
          {plans.error}
        </p>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {plans.data?.map((p) => (
          <div key={p.id} className="card">
            <h2 className="mb-2 text-sm font-medium">
              {p.name}{" "}
              <span className="text-neutral-500">
                ({p.id}
                {p.active ? "" : ", inactive"})
              </span>
            </h2>
            <dl className="space-y-1 text-sm">
              {FIELDS.map(([field, label]) => (
                <div key={field} className="flex justify-between gap-2">
                  <dt className="text-neutral-500">{label}</dt>
                  <dd>
                    <button
                      className="underline tabular-nums"
                      type="button"
                      onClick={() => patch(p, field, label)}
                    >
                      {field === "includedMicrocredits"
                        ? `${credits(p.includedMicrocredits)} cr`
                        : String(p[field] ?? "—")}
                    </button>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Shell>
  );
}
