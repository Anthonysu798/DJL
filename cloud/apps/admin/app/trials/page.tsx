"use client";
import { PageCard, headRowClass, rowClass } from "@/components/PageCard";
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

interface Trial {
  id: string;
  orgId: string;
  userId: string;
  phoneLineType: string;
  status: string;
  reasons: string[];
  createdAt: string;
}

export default function TrialsPage() {
  const { t, date } = useI18n();
  const trials = useLoad(() => admin<Trial[]>("/trials"), []);
  return (
    <Shell title={t("nav.trials")} subtitle={t("trials.description")}>
      <PageCard>
        {trials.error ? (
          <p role="alert" className="text-sm text-destructive">
            {trials.error}
          </p>
        ) : null}
        {trials.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("trials.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className={headRowClass}>
                <TableHead>{t("trials.claimed")}</TableHead>
                <TableHead>{t("common.user")}</TableHead>
                <TableHead>{t("trials.line")}</TableHead>
                <TableHead>{t("common.reasons")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {trials.data?.map((trial) => (
                <TableRow key={trial.id} className={rowClass}>
                  <TableCell className="text-muted-foreground">
                    {date(trial.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{trial.userId}</TableCell>
                  <TableCell>{trial.phoneLineType}</TableCell>
                  <TableCell>
                    {trial.reasons.map((r) => (
                      <Badge key={r} variant="secondary" className="mr-1">
                        {r}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      onClick={() =>
                        admin(`/trials/${trial.id}/approve`, { method: "POST", json: {} }).then(
                          trials.reload,
                        )
                      }
                    >
                      {t("common.approve")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PageCard>
    </Shell>
  );
}
