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

interface Admin {
  id: string;
  email: string;
  name: string;
  role: string;
  totpEnabled: boolean;
  disabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export default function AdminsPage() {
  const admins = useLoad(() => admin<Admin[]>("/admins"), []);
  return (
    <Shell
      title="Admins"
      subtitle="New admins are created from a trusted shell with `bun run admin:create`, so no password ever crosses this UI."
    >
      <PageCard>
        {admins.error ? (
          <p role="alert" className="text-sm text-destructive">
            {admins.error}
          </p>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow className={headRowClass}>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>2FA</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {admins.data?.map((a) => (
              <TableRow key={a.id} className={rowClass}>
                <TableCell>{a.email}</TableCell>
                <TableCell>{a.name}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{a.role}</Badge>
                </TableCell>
                <TableCell>{a.totpEnabled ? "on" : "not enrolled"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : "never"}
                </TableCell>
                <TableCell>
                  {a.disabled ? (
                    <Badge variant="destructive">disabled</Badge>
                  ) : (
                    <Badge className="bg-primary/20 text-foreground">active</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <ReasonDialog
                    trigger={
                      <Button size="sm" variant={a.disabled ? "secondary" : "destructive"}>
                        {a.disabled ? "Enable" : "Disable"}
                      </Button>
                    }
                    title={`${a.disabled ? "Enable" : "Disable"} ${a.email}`}
                    destructive={!a.disabled}
                    onConfirm={(_v, reason) =>
                      admin(`/admins/${a.id}/disabled`, {
                        method: "POST",
                        json: { disabled: !a.disabled, reason },
                      }).then(admins.reload)
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
