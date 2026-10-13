"use client";
import type { CloudCheckoutInput, CloudSubscriptionResponse } from "@synara/contracts/cloud";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CircleAlert,
  CreditCard,
  Loader2,
  Plus,
  Receipt,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { AuthGate } from "@/components/AuthGate";
import { DjlLogo } from "@/components/DjlLogo";
import { ThemeToggle } from "@/components/theme";
import { api, ApiError, type Credits } from "@/lib/api";
import { fill } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";

gsap.registerPlugin(ScrollTrigger);

const TIERS = [
  { id: "starter", usd: 20, credits: 2000, streams: 5, storage: 2 },
  { id: "business", usd: 60, credits: 6500, streams: 15, storage: 10 },
  { id: "autopilot", usd: 180, credits: 21000, streams: 40, storage: 50 },
] as const;

function BillingView() {
  const { d, locale } = useLocale();
  const scope = useRef<HTMLDivElement>(null);
  const errorBanner = useRef<HTMLDivElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<CloudSubscriptionResponse | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [amount, setAmount] = useState("20");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const usd = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isInteger(usd) && usd >= 5 && usd <= 10000;
  const active = view?.subscription?.status === "active";
  const format = (n: number) =>
    new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN").format(n);
  const money = (n: number, currency = "USD") =>
    new Intl.NumberFormat(locale === "en" ? "en-US" : "zh-CN", {
      style: "currency",
      currency,
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    }).format(n);
  const date = (value: string) =>
    new Date(value).toLocaleDateString(locale === "en" ? "en-US" : "zh-CN", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const currentPlan =
    active && view?.subscription
      ? (d.tiers[view.subscription.planId as keyof typeof d.tiers] ?? view.subscription.planId)
      : d.chat.freePlan;

  const load = useCallback(async () => {
    setLoadError(false);
    setError(null);
    try {
      const [subscription, balance] = await Promise.all([
        api<CloudSubscriptionResponse>("/v1/billing/subscription"),
        api<Credits>("/v1/credits"),
      ]);
      setView(subscription);
      setCredits(balance);
    } catch (e) {
      setLoadError(true);
      setError(e instanceof ApiError ? e.message : d.error);
    }
  }, [d.error]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (error) errorBanner.current?.focus();
  }, [error]);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".billing-hero", { y: 12, opacity: 0, duration: 0.5, ease: "power2.out" });
        gsap.from(".billing-plan", {
          y: 20,
          opacity: 0,
          stagger: 0.07,
          duration: 0.55,
          delay: 0.1,
          ease: "power2.out",
        });
        gsap.from(".billing-bottom", {
          y: 18,
          opacity: 0,
          scale: 0.99,
          duration: 0.45,
          scrollTrigger: { trigger: ".billing-bottom", start: "top 95%" },
        });
      });
      return () => media.revert();
    },
    { scope },
  );

  const go = async (body: CloudCheckoutInput, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/v1/billing/checkout", {
        method: "POST",
        json: body,
      });
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : d.error);
      setBusy(null);
    }
  };
  const portal = async (key = "portal") => {
    setBusy(key);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/v1/billing/portal", {
        method: "POST",
        json: {},
      });
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : d.error);
      setBusy(null);
    }
  };
  const topup = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validAmount) {
      setAmountError(d.billingUi.amountError);
      amountInput.current?.focus();
      return;
    }
    setAmountError(null);
    void go({ kind: "topup", usd }, "topup");
  };

  return (
    <div ref={scope} className="billing-page min-h-dvh">
      <header className="border-b border-border/60">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link
            href="/chat"
            className="flex items-center gap-2 text-base font-semibold tracking-tight"
          >
            <DjlLogo className="size-11 dark:brightness-0 dark:invert" />
            DJL <span className="font-normal text-muted-foreground">Cloud</span>
          </Link>
          <div className="flex items-center gap-5">
            <ThemeToggle />
            <Link
              href="/chat"
              className="billing-back flex items-center gap-2 text-sm text-muted-foreground"
            >
              <ArrowLeft className="size-4" />
              {d.billingUi.backToChat}
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl overflow-x-hidden px-5 pt-12 pb-10 sm:px-8 sm:pt-16">
        <div className="billing-hero mx-auto mb-12 max-w-5xl text-center">
          <h1 className="text-[clamp(2.25rem,4.5vw,3.5rem)] leading-[1.08] font-semibold tracking-[-.045em]">
            {d.billingUi.title}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-muted-foreground">
            {d.billingUi.subtitle}
          </p>
          <p className="mt-5 text-sm text-muted-foreground">{d.billingUi.monthlyBilling}</p>
        </div>

        {error ? (
          <div
            role="alert"
            ref={errorBanner}
            tabIndex={-1}
            className="mb-6 flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300"
          >
            <CircleAlert className="size-5 shrink-0" />
            <div>
              <p>{error}</p>
              {loadError ? (
                <button
                  type="button"
                  onClick={() => void load()}
                  className="mt-2 font-medium underline underline-offset-4"
                >
                  {d.chat.retry}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="grid grid-flow-dense gap-5 md:grid-cols-3" aria-label={d.billingUi.plans}>
          {TIERS.map((tier) => {
            const featured = tier.id === "business";
            const isCurrent = active && view?.subscription?.planId === tier.id;
            const features = [
              fill(d.tierCredits, { credits: format(tier.credits) }),
              d.billingUi.allModels,
              fill(d.billingUi.parallelChats, { count: format(tier.streams) }),
              fill(d.billingUi.syncStorage, { count: format(tier.storage) }),
              d.billingUi.priority,
            ];
            return (
              <article
                key={tier.id}
                aria-label={d.tiers[tier.id]}
                className={`billing-plan group relative flex min-h-[475px] flex-col overflow-hidden rounded-[28px] p-7 lg:p-8 ${featured ? "billing-plan-featured" : "billing-plan-standard"}`}
              >
                <div className="flex min-h-8 items-center justify-between gap-2">
                  <h2 className="text-2xl font-medium tracking-tight">{d.tiers[tier.id]}</h2>
                  {isCurrent ? (
                    <span className="billing-plan-tag">{d.currentPlan}</span>
                  ) : featured ? (
                    <span className="billing-plan-tag">{d.billingUi.recommended}</span>
                  ) : null}
                </div>
                <p
                  className={`mt-4 min-h-12 text-sm leading-6 ${featured ? "text-white/65" : "text-muted-foreground"}`}
                >
                  {d.billingUi.descriptions[tier.id]}
                </p>
                <ul className="my-8 space-y-4 text-[14px] leading-5">
                  {features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5">
                      <Check
                        className={`mt-0.5 size-4 shrink-0 ${featured ? "text-[#eadb8a]" : "text-foreground/65"}`}
                        aria-hidden
                      />
                      {feature}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto">
                  <div className="mb-6 flex items-baseline gap-2">
                    <span className="text-[46px] leading-none font-medium tracking-[-.045em]">
                      {money(tier.usd)}
                    </span>
                    <span
                      className={`text-sm ${featured ? "text-white/60" : "text-muted-foreground"}`}
                    >
                      {d.perMonth}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`billing-plan-button w-full ${featured ? "billing-plan-button-light" : "billing-plan-button-dark"}`}
                    disabled={busy !== null || !view}
                    onClick={() =>
                      active
                        ? void portal(tier.id)
                        : void go(
                            { kind: "subscription", planId: tier.id, interval: "month" },
                            tier.id,
                          )
                    }
                  >
                    {busy === tier.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : null}
                    {isCurrent
                      ? d.billingUi.managePlan
                      : active
                        ? d.billingUi.changePlan
                        : fill(d.billingUi.choosePlan, { plan: d.tiers[tier.id] })}
                    <ArrowUpRight
                      className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      aria-hidden
                    />
                  </button>
                  <p
                    className={`mt-3 text-center text-xs ${featured ? "text-white/55" : "text-muted-foreground"}`}
                  >
                    {d.billingUi.billedMonthly}
                  </p>
                </div>
              </article>
            );
          })}
        </div>

        <div className="billing-bottom mt-10 grid gap-5 lg:grid-cols-[.9fr_1.1fr]">
          <section
            className="billing-panel rounded-[24px] border border-border p-6 sm:p-8"
            aria-label={d.billingUi.yourPlan}
          >
            <div className="mb-7 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <CreditCard className="size-5 text-muted-foreground" />
                <h2 className="text-lg font-medium tracking-tight">{d.billingUi.yourPlan}</h2>
              </div>
              <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium">
                {view ? currentPlan : d.loading}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{d.billingUi.availableCredits}</p>
            <p className="mt-2 text-3xl font-medium tracking-tight">
              {credits ? format(Number(credits.display.total)) : "—"}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {d.credits.toLowerCase()}
              </span>
            </p>
            {active && view?.subscription ? (
              <p className="mt-4 text-sm text-muted-foreground">
                {fill(view.subscription.cancelAtPeriodEnd ? d.billingUi.ends : d.billingUi.renews, {
                  date: date(view.subscription.currentPeriodEnd),
                })}
              </p>
            ) : (
              <p className="mt-4 text-sm leading-6 text-muted-foreground">{d.billingUi.freeHint}</p>
            )}
            <button
              type="button"
              className="billing-secondary mt-6"
              disabled={busy !== null || !view}
              onClick={() => void portal()}
            >
              {busy === "portal" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Receipt className="size-4" />
              )}
              {d.manageBilling}
              <ArrowUpRight className="size-4" />
            </button>
          </section>

          <section
            className="billing-panel rounded-[24px] border border-border p-6 sm:p-8"
            aria-label={d.buyCredits}
          >
            <div className="mb-3 flex items-center gap-2.5">
              <Wallet className="size-5 text-muted-foreground" />
              <h2 className="text-lg font-medium tracking-tight">{d.buyCredits}</h2>
            </div>
            <p className="mb-6 text-sm leading-6 text-muted-foreground">{d.billingUi.topupBody}</p>
            <form noValidate onSubmit={topup}>
              <div className="mb-4 flex flex-wrap gap-2" aria-label={d.billingUi.quickAmounts}>
                {[10, 20, 50, 100].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={usd === value}
                    onClick={() => {
                      setAmount(String(value));
                      setAmountError(null);
                    }}
                    className={`billing-amount ${usd === value ? "billing-amount-active" : ""}`}
                  >
                    {money(value)}
                  </button>
                ))}
              </div>
              <label className="mb-2 block text-sm font-medium" htmlFor="usd">
                {d.topupAmount}
              </label>
              <div className="flex items-stretch gap-3 max-sm:flex-col">
                <div className="relative flex-1">
                  <span
                    className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted-foreground"
                    aria-hidden
                  >
                    $
                  </span>
                  <input
                    ref={amountInput}
                    id="usd"
                    type="number"
                    min={5}
                    max={10000}
                    step={1}
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setAmountError(null);
                    }}
                    aria-invalid={!!amountError}
                    aria-describedby={amountError ? "topup-error" : "topup-preview"}
                    className="billing-amount-input h-12 w-full rounded-xl border border-input bg-transparent pr-4 pl-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <button
                  className="billing-plan-button billing-plan-button-dark px-5"
                  type="submit"
                  disabled={busy !== null || !view}
                >
                  {busy === "topup" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  {d.buyCredits}
                </button>
              </div>
              {amountError ? (
                <p
                  id="topup-error"
                  role="alert"
                  className="mt-2 flex items-center gap-1.5 text-sm text-red-700 dark:text-red-300"
                >
                  <CircleAlert className="size-4" />
                  {amountError}
                </p>
              ) : null}
              <p
                id="topup-preview"
                className="mt-3 text-sm text-muted-foreground"
                aria-live="polite"
              >
                {validAmount
                  ? fill(d.billingUi.creditPreview, { credits: format(usd * 100) })
                  : d.topupHint}
              </p>
            </form>
          </section>
        </div>

        <section className="mt-10" aria-label={d.billingUi.invoices}>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-medium tracking-tight">
            <Receipt className="size-5 text-muted-foreground" />
            {d.billingUi.invoices}
          </h2>
          {view?.invoices.length ? (
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-secondary/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-4 font-medium">{d.billingUi.date}</th>
                    <th className="px-5 py-4 font-medium">{d.billingUi.status}</th>
                    <th className="px-5 py-4 font-medium">{d.billingUi.amount}</th>
                    <th className="px-5 py-4 font-medium">
                      <span className="sr-only">{d.billingUi.invoice}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {view.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="px-5 py-4">{date(inv.createdAt)}</td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs">
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-medium">
                        {money(inv.amountPaidUsdCents / 100, inv.currency.toUpperCase())}
                      </td>
                      <td className="px-5 py-4 text-right">
                        {inv.hostedInvoiceUrl ? (
                          <a
                            href={inv.hostedInvoiceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-sm underline underline-offset-4"
                          >
                            {d.billingUi.viewInvoice}
                            <ArrowUpRight className="size-3.5" />
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
              {view ? d.billingUi.noInvoices : d.loading}
            </p>
          )}
        </section>
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-xs text-muted-foreground">
          <span>{d.billingUi.footerNote}</span>
          <Link href="/chat" className="billing-back flex items-center gap-1.5">
            <ArrowLeft className="size-3.5" />
            {d.billingUi.backToChat}
          </Link>
        </footer>
      </main>
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
