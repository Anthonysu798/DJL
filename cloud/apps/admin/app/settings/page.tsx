"use client";
import { PageCard, headRowClass, rowClass } from "@/components/PageCard";
import { ReasonDialog, type ReasonField } from "@/components/ReasonDialog";
import { Shell } from "@/components/Shell";
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
import { useI18n } from "@/components/LocaleProvider";
import { decimal, integer, ipList, parseIpList } from "@/lib/validation";

interface Setting {
  key: string;
  value: unknown;
  updatedBy: string | null;
  updatedAt: string;
}

/**
 * Every knob has a typed editor: what it means, its unit, its allowed range,
 * how the stored value is shown, and how the form value becomes JSON. The API
 * stores JSON, so nothing here changes the wire format.
 */
interface Def {
  label: string;
  description: string;
  group: string;
  field: ReasonField;
  show: (v: unknown) => string;
  parse: (s: string) => unknown;
}
export default function SettingsPage() {
  const { t, number, currency, date, percent } = useI18n();
  const usd = (cents: number) => currency(cents / 100);
  const int = (
    name: string,
    label: string,
    min: number,
    max: number,
    hint?: string,
  ): ReasonField => ({
    name,
    label,
    inputMode: "numeric",
    validate: integer(min, max, label),
    hint: hint ?? t("settings.integerHint", { min: number(min), max: number(max) }),
  });
  const DEFS: Record<string, Def> = {
    "trial.credits": {
      group: t("plan.trial"),
      label: t("settings.trialCredits"),
      description: t("settings.trialHint"),
      field: int("value", t("settings.credits"), 0, 10_000),
      show: (v) => t("settings.creditValue", { count: number(Number(v ?? 0)) }),
      parse: Number,
    },
    "trial.expiry_days": {
      group: t("plan.trial"),
      label: t("settings.expiry"),
      description: t("settings.expiryHint"),
      field: int("value", t("settings.days"), 1, 365),
      show: (v) => t("settings.dayValue", { count: number(Number(v ?? 0)) }),
      parse: Number,
    },
    "trial.daily_budget_usd_cents": {
      group: t("plan.trial"),
      label: t("settings.dailyBudget"),
      description: t("settings.dailyHint"),
      field: int("value", t("settings.budgetCents"), 0, 100_000_000, t("settings.centsHint")),
      show: (v) => t("settings.dailyValue", { amount: usd(Number(v ?? 0)) }),
      parse: Number,
    },
    "gateway.soft_cap_streams": {
      group: t("settings.gateway"),
      label: t("settings.softStreams"),
      description: t("settings.softHint"),
      field: int("value", t("settings.streams"), 1, 10_000),
      show: (v) => t("settings.streamCount", { count: number(Number(v ?? 0)) }),
      parse: Number,
    },
    "gateway.hard_cap_streams": {
      group: t("settings.gateway"),
      label: t("settings.hardStreams"),
      description: t("settings.hardHint"),
      field: int("value", t("settings.streams"), 1, 10_000),
      show: (v) => t("settings.streamCount", { count: number(Number(v ?? 0)) }),
      parse: Number,
    },
    "gateway.ip_requests_per_minute": {
      group: t("settings.gateway"),
      label: t("settings.networkRequests"),
      description: t("settings.networkHint"),
      field: int("value", t("plans.rpm"), 1, 1_000_000),
      show: (v) => t("settings.perMinute", { count: number(Number(v ?? 0)) }),
      parse: Number,
    },
    "pricing.margin": {
      group: t("settings.pricing"),
      label: t("settings.marginTitle"),
      description: t("settings.marginHint"),
      field: {
        name: "value",
        label: t("settings.margin"),
        inputMode: "decimal",
        validate: decimal(0, 0.95, 3, t("settings.margin")),
        hint: t("settings.decimalHint"),
      },
      show: (v) => percent(Number(v ?? 0)),
      parse: Number,
    },
    "admin.ip_allowlist": {
      group: t("settings.consoleSecurity"),
      label: t("settings.allowed"),
      description: t("settings.allowedHint"),
      field: {
        name: "value",
        label: t("settings.ipLine"),
        kind: "textarea",
        validate: ipList,
        placeholder: "203.0.113.0/24\n2001:db8::1",
        hint: t("settings.emptyNetworks"),
      },
      show: (v) =>
        Array.isArray(v) && v.length
          ? t("settings.entries", { count: number(v.length) })
          : t("settings.everyNetwork"),
      parse: parseIpList,
    },
    "admin.ip_blocklist": {
      group: t("settings.consoleSecurity"),
      label: t("settings.blocked"),
      description: t("settings.blockedHint"),
      field: {
        name: "value",
        label: t("settings.ipLine"),
        kind: "textarea",
        validate: ipList,
        placeholder: "198.51.100.7",
      },
      show: (v) =>
        Array.isArray(v) && v.length
          ? t("settings.blockedCount", { count: number(v.length) })
          : t("common.none"),
      parse: parseIpList,
    },
  };
  const asText = (v: unknown) =>
    Array.isArray(v) ? v.join("\n") : v === null || v === undefined ? "" : String(v);

  const settings = useLoad(() => admin<Setting[]>("/settings"), []);
  const byKey = new Map((settings.data ?? []).map((s) => [s.key, s]));
  const groups = [
    { id: "trial", label: t("plan.trial") },
    { id: "gateway", label: t("settings.gateway") },
    { id: "pricing", label: t("settings.pricing") },
    { id: "admin", label: t("settings.consoleSecurity") },
  ];
  return (
    <Shell title={t("nav.settings")} subtitle={t("settings.description")}>
      {settings.error ? (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {settings.error}
        </p>
      ) : null}
      <div className="space-y-5">
        {groups.map((group) => (
          <PageCard key={group.id} title={group.label}>
            <Table>
              <TableHeader>
                <TableRow className={headRowClass}>
                  <TableHead className="w-[42%]">{t("settings.setting")}</TableHead>
                  <TableHead>{t("common.value")}</TableHead>
                  <TableHead>{t("settings.updated")}</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(DEFS)
                  .filter(([, d]) => d.group === group.label)
                  .map(([key, d]) => {
                    const s = byKey.get(key);
                    return (
                      <TableRow key={key} className={`${rowClass} h-16`}>
                        <TableCell>
                          <div className="font-medium">{d.label}</div>
                          <div className="text-xs text-muted-foreground">{d.description}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                            {key}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium tabular-nums">
                          {d.show(s?.value)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {s?.updatedAt
                            ? date(s.updatedAt, { dateStyle: "medium", timeStyle: "short" })
                            : t("common.default")}
                        </TableCell>
                        <TableCell className="text-right">
                          <ReasonDialog
                            trigger={
                              <Button size="sm" variant="outline">
                                {t("common.edit")}
                              </Button>
                            }
                            title={d.label}
                            description={d.description}
                            fields={[{ ...d.field, defaultValue: asText(s?.value) }]}
                            confirmLabel={t("common.save")}
                            onConfirm={async (v, reason) => {
                              await admin(`/settings/${key}`, {
                                method: "PUT",
                                json: { value: d.parse(v.value ?? ""), reason },
                              });
                              settings.reload();
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </PageCard>
        ))}
      </div>
    </Shell>
  );
}
