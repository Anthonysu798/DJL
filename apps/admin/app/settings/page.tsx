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
import { admin, usd } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
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
  hint: hint ?? `Whole number between ${min.toLocaleString()} and ${max.toLocaleString()}.`,
});
const DEFS: Record<string, Def> = {
  "trial.credits": {
    group: "Trial",
    label: "Trial credits",
    description: "Credits granted once phone verification and the first real request succeed.",
    field: int("value", "Credits", 0, 10_000),
    show: (v) => `${Number(v ?? 0).toLocaleString()} credits`,
    parse: Number,
  },
  "trial.expiry_days": {
    group: "Trial",
    label: "Trial expiry",
    description: "Unused trial credits expire this many days after the grant.",
    field: int("value", "Days", 1, 365),
    show: (v) => `${Number(v ?? 0)} days`,
    parse: Number,
  },
  "trial.daily_budget_usd_cents": {
    group: "Trial",
    label: "Daily trial budget",
    description: "Global cap on trial credits granted per day. Overflow waits in the trial queue.",
    field: int(
      "value",
      "Budget in cents",
      0,
      100_000_000,
      "Whole number of US cents, for example 10000 for $100.00.",
    ),
    show: (v) => `${usd(Number(v ?? 0))} per day`,
    parse: Number,
  },
  "gateway.soft_cap_streams": {
    group: "Gateway",
    label: "Soft cap on streams",
    description: "Above this many in-flight streams per instance, trial traffic is deprioritized.",
    field: int("value", "Streams", 1, 10_000),
    show: (v) => `${Number(v ?? 0).toLocaleString()} streams`,
    parse: Number,
  },
  "gateway.hard_cap_streams": {
    group: "Gateway",
    label: "Hard cap on streams",
    description:
      "Above this many in-flight streams per instance, new requests are refused and autoscaling adds capacity.",
    field: int("value", "Streams", 1, 10_000),
    show: (v) => `${Number(v ?? 0).toLocaleString()} streams`,
    parse: Number,
  },
  "pricing.margin": {
    group: "Pricing",
    label: "Margin over provider cost",
    description: "Applied when credit prices are derived from provider prices. 0.4 means 40%.",
    field: {
      name: "value",
      label: "Margin",
      inputMode: "decimal",
      validate: decimal(0, 0.95, 3, "Margin"),
      hint: "Decimal between 0 and 0.95, up to three places.",
    },
    show: (v) => `${Math.round(Number(v ?? 0) * 100)}%`,
    parse: Number,
  },
  "admin.ip_allowlist": {
    group: "Console security",
    label: "Allowed networks",
    description:
      "Only these IPs or CIDR ranges may reach the admin API. Empty allows every network, so set it before production.",
    field: {
      name: "value",
      label: "One IP or CIDR per line",
      kind: "textarea",
      validate: ipList,
      placeholder: "203.0.113.0/24\n2001:db8::1",
      hint: "Leave empty to allow every network (local development only).",
    },
    show: (v) =>
      Array.isArray(v) && v.length
        ? `${v.length} ${v.length === 1 ? "entry" : "entries"}`
        : "Every network",
    parse: parseIpList,
  },
  "admin.ip_blocklist": {
    group: "Console security",
    label: "Blocked networks",
    description:
      "Refused before anything else, even if allowed above. Managed from the Team page too.",
    field: {
      name: "value",
      label: "One IP or CIDR per line",
      kind: "textarea",
      validate: ipList,
      placeholder: "198.51.100.7",
    },
    show: (v) => (Array.isArray(v) && v.length ? `${v.length} blocked` : "None"),
    parse: parseIpList,
  },
};
const asText = (key: string, v: unknown) =>
  Array.isArray(v) ? v.join("\n") : v === null || v === undefined ? "" : String(v);

export default function SettingsPage() {
  const settings = useLoad(() => admin<Setting[]>("/settings"), []);
  const byKey = new Map((settings.data ?? []).map((s) => [s.key, s]));
  const groups = [...new Set(Object.values(DEFS).map((d) => d.group))];
  return (
    <Shell
      title="Settings"
      subtitle="Runtime knobs the API reads on every use. Each change is audited with a reason."
    >
      {settings.error ? (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {settings.error}
        </p>
      ) : null}
      <div className="space-y-5">
        {groups.map((group) => (
          <PageCard key={group} title={group}>
            <Table>
              <TableHeader>
                <TableRow className={headRowClass}>
                  <TableHead className="w-[42%]">Setting</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(DEFS)
                  .filter(([, d]) => d.group === group)
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
                          {s?.updatedAt ? new Date(s.updatedAt).toLocaleString() : "Default"}
                        </TableCell>
                        <TableCell className="text-right">
                          <ReasonDialog
                            trigger={
                              <Button size="sm" variant="outline">
                                Edit
                              </Button>
                            }
                            title={d.label}
                            description={d.description}
                            fields={[{ ...d.field, defaultValue: asText(key, s?.value) }]}
                            confirmLabel="Save"
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
