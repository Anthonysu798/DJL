"use client";
import { useEffect, useState } from "react";

import { AuthGate } from "@/components/AuthGate";
import { api, ApiError } from "@/lib/api";
import { fill } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";

interface SubscriptionView {
  subscription: {
    planId: string;
    status: string;
    interval: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
  } | null;
  invoices: {
    id: string;
    status: string;
    amountPaidUsdCents: number;
    currency: string;
    hostedInvoiceUrl: string | null;
    createdAt: string;
  }[];
}

const TIERS = [
  { id: "starter", usd: 20, credits: "2,000" },
  { id: "business", usd: 60, credits: "6,500" },
  { id: "autopilot", usd: 180, credits: "21,000" },
] as const;

function BillingView() {
  const { d } = useLocale();
  const [view, setView] = useState<SubscriptionView | null>(null);
  const [usd, setUsd] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<SubscriptionView>("/v1/billing/subscription")
      .then(setView)
      .catch((e: Error) => setError(e.message));
  }, []);

  const go = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/v1/billing/checkout", {
        method: "POST",
        json: body,
      });
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : d.error);
      setBusy(false);
    }
  };
  const portal = async () => {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>("/v1/billing/portal", {
        method: "POST",
        json: {},
      });
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : d.error);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card space-y-3">
        <h1 className="text-xl font-semibold">{d.billing}</h1>
        {view?.subscription ? (
          <p className="text-sm">
            {d.currentPlan}:{" "}
            <strong>
              {d.tiers[view.subscription.planId as keyof typeof d.tiers] ??
                view.subscription.planId}
            </strong>{" "}
            ({view.subscription.status})
          </p>
        ) : null}
        <button
          className="btn-secondary"
          type="button"
          disabled={busy}
          onClick={() => void portal()}
        >
          {d.manageBilling}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {TIERS.map((tier) => (
          <div key={tier.id} className="card space-y-2">
            <h2 className="font-semibold">{d.tiers[tier.id]}</h2>
            <p className="text-2xl font-semibold">
              ${tier.usd}
              <span className="text-sm font-normal text-neutral-500">{d.perMonth}</span>
            </p>
            <p className="text-sm text-neutral-600">
              {fill(d.tierCredits, { credits: tier.credits })}
            </p>
            <button
              className="btn w-full"
              type="button"
              disabled={busy || view?.subscription?.status === "active"}
              onClick={() => void go({ kind: "subscription", planId: tier.id, interval: "month" })}
            >
              {d.subscribe}
            </button>
          </div>
        ))}
      </div>
      <div className="card space-y-3">
        <h2 className="font-semibold">{d.buyCredits}</h2>
        <label className="label" htmlFor="usd">
          {d.topupAmount}
        </label>
        <input
          id="usd"
          className="input"
          type="number"
          min={5}
          max={10000}
          step={1}
          value={usd}
          onChange={(e) => setUsd(Number(e.target.value))}
        />
        <p className="text-xs text-neutral-500">{d.topupHint}</p>
        <button
          className="btn"
          type="button"
          disabled={busy || usd < 5}
          onClick={() => void go({ kind: "topup", usd })}
        >
          {d.buyCredits}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {view?.invoices.length ? (
        <div className="card">
          <ul className="space-y-1 text-sm">
            {view.invoices.map((inv) => (
              <li key={inv.id} className="flex justify-between">
                <span>
                  {new Date(inv.createdAt).toLocaleDateString()} · {inv.status}
                </span>
                <span>
                  ${(inv.amountPaidUsdCents / 100).toFixed(2)}{" "}
                  {inv.hostedInvoiceUrl ? (
                    <a
                      className="underline"
                      href={inv.hostedInvoiceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      PDF
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function BillingPage() {
  return (
    <AuthGate next="/billing">
      <BillingView />
    </AuthGate>
  );
}
