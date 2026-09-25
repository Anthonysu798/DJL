"use client";
import { PageCard } from "@/components/PageCard";
import { ReasonDialog } from "@/components/ReasonDialog";
import { Shell } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { admin, credits } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { integer } from "@/lib/validation";

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

export default function PlansPage() {
  const plans = useLoad(() => admin<Plan[]>("/plans"), []);
  return (
    <Shell
      title="Plans"
      subtitle="Limits, priority, and Stripe price ids live here; the code only carries defaults."
    >
      {plans.error ? (
        <p role="alert" className="text-sm text-destructive">
          {plans.error}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.data?.map((p) => (
          <PageCard
            key={p.id}
            title={p.name}
            action={
              <Badge variant={p.active ? "secondary" : "destructive"}>
                {p.active ? p.id : "inactive"}
              </Badge>
            }
          >
            <div className="text-3xl font-semibold tabular-nums">
              ${(p.monthlyPriceUsdCents / 100).toFixed(0)}
              <span className="text-sm font-normal text-muted-foreground">/month</span>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              ${(p.annualPriceUsdCents / 100).toFixed(0)}/year
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Included credits</dt>
                <dd className="tabular-nums">{credits(p.includedMicrocredits)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Concurrent streams</dt>
                <dd>{p.concurrentStreams}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Requests / minute</dt>
                <dd>{p.requestsPerMinute}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Priority weight</dt>
                <dd>{p.priorityWeight}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Sync quota</dt>
                <dd>{(Number(p.syncQuotaBytes) / 1024 ** 3).toFixed(1)} GB</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Stripe monthly</dt>
                <dd className="truncate font-mono text-xs">{p.stripeMonthlyPriceId ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Stripe annual</dt>
                <dd className="truncate font-mono text-xs">{p.stripeAnnualPriceId ?? "—"}</dd>
              </div>
            </dl>
            <ReasonDialog
              trigger={
                <Button className="mt-4 w-full" variant="secondary">
                  Edit plan
                </Button>
              }
              title={`Edit ${p.name}`}
              fields={[
                {
                  name: "monthlyPriceUsdCents",
                  label: "Monthly price (cents)",
                  inputMode: "numeric",
                  validate: integer(0, 10000000, "Monthly price (cents)"),
                  defaultValue: String(p.monthlyPriceUsdCents),
                },
                {
                  name: "annualPriceUsdCents",
                  label: "Annual price (cents)",
                  inputMode: "numeric",
                  validate: integer(0, 100000000, "Annual price (cents)"),
                  defaultValue: String(p.annualPriceUsdCents),
                },
                {
                  name: "includedMicrocredits",
                  label: "Included microcredits",
                  inputMode: "numeric",
                  validate: integer(0, 1_000_000_000_000_000, "Included microcredits"),
                  defaultValue: p.includedMicrocredits,
                },
                {
                  name: "concurrentStreams",
                  label: "Concurrent streams",
                  inputMode: "numeric",
                  validate: integer(1, 10000, "Concurrent streams"),
                  defaultValue: String(p.concurrentStreams),
                },
                {
                  name: "requestsPerMinute",
                  label: "Requests per minute",
                  inputMode: "numeric",
                  validate: integer(1, 100000, "Requests per minute"),
                  defaultValue: String(p.requestsPerMinute),
                },
                {
                  name: "priorityWeight",
                  label: "Priority weight",
                  inputMode: "numeric",
                  validate: integer(1, 1000, "Priority weight"),
                  defaultValue: String(p.priorityWeight),
                },
                {
                  name: "stripeMonthlyPriceId",
                  label: "Stripe monthly price id",
                  hint: "Leave empty until the Stripe price exists.",
                  validate: (v) =>
                    v.trim() === "" || /^price_[A-Za-z0-9]+$/.test(v.trim())
                      ? null
                      : "Stripe price ids start with price_.",
                  defaultValue: p.stripeMonthlyPriceId ?? "",
                },
                {
                  name: "stripeAnnualPriceId",
                  label: "Stripe annual price id",
                  validate: (v) =>
                    v.trim() === "" || /^price_[A-Za-z0-9]+$/.test(v.trim())
                      ? null
                      : "Stripe price ids start with price_.",
                  defaultValue: p.stripeAnnualPriceId ?? "",
                },
              ]}
              confirmLabel="Save"
              onConfirm={(v, reason) =>
                admin(`/plans/${p.id}`, {
                  method: "PATCH",
                  json: {
                    monthlyPriceUsdCents: Number(v.monthlyPriceUsdCents),
                    annualPriceUsdCents: Number(v.annualPriceUsdCents),
                    includedMicrocredits: v.includedMicrocredits,
                    concurrentStreams: Number(v.concurrentStreams),
                    requestsPerMinute: Number(v.requestsPerMinute),
                    priorityWeight: Number(v.priorityWeight),
                    stripeMonthlyPriceId: v.stripeMonthlyPriceId || null,
                    stripeAnnualPriceId: v.stripeAnnualPriceId || null,
                    reason,
                  },
                }).then(plans.reload)
              }
            />
          </PageCard>
        ))}
      </div>
    </Shell>
  );
}
