"use client";
import { statusLabel } from "@/lib/i18n/status";
import { useI18n } from "@/components/LocaleProvider";
import { useState } from "react";

import { PageCard, StatusPill, headRowClass, rowClass } from "@/components/PageCard";
import { ReasonDialog } from "@/components/ReasonDialog";
import { Shell } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { admin } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { integer, oneOf } from "@/lib/validation";

interface Plan {
  id: string;
  name: string;
  includedMicrocredits: string;
  window5hMicro: string;
  windowWeekMicro: string;
}
interface Schedule {
  planId: string;
  everyDays: number;
  banksPerGrant: number;
  active: boolean;
  lastGrantedAt: string | null;
}
interface Batch {
  id: string;
  source: "bulk" | "plan_schedule";
  planId: string | null;
  reason: string | null;
  status: string;
  grantedCount: number;
  createdAt: string;
}
interface Model {
  modelId: string;
  displayName: string;
  status: string;
  freeEligible: boolean;
}

const MICRO = 1_000_000n;
/** Whole credits typed by the admin → microcredits as the API expects them. */
const toMicro = (wholeCredits: string) => (BigInt(wholeCredits.trim()) * MICRO).toString();
const wholeCredits = (micro: string) => (BigInt(micro) / MICRO).toString();
const capRule = (label: string) => integer(0, 100_000_000, label);

export default function UsagePage() {
  const { t, date, number, credits } = useI18n();
  const plans = useLoad(() => admin<Plan[]>("/plans"), []);
  const schedules = useLoad(() => admin<Schedule[]>("/usage/schedules"), []);
  const batches = useLoad(() => admin<Batch[]>("/usage/batches"), []);
  const models = useLoad(() => admin<Model[]>("/models"), []);
  const error = plans.error ?? schedules.error ?? batches.error ?? models.error;
  const [resetDone, setResetDone] = useState<Date | null>(null);
  const free = plans.data?.find((p) => p.id === "free");
  const planOptions = [
    { value: "everyone", label: t("common.everyone") },
    ...(plans.data ?? []).map((p) => ({
      value: p.id,
      label: t("usage.planOption", { name: p.name }),
    })),
  ];

  return (
    <Shell title={t("nav.usage")} subtitle={t("usage.description")}>
      {error ? (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="space-y-4">
        <PageCard title={t("usage.caps")}>
          <Table>
            <TableHeader>
              <TableRow className={headRowClass}>
                <TableHead>{t("common.plan")}</TableHead>
                <TableHead>{t("usage.fiveCap")}</TableHead>
                <TableHead>{t("usage.weekCap")}</TableHead>
                <TableHead>{t("usage.scheduled")}</TableHead>
                <TableHead>{t("usage.lastGranted")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.data?.map((p) => {
                const s = schedules.data?.find((x) => x.planId === p.id);
                return (
                  <TableRow key={p.id} className={rowClass}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="tabular-nums">{credits(p.window5hMicro)}</TableCell>
                    <TableCell className="tabular-nums">{credits(p.windowWeekMicro)}</TableCell>
                    <TableCell>
                      {s?.active ? (
                        t("usage.cadence", {
                          count: number(s.banksPerGrant),
                          days: number(s.everyDays),
                        })
                      ) : (
                        <span className="text-muted-foreground">
                          {s ? t("common.paused") : t("common.none")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s?.lastGrantedAt
                        ? date(s.lastGrantedAt, { dateStyle: "medium", timeStyle: "short" })
                        : "—"}
                    </TableCell>
                    <TableCell className="space-x-2 text-right whitespace-nowrap">
                      <ReasonDialog
                        trigger={
                          <Button size="sm" variant="secondary">
                            {t("usage.editCaps")}
                          </Button>
                        }
                        title={t("usage.windowCaps", { name: p.name })}
                        description={t("usage.wholeDescription")}
                        fields={[
                          {
                            name: "fiveHour",
                            label: t("usage.fiveCredits"),
                            inputMode: "numeric",
                            validate: capRule(t("usage.fiveCap")),
                            defaultValue: wholeCredits(p.window5hMicro),
                          },
                          {
                            name: "week",
                            label: t("usage.weekCredits"),
                            inputMode: "numeric",
                            validate: capRule(t("usage.weekCap")),
                            defaultValue: wholeCredits(p.windowWeekMicro),
                          },
                        ]}
                        confirmLabel={t("common.save")}
                        onConfirm={(v, reason) =>
                          admin(`/plans/${p.id}`, {
                            method: "PATCH",
                            json: {
                              window5hMicro: toMicro(v.fiveHour!),
                              windowWeekMicro: toMicro(v.week!),
                              reason,
                            },
                          }).then(plans.reload)
                        }
                      />
                      <ReasonDialog
                        trigger={
                          <Button size="sm" variant="secondary">
                            {t("usage.schedule")}
                          </Button>
                        }
                        title={t("usage.scheduleFor", { name: p.name })}
                        description={t("usage.scheduleDescription")}
                        fields={[
                          {
                            name: "everyDays",
                            label: t("usage.everyDays"),
                            inputMode: "numeric",
                            validate: integer(1, 365, t("settings.days")),
                            defaultValue: String(s?.everyDays ?? 30),
                          },
                          {
                            name: "banksPerGrant",
                            label: t("usage.banksPerGrant"),
                            inputMode: "numeric",
                            validate: integer(1, 10, t("usage.banksPerGrant")),
                            defaultValue: String(s?.banksPerGrant ?? 1),
                          },
                          {
                            name: "active",
                            label: t("common.state"),
                            kind: "select",
                            options: [
                              { value: "on", label: t("common.active") },
                              { value: "off", label: t("common.paused") },
                            ],
                            validate: oneOf(["on", "off"], t("common.state")),
                            defaultValue: s && !s.active ? "off" : "on",
                          },
                        ]}
                        confirmLabel={t("common.save")}
                        onConfirm={(v, reason) =>
                          admin(`/usage/schedules/${p.id}`, {
                            method: "PUT",
                            json: {
                              everyDays: Number(v.everyDays),
                              banksPerGrant: Number(v.banksPerGrant),
                              active: v.active === "on",
                              reason,
                            },
                          }).then(schedules.reload)
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </PageCard>

        <div className="grid gap-4 xl:grid-cols-2">
          <PageCard
            title={t("usage.freeAllowance")}
            action={
              free ? (
                <ReasonDialog
                  trigger={
                    <Button size="sm" variant="secondary">
                      {t("common.edit")}
                    </Button>
                  }
                  title={t("usage.weekAllowance")}
                  description={t("usage.freeDescription")}
                  fields={[
                    {
                      name: "credits",
                      label: t("usage.creditsWeek"),
                      inputMode: "numeric",
                      validate: integer(0, 100_000, t("usage.creditsWeek")),
                      defaultValue: wholeCredits(free.includedMicrocredits),
                    },
                  ]}
                  confirmLabel={t("common.save")}
                  onConfirm={(v, reason) =>
                    admin("/plans/free", {
                      method: "PATCH",
                      json: { includedMicrocredits: toMicro(v.credits!), reason },
                    }).then(plans.reload)
                  }
                />
              ) : null
            }
          >
            <div className="text-3xl font-semibold tabular-nums">
              {free ? credits(free.includedMicrocredits) : "—"}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                {t("usage.weekUnit")}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t("usage.spendFirst")}</p>
            <Table className="mt-4">
              <TableHeader>
                <TableRow className={headRowClass}>
                  <TableHead>{t("common.model")}</TableHead>
                  <TableHead>{t("usage.freeAllowance")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.data?.map((m) => (
                  <TableRow key={m.modelId} className={rowClass}>
                    <TableCell>
                      <div className="font-medium">{m.displayName}</div>
                      <div className="text-xs text-muted-foreground">{m.modelId}</div>
                    </TableCell>
                    <TableCell>
                      {m.freeEligible ? (
                        <StatusPill tone="success">{t("usage.eligible")}</StatusPill>
                      ) : (
                        <StatusPill tone="neutral">{t("usage.paidOnly")}</StatusPill>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <ReasonDialog
                        trigger={
                          <Button size="sm" variant="secondary">
                            {m.freeEligible ? t("team.remove") : t("common.allow")}
                          </Button>
                        }
                        title={t("usage.freeAction", {
                          action: m.freeEligible ? t("team.remove") : t("common.allow"),
                          name: m.displayName,
                        })}
                        confirmLabel={t("common.save")}
                        onConfirm={(_v, reason) =>
                          admin(`/models/${m.modelId}`, {
                            method: "PATCH",
                            json: { freeEligible: !m.freeEligible, reason },
                          }).then(models.reload)
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PageCard>

          <PageCard
            title={t("usage.bulk")}
            action={
              <ReasonDialog
                trigger={<Button size="sm">{t("usage.grantReset")}</Button>}
                title={t("usage.grantOne")}
                description={t("usage.queueDescription")}
                fields={[
                  {
                    name: "planId",
                    label: t("common.who"),
                    kind: "select",
                    options: planOptions,
                    validate: oneOf(
                      planOptions.map((o) => o.value),
                      t("common.who"),
                    ),
                    defaultValue: "everyone",
                  },
                ]}
                confirmLabel={t("usage.queueGrant")}
                onConfirm={(v, reason) =>
                  admin("/usage/batches", {
                    method: "POST",
                    json: {
                      planId: v.planId === "everyone" ? null : v.planId,
                      reason,
                      idempotencyKey: crypto.randomUUID(),
                    },
                  }).then(batches.reload)
                }
              />
            }
          >
            {batches.data?.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("usage.noGrants")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className={headRowClass}>
                    <TableHead>{t("common.when")}</TableHead>
                    <TableHead>{t("common.who")}</TableHead>
                    <TableHead>{t("usage.banks")}</TableHead>
                    <TableHead>{t("common.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.data?.map((b) => (
                    <TableRow key={b.id} className={rowClass}>
                      <TableCell className="text-muted-foreground">
                        {date(b.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                      </TableCell>
                      <TableCell>
                        {b.planId ?? t("common.everyone")}
                        <div className="text-xs text-muted-foreground">
                          {b.source === "plan_schedule" ? t("usage.schedule") : (b.reason ?? "")}
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums">{number(b.grantedCount)}</TableCell>
                      <TableCell>
                        <Badge variant={b.status === "failed" ? "destructive" : "secondary"}>
                          {statusLabel(b.status, t)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </PageCard>
        </div>

        <PageCard title={t("usage.resetEveryone")}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-2xl text-sm text-muted-foreground">{t("usage.resetDescription")}</p>
            <ReasonDialog
              trigger={<Button variant="destructive">{t("usage.resetEveryone")}</Button>}
              title={t("usage.resetTitle")}
              description={t("usage.resetConfirm")}
              destructive
              fields={[
                {
                  name: "confirm",
                  label: t("common.confirmation"),
                  placeholder: "RESET",
                  validate: (v) => (v.trim() === "RESET" ? null : t("validation.reset")),
                },
              ]}
              confirmLabel={t("usage.resetEveryone")}
              onConfirm={(v, reason) =>
                admin("/usage/reset-all", {
                  method: "POST",
                  json: { confirm: v.confirm!.trim(), reason },
                }).then(() => setResetDone(new Date()))
              }
            />
          </div>
          {resetDone ? (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              {t("usage.resetDone", {
                date: date(resetDone, { dateStyle: "medium", timeStyle: "short" }),
              })}
            </p>
          ) : null}
        </PageCard>
      </div>
    </Shell>
  );
}
