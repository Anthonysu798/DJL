"use client";
import { ShieldAlert, ShieldCheck } from "lucide-react";

import { PageCard } from "@/components/PageCard";
import { ReasonDialog } from "@/components/ReasonDialog";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { admin } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

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
  return (
    <Shell
      title="Kill switches"
      subtitle="Each switch takes effect within seconds, is audited, and alerts the team."
    >
      {switches.error ? (
        <p role="alert" className="text-sm text-destructive">
          {switches.error}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        {switches.data?.map((s) => (
          <PageCard
            key={s.name}
            title={s.name}
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
                <span className="font-medium text-chart-5">Engaged</span>
              ) : (
                <span className="font-medium">Released</span>
              )}
              {s.reason ? <span className="text-muted-foreground"> · {s.reason}</span> : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(s.changedAt).toLocaleString()}
            </p>
            <ReasonDialog
              trigger={
                <Button className="mt-4 w-full" variant={s.engaged ? "default" : "destructive"}>
                  {s.engaged ? "Release" : "Engage"}
                </Button>
              }
              title={`${s.engaged ? "Release" : "Engage"} the ${s.name} kill switch`}
              description={s.engaged ? undefined : "This affects every user immediately."}
              destructive={!s.engaged}
              confirmLabel={s.engaged ? "Release" : "Engage"}
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
