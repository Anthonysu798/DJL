"use client";
import { ShieldAlert, ShieldCheck } from "lucide-react";

import { PageCard } from "@/components/PageCard";
import { ReasonDialog } from "@/components/ReasonDialog";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { admin } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { useI18n } from "@/components/LocaleProvider";

interface Switch {
  name: "gateway" | "billing" | "sync";
  engaged: boolean;
  reason: string | null;
  changedBy: string | null;
  changedAt: string;
}

export default function SwitchesPage() {
  const { t, date } = useI18n();
  const DESCRIPTION = {
    gateway: t("switches.gatewayHint"),
    billing: t("switches.billingHint"),
    sync: t("switches.syncHint"),
  };
  const switches = useLoad(() => admin<Switch[]>("/kill-switches"), []);
  return (
    <Shell title={t("nav.switches")} subtitle={t("switches.description")}>
      {switches.error ? (
        <p role="alert" className="text-sm text-destructive">
          {switches.error}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        {switches.data?.map((s) => (
          <PageCard
            key={s.name}
            title={t(`switches.${s.name}`)}
            action={
              s.engaged ? (
                <ShieldAlert className="size-5 text-chart-5" />
              ) : (
                <ShieldCheck className="size-5 text-primary" />
              )
            }
          >
            <p className="text-sm text-muted-foreground">{DESCRIPTION[s.name]}</p>
            <p className="mt-4 text-sm">
              {s.engaged ? (
                <span className="font-medium text-chart-5">{t("switches.engaged")}</span>
              ) : (
                <span className="font-medium">{t("switches.released")}</span>
              )}
              {s.reason ? <span className="text-muted-foreground"> · {s.reason}</span> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {date(s.changedAt, { dateStyle: "medium", timeStyle: "short" })}
            </p>
            <ReasonDialog
              trigger={
                <Button className="mt-4 w-full" variant={s.engaged ? "default" : "destructive"}>
                  {t(s.engaged ? "switches.release" : "switches.engage")}
                </Button>
              }
              title={t("switches.actionTitle", {
                action: t(s.engaged ? "switches.release" : "switches.engage"),
                target: t(`switches.${s.name}`),
              })}
              description={s.engaged ? undefined : t("switches.everyUser")}
              destructive={!s.engaged}
              confirmLabel={t(s.engaged ? "switches.release" : "switches.engage")}
              onConfirm={(_v, reason) =>
                admin(`/kill-switches/${s.name}`, {
                  method: "PUT",
                  json: { engaged: !s.engaged, reason },
                }).then(switches.reload)
              }
            />
          </PageCard>
        ))}
      </div>
    </Shell>
  );
}
