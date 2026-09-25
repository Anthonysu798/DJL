"use client";
import { PageCard, headRowClass, rowClass } from "@/components/PageCard";
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

interface Model {
  modelId: string;
  provider: string;
  displayName: string;
  status: "active" | "degraded" | "disabled";
  qualityScore: number;
  inputMicroPerToken: string;
  outputMicroPerToken: string;
  microPerImage: string;
  sortOrder: number;
  capabilities: string[];
}

const STATUS_STYLE: Record<Model["status"], string> = {
  active: "bg-primary",
  degraded: "bg-chart-2",
  disabled: "bg-chart-5",
};

export default function ModelsPage() {
  const models = useLoad(() => admin<Model[]>("/models"), []);
  return (
    <Shell
      title="Model catalog"
      subtitle="Prices are microcredits per token or per image (1 credit = 1,000,000 microcredits). Edits take effect within 30 seconds and are audited."
    >
      <PageCard>
        {models.error ? (
          <p role="alert" className="text-sm text-destructive">
            {models.error}
          </p>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow className={headRowClass}>
              <TableHead>Model</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Quality</TableHead>
              <TableHead>Input µcr/tok</TableHead>
              <TableHead>Output µcr/tok</TableHead>
              <TableHead>µcr/image</TableHead>
              <TableHead>Capabilities</TableHead>
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
                <TableCell>{m.provider}</TableCell>
                <TableCell>
                  <ReasonDialog
                    trigger={
                      <button type="button" className="flex items-center gap-2 text-sm">
                        <span className={`size-2 rounded-full ${STATUS_STYLE[m.status]}`} />
                        {m.status}
                      </button>
                    }
                    title={`Change status of ${m.displayName}`}
                    fields={[
                      {
                        name: "status",
                        label: "Status",
                        kind: "select",
                        options: [
                          { value: "active", label: "Active" },
                          { value: "degraded", label: "Degraded · routed around when possible" },
                          { value: "disabled", label: "Disabled · hidden from clients" },
                        ],
                        defaultValue: m.status,
                        validate: oneOf(["active", "degraded", "disabled"], "Status"),
                      },
                    ]}
                    confirmLabel="Save"
                    onConfirm={(v, reason) =>
                      admin(`/models/${m.modelId}`, {
                        method: "PATCH",
                        json: { status: v.status, reason },
                      }).then(models.reload)
                    }
                  />
                </TableCell>
                <TableCell className="tabular-nums">{m.qualityScore}</TableCell>
                <TableCell className="tabular-nums">{m.inputMicroPerToken}</TableCell>
                <TableCell className="tabular-nums">{m.outputMicroPerToken}</TableCell>
                <TableCell className="tabular-nums">{m.microPerImage}</TableCell>
                <TableCell>
                  {m.capabilities.map((c) => (
                    <Badge key={c} variant="secondary" className="mr-1 mb-1">
                      {c}
                    </Badge>
                  ))}
                </TableCell>
                <TableCell className="text-right">
                  <ReasonDialog
                    trigger={
                      <Button size="sm" variant="secondary">
                        Edit
                      </Button>
                    }
                    title={`Edit ${m.displayName}`}
                    description="Leave a field unchanged to keep its value."
                    fields={[
                      {
                        name: "qualityScore",
                        label: "Quality score",
                        inputMode: "numeric",
                        validate: integer(0, 100, "Quality score"),
                        defaultValue: String(m.qualityScore),
                      },
                      {
                        name: "inputMicroPerToken",
                        label: "Input microcredits per token",
                        inputMode: "numeric",
                        validate: integer(0, 1_000_000_000_000, "Input microcredits per token"),
                        defaultValue: m.inputMicroPerToken,
                      },
                      {
                        name: "outputMicroPerToken",
                        label: "Output microcredits per token",
                        inputMode: "numeric",
                        validate: integer(0, 1_000_000_000_000, "Output microcredits per token"),
                        defaultValue: m.outputMicroPerToken,
                      },
                      {
                        name: "microPerImage",
                        label: "Microcredits per image",
                        inputMode: "numeric",
                        validate: integer(0, 1_000_000_000_000, "Microcredits per image"),
                        defaultValue: m.microPerImage,
                      },
                      {
                        name: "sortOrder",
                        label: "Sort order",
                        inputMode: "numeric",
                        validate: integer(0, 100000, "Sort order"),
                        defaultValue: String(m.sortOrder),
                      },
                    ]}
                    confirmLabel="Save"
                    onConfirm={(v, reason) =>
                      admin(`/models/${m.modelId}`, {
                        method: "PATCH",
                        json: {
                          qualityScore: Number(v.qualityScore),
                          inputMicroPerToken: v.inputMicroPerToken,
                          outputMicroPerToken: v.outputMicroPerToken,
                          microPerImage: v.microPerImage,
                          sortOrder: Number(v.sortOrder),
                          reason,
                        },
                      }).then(models.reload)
                    }
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
