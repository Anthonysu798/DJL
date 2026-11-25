"use client";
import { useState } from "react";

import { PageCard, headRowClass, rowClass } from "@/components/PageCard";
import { ReasonDialog } from "@/components/ReasonDialog";
import { Shell } from "@/components/Shell";
import { Badge } from "@/components/ui/badge";
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

interface HeldDeploy {
  id: string;
  name: string;
  url: string;
  reason: string | null;
  fileCount: number;
  files: string[];
  createdAt: string;
}
interface SiteReport {
  id: string;
  siteId: string;
  name: string;
  url: string;
  siteStatus: "active" | "disabled";
  reason: string;
  note: string | null;
  createdAt: string;
}
interface Site {
  id: string;
  name: string;
  url: string;
  status: "active" | "disabled";
  disabledReason: string | null;
  userId: string;
  liveDeploy: { fileCount: number; createdAt: string } | null;
  lastVisitAt: string | null;
  createdAt: string;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "Never");

function Empty({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function Failure({ message }: { message: string | null | undefined }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

function StatusButton({
  site,
  onDone,
}: {
  site: { id: string; name: string; status: "active" | "disabled" };
  onDone: () => void;
}) {
  const disable = site.status === "active";
  return (
    <ReasonDialog
      trigger={
        <Button size="sm" variant={disable ? "destructive" : "default"}>
          {disable ? "Take down" : "Restore"}
        </Button>
      }
      title={`${disable ? "Take down" : "Restore"} ${site.name}`}
      description={
        disable ? "Visitors will see a notice instead of the site within 30 seconds." : undefined
      }
      destructive={disable}
      confirmLabel={disable ? "Take down" : "Restore"}
      onConfirm={(_v, reason) =>
        admin(`/sites/${site.id}/${disable ? "disable" : "enable"}`, {
          method: "POST",
          json: { reason },
        }).then(onDone)
      }
    />
  );
}

export default function SitesPage() {
  const [query, setQuery] = useState("");
  const held = useLoad(() => admin<{ deploys: HeldDeploy[] }>("/sites/held"), []);
  const reports = useLoad(() => admin<{ reports: SiteReport[] }>("/sites/reports?status=open"), []);
  const sites = useLoad(
    () =>
      admin<{ sites: Site[] }>(
        `/sites?limit=100${query ? `&query=${encodeURIComponent(query)}` : ""}`,
      ),
    [query],
  );
  const reloadAll = () => {
    held.reload();
    reports.reload();
    sites.reload();
  };

  return (
    <Shell
      title="Sites"
      subtitle="Websites published on slcor.site. Every review, takedown and deletion is audited."
    >
      <div className="grid gap-6">
        <PageCard title="Held for review">
          <Failure message={held.error} />
          {held.data?.deploys.length === 0 ? (
            <Empty>Nothing is waiting for review.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className={headRowClass}>
                  <TableHead>Site</TableHead>
                  <TableHead>Why it was held</TableHead>
                  <TableHead>Files</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {held.data?.deploys.map((d) => (
                  <TableRow key={d.id} className={rowClass}>
                    <TableCell className="align-top">
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-muted-foreground">{when(d.createdAt)}</div>
                    </TableCell>
                    <TableCell className="align-top text-sm">{d.reason}</TableCell>
                    <TableCell className="max-w-sm align-top">
                      <p className="line-clamp-4 font-mono text-xs text-muted-foreground">
                        {d.files.join(", ")}
                      </p>
                    </TableCell>
                    <TableCell className="space-x-2 text-right align-top whitespace-nowrap">
                      <ReasonDialog
                        trigger={<Button size="sm">Approve</Button>}
                        title={`Approve this publish of ${d.name}`}
                        description="It goes live right away and replaces the current version."
                        confirmLabel="Approve"
                        onConfirm={(_v, reason) =>
                          admin(`/site-deploys/${d.id}/approve`, {
                            method: "POST",
                            json: { reason },
                          }).then(reloadAll)
                        }
                      />
                      <ReasonDialog
                        trigger={
                          <Button size="sm" variant="destructive">
                            Reject
                          </Button>
                        }
                        title={`Reject this publish of ${d.name}`}
                        description="Its files are deleted. The live version, if any, stays."
                        destructive
                        confirmLabel="Reject"
                        onConfirm={(_v, reason) =>
                          admin(`/site-deploys/${d.id}/reject`, {
                            method: "POST",
                            json: { reason },
                          }).then(reloadAll)
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PageCard>

        <PageCard title="Visitor reports">
          <Failure message={reports.error} />
          {reports.data?.reports.length === 0 ? (
            <Empty>No open reports.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className={headRowClass}>
                  <TableHead>Site</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Reported</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.data?.reports.map((r) => (
                  <TableRow key={r.id} className={rowClass}>
                    <TableCell className="align-top">
                      <a
                        className="font-medium underline-offset-4 hover:underline"
                        href={r.url}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {r.name}
                      </a>
                      {r.siteStatus === "disabled" ? (
                        <Badge className="ml-2" variant="destructive">
                          Down
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge variant="secondary">{r.reason}</Badge>
                      {r.note ? <p className="mt-2 max-w-md text-xs">{r.note}</p> : null}
                    </TableCell>
                    <TableCell className="align-top text-muted-foreground">
                      {when(r.createdAt)}
                    </TableCell>
                    <TableCell className="space-x-2 text-right align-top whitespace-nowrap">
                      {r.siteStatus === "active" ? (
                        <StatusButton
                          site={{ id: r.siteId, name: r.name, status: "active" }}
                          onDone={reloadAll}
                        />
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          admin("/sites/reports/resolve", {
                            method: "POST",
                            json: { ids: [r.id] },
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

        <PageCard
          title="All sites"
          action={
            <Input
              aria-label="Search sites by name"
              placeholder="Search by name"
              className="h-8 w-56"
              value={query}
              onChange={(e) => setQuery(e.target.value.toLowerCase())}
            />
          }
        >
          <Failure message={sites.error} />
          {sites.data?.sites.length === 0 ? (
            <Empty>No sites match.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className={headRowClass}>
                  <TableHead>Site</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last visit</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.data?.sites.map((s) => (
                  <TableRow key={s.id} className={rowClass}>
                    <TableCell>
                      <a
                        className="font-medium underline-offset-4 hover:underline"
                        href={s.url}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {s.name}
                      </a>
                      <div className="text-xs text-muted-foreground">
                        {s.liveDeploy ? `${s.liveDeploy.fileCount} files` : "Not published"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.status === "active" ? "secondary" : "destructive"}>
                        {s.status}
                      </Badge>
                      {s.disabledReason ? (
                        <p className="mt-1 max-w-48 text-xs">{s.disabledReason}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{when(s.lastVisitAt)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {s.userId}
                    </TableCell>
                    <TableCell className="space-x-2 text-right whitespace-nowrap">
                      <StatusButton site={s} onDone={reloadAll} />
                      <ReasonDialog
                        trigger={
                          <Button size="sm" variant="outline">
                            Delete
                          </Button>
                        }
                        title={`Delete ${s.name}`}
                        description="The site, its files and its reports are deleted and the name is freed. This cannot be undone."
                        destructive
                        confirmLabel="Delete"
                        onConfirm={(_v, reason) =>
                          admin(`/sites/${s.id}/delete`, { method: "POST", json: { reason } }).then(
                            reloadAll,
                          )
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PageCard>
      </div>
    </Shell>
  );
}
