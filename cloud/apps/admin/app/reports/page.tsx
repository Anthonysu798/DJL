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

interface Report {
  id: string;
  source: "cloud" | "desktop";
  reason: string;
  note: string | null;
  userId: string | null;
  snapshot: { type: string; text?: string }[];
  agent: string | null;
  model: string | null;
  createdAt: string;
}

/** The reported answer's text parts; other parts (images, tools) are named only. */
const answerText = (r: Report) =>
  r.snapshot.map((part) => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n");

export default function ReportsPage() {
  const reports = useLoad(
    () => admin<{ reports: Report[] }>("/content-reports?status=open&limit=100"),
    [],
  );
  return (
    <Shell
      title="Reported answers"
      subtitle="AI answers people reported from the apps. Resolving a report is audited."
    >
      <PageCard>
        {reports.error ? (
          <p role="alert" className="text-sm text-destructive">
            {reports.error}
          </p>
        ) : null}
        {reports.data?.reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open reports.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className={headRowClass}>
                <TableHead>Reported</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Answer</TableHead>
                <TableHead>From</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.data?.reports.map((r) => (
                <TableRow key={r.id} className={rowClass}>
                  <TableCell className="align-top text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge variant="secondary">{r.reason}</Badge>
                    {r.note ? <p className="mt-2 max-w-48 text-xs">{r.note}</p> : null}
                  </TableCell>
                  <TableCell className="max-w-xl align-top">
                    <p className="line-clamp-6 text-xs whitespace-pre-wrap">{answerText(r)}</p>
                  </TableCell>
                  <TableCell className="align-top text-xs">
                    <div>
                      {r.source === "cloud" ? (r.model ?? "DJL Cloud") : (r.agent ?? "Mac")}
                    </div>
                    <div className="font-mono text-muted-foreground">
                      {r.userId ?? "signed out"}
                    </div>
                  </TableCell>
                  <TableCell className="text-right align-top">
                    <Button
                      size="sm"
                      onClick={() =>
                        admin(`/content-reports/${r.id}/resolve`, {
                          method: "POST",
                          json: {},
                        }).then(reports.reload, reports.reload)
                      }
                    >
                      Resolve
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
