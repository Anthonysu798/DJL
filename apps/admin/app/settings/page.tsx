"use client";
import { PageCard, headRowClass, rowClass } from "@/components/PageCard";
import { ReasonDialog } from "@/components/ReasonDialog";
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

interface Setting {
  key: string;
  value: unknown;
  updatedBy: string | null;
  updatedAt: string;
}
const KNOWN = [
  "trial.credits",
  "trial.expiry_days",
  "trial.daily_budget_usd_cents",
  "gateway.soft_cap_streams",
  "gateway.hard_cap_streams",
  "pricing.margin",
  "admin.ip_allowlist",
];

export default function SettingsPage() {
  const settings = useLoad(() => admin<Setting[]>("/settings"), []);
  const rows = [...(settings.data ?? [])];
  for (const key of KNOWN)
    if (!rows.some((r) => r.key === key))
      rows.push({ key, value: null, updatedBy: null, updatedAt: "" });
  return (
    <Shell
      title="Settings"
      subtitle="Runtime knobs the API reads on each use. admin.ip_allowlist is a JSON array of IPs or CIDRs; an empty list allows every network, so set it before production."
    >
      <PageCard>
        {settings.error ? (
          <p role="alert" className="text-sm text-destructive">
            {settings.error}
          </p>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow className={headRowClass}>
              <TableHead>Key</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.key} className={rowClass}>
                <TableCell>{s.key}</TableCell>
                <TableCell className="font-mono text-xs">{JSON.stringify(s.value)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {s.updatedAt ? new Date(s.updatedAt).toLocaleString() : "default"}
                </TableCell>
                <TableCell className="text-right">
                  <ReasonDialog
                    trigger={
                      <Button size="sm" variant="secondary">
                        Edit
                      </Button>
                    }
                    title={`Set ${s.key}`}
                    description={'Enter JSON, for example 200, 0.4, or ["1.2.3.4/32"].'}
                    fields={[
                      {
                        name: "value",
                        label: "Value (JSON)",
                        defaultValue: JSON.stringify(s.value ?? null),
                      },
                    ]}
                    confirmLabel="Save"
                    onConfirm={async (v, reason) => {
                      let value: unknown;
                      try {
                        value = JSON.parse(v.value ?? "null");
                      } catch {
                        throw new Error("Value must be valid JSON.");
                      }
                      await admin(`/settings/${s.key}`, { method: "PUT", json: { value, reason } });
                      settings.reload();
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PageCard>
    </Shell>
  );
}
