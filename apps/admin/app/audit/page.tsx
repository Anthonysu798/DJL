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
    <Shell
      title="Audit log"
      subtitle="Every admin action and external write, with the values before and after."
    >
      <PageCard
        action={
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(filter);
            }}
          >
            <Input
              className="pill h-9 w-40"
              placeholder="action prefix"
              value={filter.action}
              onChange={(e) => setFilter({ ...filter, action: e.target.value })}
            />
            <Input
              className="pill h-9 w-56"
              placeholder="target id"
              value={filter.targetId}
              onChange={(e) => setFilter({ ...filter, targetId: e.target.value })}
            />
            <Input
              className="pill h-9 w-56"
              placeholder="actor id"
              value={filter.actorId}
              onChange={(e) => setFilter({ ...filter, actorId: e.target.value })}
            />
            <Button type="submit" size="sm" className="rounded-full">
              Filter
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
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audit.data?.map((a) => (
              <TableRow key={a.id} className={rowClass}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {new Date(a.createdAt).toLocaleString()}
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
          <p className="p-3 text-sm text-muted-foreground">No entries match.</p>
        ) : null}
      </PageCard>
    </Shell>
  );
}
