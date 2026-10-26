"use client";
import { useState } from "react";

import { PageCard, headRowClass, rowClass } from "@/components/PageCard";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

interface Audit {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
}

export default function AuditPage() {
  const { t, date } = useI18n();
  const [filter, setFilter] = useState({ action: "", targetId: "", actorId: "" });
  const [applied, setApplied] = useState(filter);
  const audit = useLoad(
    () =>
      admin<Audit[]>(
        `/audit?limit=100${applied.action ? `&action=${encodeURIComponent(applied.action)}` : ""}${applied.targetId ? `&targetId=${encodeURIComponent(applied.targetId)}` : ""}${applied.actorId ? `&actorId=${encodeURIComponent(applied.actorId)}` : ""}`,
      ),
    [applied],
  );
  return (
    <Shell title={t("nav.audit")} subtitle={t("audit.description")}>
      <PageCard
        action={
          <form
            noValidate
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(filter);
            }}
          >
            <Input
              className="h-9 w-40"
              placeholder={t("audit.actionPrefix")}
              value={filter.action}
              onChange={(e) => setFilter({ ...filter, action: e.target.value })}
            />
            <Input
              className="h-9 w-56"
              placeholder={t("audit.targetId")}
              value={filter.targetId}
              onChange={(e) => setFilter({ ...filter, targetId: e.target.value })}
            />
            <Input
              className="h-9 w-56"
              placeholder={t("audit.actorId")}
              value={filter.actorId}
              onChange={(e) => setFilter({ ...filter, actorId: e.target.value })}
            />
            <Button type="submit" size="sm" className="rounded-full">
              {t("common.filter")}
            </Button>
          </form>
        }
      >
        {audit.error ? (
          <p role="alert" className="text-sm text-destructive">
            {audit.error}
          </p>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow className={headRowClass}>
              <TableHead>{t("common.when")}</TableHead>
              <TableHead>{t("common.actor")}</TableHead>
              <TableHead>{t("common.action")}</TableHead>
              <TableHead>{t("common.target")}</TableHead>
              <TableHead>{t("common.reason")}</TableHead>
              <TableHead>{t("common.change")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audit.data?.map((a) => (
              <TableRow key={a.id} className={rowClass}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {date(a.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {a.actorType}:{a.actorId.slice(0, 12)}
                </TableCell>
                <TableCell>{a.action}</TableCell>
                <TableCell className="font-mono text-xs">
                  {a.targetType}:{a.targetId.slice(0, 12)}
                </TableCell>
                <TableCell>{a.reason ?? ""}</TableCell>
                <TableCell className="max-w-md font-mono text-xs break-all text-muted-foreground">
                  {a.before !== null ? `before ${JSON.stringify(a.before)} ` : ""}
                  {a.after !== null ? `after ${JSON.stringify(a.after)}` : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {audit.data?.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{t("audit.empty")}</p>
        ) : null}
      </PageCard>
    </Shell>
  );
}
