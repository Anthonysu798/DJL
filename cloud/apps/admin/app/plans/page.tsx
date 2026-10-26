"use client";
import { PageCard } from "@/components/PageCard";
import { ReasonDialog } from "@/components/ReasonDialog";
import { Shell } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { admin } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { useI18n } from "@/components/LocaleProvider";
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
  const { t, number, currency, credits } = useI18n();
  const plans = useLoad(() => admin<Plan[]>("/plans"), []);
  return (
    <Shell title={t("nav.plans")} subtitle={t("plans.description")}>
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
              {currency(p.monthlyPriceUsdCents / 100)}
              <span className="text-sm font-normal text-muted-foreground">
                {t("common.monthSuffix")}
              </span>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {currency(p.annualPriceUsdCents / 100)}
              {t("common.yearSuffix")}
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("plans.includedCredits")}</dt>
                <dd className="tabular-nums">{credits(p.includedMicrocredits)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("plans.concurrent")}</dt>
                <dd>{p.concurrentStreams}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("plans.rpmShort")}</dt>
                <dd>{p.requestsPerMinute}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("plans.priority")}</dt>
                <dd>{p.priorityWeight}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("plans.syncQuota")}</dt>
                <dd>
                  {number(Number(p.syncQuotaBytes) / 1024 ** 3, { maximumFractionDigits: 1 })}{" "}
                  {t("common.gb")}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("plans.stripeMonthly")}</dt>
                <dd className="truncate font-mono text-xs">{p.stripeMonthlyPriceId ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t("plans.stripeAnnual")}</dt>
                <dd className="truncate font-mono text-xs">{p.stripeAnnualPriceId ?? "—"}</dd>
              </div>
            </dl>
            <ReasonDialog
              trigger={
                <Button className="mt-4 w-full" variant="secondary">
                  {t("plans.edit")}
                </Button>
              }
              title={t("models.editDialog", { model: p.name })}
              fields={[
                {
                  name: "monthlyPriceUsdCents",
                  label: t("plans.monthlyPrice"),
                  inputMode: "numeric",
                  validate: integer(0, 10000000, t("plans.monthlyPrice")),
                  defaultValue: String(p.monthlyPriceUsdCents),
                },
                {
                  name: "annualPriceUsdCents",
                  label: t("plans.annualPrice"),
                  inputMode: "numeric",
                  validate: integer(0, 100000000, t("plans.annualPrice")),
                  defaultValue: String(p.annualPriceUsdCents),
                },
                {
                  name: "includedMicrocredits",
                  label: t("plans.includedMicro"),
                  inputMode: "numeric",
                  validate: integer(0, 1_000_000_000_000_000, t("plans.includedMicro")),
                  defaultValue: p.includedMicrocredits,
                },
                {
                  name: "concurrentStreams",
                  label: t("plans.concurrent"),
                  inputMode: "numeric",
                  validate: integer(1, 10000, t("plans.concurrent")),
                  defaultValue: String(p.concurrentStreams),
                },
                {
                  name: "requestsPerMinute",
                  label: t("plans.rpm"),
                  inputMode: "numeric",
                  validate: integer(1, 100000, t("plans.rpm")),
                  defaultValue: String(p.requestsPerMinute),
                },
                {
                  name: "priorityWeight",
                  label: t("plans.priority"),
                  inputMode: "numeric",
                  validate: integer(1, 1000, t("plans.priority")),
                  defaultValue: String(p.priorityWeight),
                },
                {
                  name: "stripeMonthlyPriceId",
                  label: t("plans.stripeMonthlyId"),
                  hint: t("plans.stripeEmpty"),
                  validate: (v) =>
                    v.trim() === "" || /^price_[A-Za-z0-9]+$/.test(v.trim())
                      ? null
                      : t("validation.stripePrice"),
                  defaultValue: p.stripeMonthlyPriceId ?? "",
                },
                {
                  name: "stripeAnnualPriceId",
                  label: t("plans.stripeAnnualId"),
                  validate: (v) =>
                    v.trim() === "" || /^price_[A-Za-z0-9]+$/.test(v.trim())
                      ? null
                      : t("validation.stripePrice"),
                  defaultValue: p.stripeAnnualPriceId ?? "",
                },
              ]}
              confirmLabel={t("common.save")}
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
