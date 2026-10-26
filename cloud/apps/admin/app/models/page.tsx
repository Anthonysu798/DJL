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
import { useI18n } from "@/components/LocaleProvider";
import { integer, oneOf } from "@/lib/validation";

interface Model {
  modelId: string;
  provider: string;
  upstreamModelId: string;
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
  const { t, number } = useI18n();
  const models = useLoad(() => admin<Model[]>("/models"), []);
  return (
    <Shell title={t("models.title")} subtitle={t("models.pricingDescription")}>
      <PageCard>
        {models.error ? (
          <p role="alert" className="text-sm text-destructive">
            {models.error}
          </p>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow className={headRowClass}>
              <TableHead>{t("common.model")}</TableHead>
              <TableHead>{t("common.provider")}</TableHead>
              <TableHead>{t("common.status")}</TableHead>
              <TableHead>{t("common.quality")}</TableHead>
              <TableHead>{t("models.inputShort")}</TableHead>
              <TableHead>{t("models.outputShort")}</TableHead>
              <TableHead>{t("models.imageShort")}</TableHead>
              <TableHead>{t("common.capabilities")}</TableHead>
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
                  <ReasonDialog
                    trigger={
                      <Button size="sm" variant="outline">
                        {m.provider === "openrouter"
                          ? "OpenRouter"
                          : m.provider === "openai"
                            ? "OpenAI API"
                            : "Anthropic API"}
                      </Button>
                    }
                    title={t("models.sourceDialog", { model: m.displayName })}
                    description={t("models.securityHint")}
                    fields={[
                      {
                        name: "provider",
                        label: t("models.source"),
                        kind: "select",
                        defaultValue: m.provider,
                        options: [
                          { value: "openrouter", label: "OpenRouter" },
                          { value: "openai", label: "OpenAI API" },
                          { value: "anthropic", label: "Anthropic API" },
                        ],
                        validate: oneOf(
                          ["openrouter", "openai", "anthropic"],
                          t("common.provider"),
                        ),
                      },
                      {
                        name: "upstreamModelId",
                        label: t("models.upstream"),
                        defaultValue: m.upstreamModelId,
                        hint: t("models.slugHint"),
                      },
                      {
                        name: "coding",
                        label: t("models.codexTasks"),
                        kind: "select",
                        defaultValue: m.capabilities.includes("responses") ? "verified" : "off",
                        options: [
                          { value: "off", label: t("common.off") },
                          { value: "verified", label: t("models.responsesVerified") },
                        ],
                        hint: t("models.responsesHint"),
                      },
                    ]}
                    onConfirm={async (values, reason) => {
                      await admin(`/models/${encodeURIComponent(m.modelId)}`, {
                        method: "PATCH",
                        json: {
                          provider: values.provider,
                          upstreamModelId: values.upstreamModelId,
                          capabilities: [
                            ...m.capabilities.filter((c) => c !== "responses"),
                            ...(values.coding === "verified" ? ["responses"] : []),
                          ],
                          reason,
                        },
                      });
                      models.reload();
                    }}
                  />
                  <div className="mt-1 text-xs text-muted-foreground">{m.upstreamModelId}</div>
                </TableCell>
                <TableCell>
                  <ReasonDialog
                    trigger={
                      <button type="button" className="flex items-center gap-2 text-sm">
                        <span className={`size-2 rounded-full ${STATUS_STYLE[m.status]}`} />
                        {
                          {
                            active: t("common.active"),
                            degraded: t("common.degraded"),
                            disabled: t("common.disabled"),
                          }[m.status]
                        }
                      </button>
                    }
                    title={t("models.statusDialog", { model: m.displayName })}
                    fields={[
                      {
                        name: "status",
                        label: t("common.status"),
                        kind: "select",
                        options: [
                          { value: "active", label: t("common.active") },
                          { value: "degraded", label: t("models.degraded") },
                          { value: "disabled", label: t("models.disabled") },
                        ],
                        defaultValue: m.status,
                        validate: oneOf(["active", "degraded", "disabled"], t("common.status")),
                      },
                    ]}
                    confirmLabel={t("common.save")}
                    onConfirm={(v, reason) =>
                      admin(`/models/${m.modelId}`, {
                        method: "PATCH",
                        json: { status: v.status, reason },
                      }).then(models.reload)
                    }
                  />
                </TableCell>
                <TableCell className="tabular-nums">{number(m.qualityScore)}</TableCell>
                <TableCell className="tabular-nums">
                  {number(BigInt(m.inputMicroPerToken))}
                </TableCell>
                <TableCell className="tabular-nums">
                  {number(BigInt(m.outputMicroPerToken))}
                </TableCell>
                <TableCell className="tabular-nums">{number(BigInt(m.microPerImage))}</TableCell>
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
                        {t("common.edit")}
                      </Button>
                    }
                    title={t("models.editDialog", { model: m.displayName })}
                    description={t("models.keepValue")}
                    fields={[
                      {
                        name: "qualityScore",
                        label: t("models.qualityScore"),
                        inputMode: "numeric",
                        validate: integer(0, 100, t("models.qualityScore")),
                        defaultValue: String(m.qualityScore),
                      },
                      {
                        name: "inputMicroPerToken",
                        label: t("models.inputPrice"),
                        inputMode: "numeric",
                        validate: integer(0, 1_000_000_000_000, t("models.inputPrice")),
                        defaultValue: m.inputMicroPerToken,
                      },
                      {
                        name: "outputMicroPerToken",
                        label: t("models.outputPrice"),
                        inputMode: "numeric",
                        validate: integer(0, 1_000_000_000_000, t("models.outputPrice")),
                        defaultValue: m.outputMicroPerToken,
                      },
                      {
                        name: "microPerImage",
                        label: t("models.imagePrice"),
                        inputMode: "numeric",
                        validate: integer(0, 1_000_000_000_000, t("models.imagePrice")),
                        defaultValue: m.microPerImage,
                      },
                      {
                        name: "sortOrder",
                        label: t("models.sortOrder"),
                        inputMode: "numeric",
                        validate: integer(0, 100000, t("models.sortOrder")),
                        defaultValue: String(m.sortOrder),
                      },
                    ]}
                    confirmLabel={t("common.save")}
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
