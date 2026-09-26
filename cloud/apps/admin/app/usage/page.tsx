"use client";
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
import { admin, credits } from "@/lib/api";
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
  const plans = useLoad(() => admin<Plan[]>("/plans"), []);
  const schedules = useLoad(() => admin<Schedule[]>("/usage/schedules"), []);
  const batches = useLoad(() => admin<Batch[]>("/usage/batches"), []);
  const models = useLoad(() => admin<Model[]>("/models"), []);
  const error = plans.error ?? schedules.error ?? batches.error ?? models.error;
  const [resetDone, setResetDone] = useState<string | null>(null);
  const free = plans.data?.find((p) => p.id === "free");
  const planOptions = [
    { value: "everyone", label: "Everyone" },
    ...(plans.data ?? []).map((p) => ({ value: p.id, label: `${p.name} plan` })),
  ];

  return (
    <Shell
      title="Usage windows"
      subtitle="Credits still pay; each plan also caps spend per rolling 5 hours and per week. Banked resets let users zero both windows themselves."
    >
      {error ? (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="space-y-4">
        <PageCard title="Caps and scheduled resets">
          <Table>
            <TableHeader>
              <TableRow className={headRowClass}>
                <TableHead>Plan</TableHead>
                <TableHead>5-hour cap</TableHead>
                <TableHead>Weekly cap</TableHead>
                <TableHead>Scheduled resets</TableHead>
                <TableHead>Last granted</TableHead>
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
                        `${s.banksPerGrant} every ${s.everyDays} ${s.everyDays === 1 ? "day" : "days"}`
                      ) : (
                        <span className="text-muted-foreground">{s ? "Paused" : "None"}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s?.lastGrantedAt ? new Date(s.lastGrantedAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="space-x-2 text-right whitespace-nowrap">
                      <ReasonDialog
                        trigger={
                          <Button size="sm" variant="secondary">
                            Edit caps
                          </Button>
                        }
                        title={`Window caps for ${p.name}`}
                        description="In whole credits. A request is refused once either window is full."
                        fields={[
                          {
                            name: "fiveHour",
                            label: "5-hour cap (credits)",
                            inputMode: "numeric",
                            validate: capRule("5-hour cap"),
                            defaultValue: wholeCredits(p.window5hMicro),
                          },
                          {
                            name: "week",
                            label: "Weekly cap (credits)",
                            inputMode: "numeric",
                            validate: capRule("Weekly cap"),
                            defaultValue: wholeCredits(p.windowWeekMicro),
                          },
                        ]}
                        confirmLabel="Save"
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
                            Schedule
                          </Button>
                        }
                        title={`Scheduled resets for ${p.name}`}
                        description="Every member of an org on this plan gets banked resets once per period. Banks expire after 90 days."
                        fields={[
                          {
                            name: "everyDays",
                            label: "Every (days)",
                            inputMode: "numeric",
                            validate: integer(1, 365, "Days"),
                            defaultValue: String(s?.everyDays ?? 30),
                          },
                          {
                            name: "banksPerGrant",
                            label: "Banks per grant",
                            inputMode: "numeric",
                            validate: integer(1, 10, "Banks per grant"),
                            defaultValue: String(s?.banksPerGrant ?? 1),
                          },
                          {
                            name: "active",
                            label: "State",
                            kind: "select",
                            options: [
                              { value: "on", label: "Active" },
                              { value: "off", label: "Paused" },
                            ],
                            validate: oneOf(["on", "off"], "State"),
                            defaultValue: s && !s.active ? "off" : "on",
                          },
                        ]}
                        confirmLabel="Save"
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
            title="Free allowance"
            action={
              free ? (
                <ReasonDialog
                  trigger={
                    <Button size="sm" variant="secondary">
                      Edit
                    </Button>
                  }
                  title="Weekly free allowance"
                  description="Granted every Monday (UTC) to each verified-email user; last week's remainder expires. 0 turns it off."
                  fields={[
                    {
                      name: "credits",
                      label: "Credits per week",
                      inputMode: "numeric",
                      validate: integer(0, 100_000, "Credits per week"),
                      defaultValue: wholeCredits(free.includedMicrocredits),
                    },
                  ]}
                  confirmLabel="Save"
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
              <span className="text-sm font-normal text-muted-foreground"> credits / week</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Spent before any other credits, and only on the models below.
            </p>
            <Table className="mt-4">
              <TableHeader>
                <TableRow className={headRowClass}>
                  <TableHead>Model</TableHead>
                  <TableHead>Free allowance</TableHead>
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
                        <StatusPill tone="success">Eligible</StatusPill>
                      ) : (
                        <StatusPill tone="neutral">Paid only</StatusPill>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <ReasonDialog
                        trigger={
                          <Button size="sm" variant="secondary">
                            {m.freeEligible ? "Remove" : "Allow"}
                          </Button>
                        }
                        title={`${m.freeEligible ? "Remove" : "Allow"} ${m.displayName} on the free allowance`}
                        confirmLabel="Save"
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
            title="Bulk grants"
            action={
              <ReasonDialog
                trigger={<Button size="sm">Grant banked reset</Button>}
                title="Grant one banked reset"
                description="Queues one bank for every matching user. The worker grants in batches within a minute; retries never grant twice."
                fields={[
                  {
                    name: "planId",
                    label: "Who",
                    kind: "select",
                    options: planOptions,
                    validate: oneOf(
                      planOptions.map((o) => o.value),
                      "Who",
                    ),
                    defaultValue: "everyone",
                  },
                ]}
                confirmLabel="Queue grant"
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
              <p className="text-sm text-muted-foreground">No grants yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className={headRowClass}>
                    <TableHead>When</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>Banks</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.data?.map((b) => (
                    <TableRow key={b.id} className={rowClass}>
                      <TableCell className="text-muted-foreground">
                        {new Date(b.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {b.planId ?? "Everyone"}
                        <div className="text-xs text-muted-foreground">
                          {b.source === "plan_schedule" ? "schedule" : (b.reason ?? "")}
                        </div>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {b.grantedCount.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={b.status === "failed" ? "destructive" : "secondary"}>
                          {b.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </PageCard>
        </div>

        <PageCard title="Reset everyone">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-2xl text-sm text-muted-foreground">
              Zeroes the 5-hour and weekly windows of every user right now. Credits and banked
              resets are not touched. The team is alerted and the reset is audited.
            </p>
            <ReasonDialog
              trigger={<Button variant="destructive">Reset everyone</Button>}
              title="Reset every user's windows"
              description="This cannot be undone. Type RESET to confirm."
              destructive
              fields={[
                {
                  name: "confirm",
                  label: "Confirmation",
                  placeholder: "RESET",
                  validate: (v) =>
                    v.trim() === "RESET" ? null : "Type RESET in capitals to confirm.",
                },
              ]}
              confirmLabel="Reset everyone"
              onConfirm={(v, reason) =>
                admin("/usage/reset-all", {
                  method: "POST",
                  json: { confirm: v.confirm!.trim(), reason },
                }).then(() =>
                  setResetDone(
                    `Every user's windows were reset at ${new Date().toLocaleString()}.`,
                  ),
                )
              }
            />
          </div>
          {resetDone ? (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              {resetDone}
            </p>
          ) : null}
        </PageCard>
      </div>
    </Shell>
  );
}
