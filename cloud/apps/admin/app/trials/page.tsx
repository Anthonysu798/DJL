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
  const trials = useLoad(() => admin<Trial[]>("/trials"), []);
  return (
    <Shell
      title="Trial queue"
      subtitle="Claims that hit the daily trial budget wait here. Approving grants the credits immediately and is audited."
    >
      <PageCard>
        {trials.error ? (
          <p role="alert" className="text-sm text-destructive">
            {trials.error}
          </p>
        ) : null}
        {trials.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">The queue is empty.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className={headRowClass}>
                <TableHead>Claimed</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Line</TableHead>
                <TableHead>Reasons</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {trials.data?.map((t) => (
                <TableRow key={t.id} className={rowClass}>
                  <TableCell className="text-muted-foreground">
                    {new Date(t.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.userId}</TableCell>
                  <TableCell>{t.phoneLineType}</TableCell>
                  <TableCell>
                    {t.reasons.map((r) => (
                      <Badge key={r} variant="secondary" className="mr-1">
                        {r}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      onClick={() =>
                        admin(`/trials/${t.id}/approve`, { method: "POST", json: {} }).then(
                          trials.reload,
                        )
                      }
                    >
                      Approve
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
