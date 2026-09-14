"use client";
import { useParams } from "next/navigation";

import { Initials, PageCard } from "@/components/PageCard";
import { Shell } from "@/components/Shell";
import { LoginEventsTable, type LoginEvent } from "@/components/team/LoginEventsTable";
import { Badge } from "@/components/ui/badge";
import { admin } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import { MemberStatus, ROLE_LABEL, type Member } from "../page";

export default function TeamMemberPage() {
  const { id } = useParams<{ id: string }>();
  const members = useLoad(() => admin<Member[]>("/admins"), []);
  const logins = useLoad(() => admin<LoginEvent[]>(`/admins/${id}/logins`), [id]);
  const bans = useLoad(() => admin<string[]>("/security/ip-bans"), []);
  const m = members.data?.find((x) => x.id === id) ?? null;
  return (
    <Shell
      title={m?.name ?? "Team member"}
      subtitle={m ? `${m.email} · ${ROLE_LABEL[m.role]}` : undefined}
    >
      {members.error ? (
        <p role="alert" className="text-sm text-destructive">
          {members.error}
        </p>
      ) : null}
      {members.data && !m ? (
        <p className="text-sm text-muted-foreground">No such team member.</p>
      ) : null}
      {m ? (
        <div className="space-y-5">
          <PageCard>
            <div className="flex flex-wrap items-center gap-4">
              <Initials name={m.name || m.email} className="size-14 text-lg" />
              <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="mt-1">
                    <MemberStatus status={m.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Role</dt>
                  <dd className="mt-1">
                    <Badge variant="secondary">{ROLE_LABEL[m.role]}</Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Email verified</dt>
                  <dd className="mt-1">
                    {m.emailVerifiedAt
                      ? new Date(m.emailVerifiedAt).toLocaleDateString()
                      : "Not yet"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Authenticator</dt>
                  <dd className="mt-1">{m.totpEnabled ? "Enrolled" : "Not enrolled"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Added</dt>
                  <dd className="mt-1">{new Date(m.createdAt).toLocaleDateString()}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last sign-in</dt>
                  <dd className="mt-1">
                    {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : "Never"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last IP</dt>
                  <dd className="mt-1 font-mono text-xs">{m.lastLoginIp ?? "—"}</dd>
                </div>
              </dl>
            </div>
          </PageCard>
          <PageCard title="Sign-in history">
            <LoginEventsTable
              events={logins.data ?? []}
              bans={bans.data ?? []}
              onBan={(ip) =>
                admin("/security/ip-bans", {
                  method: "POST",
                  json: { ip, reason: `Banned from ${m.email}'s sign-in history` },
                }).then(() => {
                  bans.reload();
                  logins.reload();
                })
              }
            />
          </PageCard>
        </div>
      ) : null}
    </Shell>
  );
}
