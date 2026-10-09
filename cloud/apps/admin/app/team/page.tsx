"use client";
import { MoreHorizontal, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Initials, PageCard, StatusPill, headRowClass, rowClass } from "@/components/PageCard";
import { ReasonDialog } from "@/components/ReasonDialog";
import { Shell } from "@/components/Shell";
import { LoginEventsTable, type LoginEvent } from "@/components/team/LoginEventsTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { email as emailRule, ipOrCidr, length, oneOf } from "@/lib/validation";

export interface Member {
  id: string;
  email: string;
  name: string;
  role: "admin" | "employee";
  status: "invited" | "active" | "disabled";
  emailVerifiedAt: string | null;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  createdAt: string;
}

export const ROLE_LABEL: Record<Member["role"], string> = { admin: "Admin", employee: "Employee" };
export const ROLE_OPTIONS = [
  { value: "employee", label: "Employee · support desk" },
  { value: "admin", label: "Admin · full access" },
];

export function MemberStatus({ status }: { status: Member["status"] }) {
  if (status === "active") return <StatusPill tone="success">Active</StatusPill>;
  if (status === "disabled") return <StatusPill tone="danger">Disabled</StatusPill>;
  return <StatusPill tone="neutral">Invited</StatusPill>;
}

type Action = "edit" | "disable" | "enable" | "resend" | "revoke" | "delete" | null;

export default function TeamPage() {
  const router = useRouter();
  const members = useLoad(() => admin<Member[]>("/admins"), []);
  const logins = useLoad(() => admin<LoginEvent[]>("/security/logins?limit=25"), []);
  const bans = useLoad(() => admin<string[]>("/security/ip-bans"), []);
  const [me, setMe] = useState<string | null>(null);
  useLoad(() => admin<{ admin: { id: string } }>("/me").then((m) => setMe(m.admin.id)), []);
  const [action, setAction] = useState<{ kind: Action; member: Member } | null>(null);
  const refresh = () => {
    members.reload();
    logins.reload();
  };
  const close = () => setAction(null);

  return (
    <Shell
      title="Team"
      subtitle="Everyone who can open this console. Admins run the platform; employees handle support."
      actions={
        <ReasonDialog
          trigger={
            <Button className="h-10 rounded-xl">
              <UserPlus className="size-4" />
              Invite member
            </Button>
          }
          title="Invite a team member"
          description="They receive a single-use link that verifies their email and lets them choose a password. It expires in 24 hours."
          fields={[
            {
              name: "name",
              label: "Full name",
              validate: length(1, 80, "Name"),
              placeholder: "Ada Lovelace",
            },
            {
              name: "email",
              label: "Work email",
              validate: emailRule,
              inputMode: "email",
              placeholder: "ada@slcor.com",
            },
            {
              name: "role",
              label: "Role",
              kind: "select",
              options: ROLE_OPTIONS,
              defaultValue: "employee",
              validate: oneOf(["admin", "employee"], "Role"),
            },
          ]}
          confirmLabel="Send invite"
          onConfirm={(v, reason) =>
            admin("/admins", { method: "POST", json: { ...v, reason } }).then(refresh)
          }
        />
      }
    >
      <div className="space-y-5">
        <PageCard title="Members">
          {members.error ? (
            <p role="alert" className="text-sm text-destructive">
              {members.error}
            </p>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow className={headRowClass}>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>2FA</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="w-12 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data?.map((m) => (
                <TableRow key={m.id} className={`${rowClass} h-16`}>
                  <TableCell>
                    <Link href={`/team/${m.id}`} className="flex items-center gap-3">
                      <Initials name={m.name || m.email} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {m.name}
                          {m.id === me ? (
                            <span className="ml-2 text-xs text-muted-foreground">you</span>
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {m.email}
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{ROLE_LABEL[m.role]}</Badge>
                  </TableCell>
                  <TableCell>
                    <MemberStatus status={m.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.totpEnabled ? "Enrolled" : "Not enrolled"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.lastLoginAt ? (
                      <>
                        <span className="block">{new Date(m.lastLoginAt).toLocaleString()}</span>
                        <span className="block font-mono text-xs">{m.lastLoginIp ?? ""}</span>
                      </>
                    ) : (
                      "Never"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground"
                          aria-label={`Actions for ${m.email}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onSelect={() => router.push(`/team/${m.id}`)}>
                          Open profile
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setAction({ kind: "edit", member: m })}>
                          Edit name and role
                        </DropdownMenuItem>
                        {m.status === "invited" ? (
                          <DropdownMenuItem
                            onSelect={() => setAction({ kind: "resend", member: m })}
                          >
                            Resend invite
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onSelect={() => setAction({ kind: "revoke", member: m })}>
                          Sign out everywhere
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {m.id !== me ? (
                          <>
                            <DropdownMenuItem
                              onSelect={() =>
                                setAction({
                                  kind: m.status === "disabled" ? "enable" : "disable",
                                  member: m,
                                })
                              }
                            >
                              {m.status === "disabled" ? "Enable" : "Disable"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setAction({ kind: "delete", member: m })}
                            >
                              Remove from team
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <DropdownMenuItem disabled>
                            You cannot disable or remove yourself
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </PageCard>

        <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
          <PageCard
            title="Sign-in activity"
            action={
              <Button variant="ghost" size="sm" onClick={logins.reload}>
                Refresh
              </Button>
            }
          >
            <LoginEventsTable
              events={logins.data ?? []}
              showMember
              onBan={(ip) =>
                admin("/security/ip-bans", {
                  method: "POST",
                  json: { ip, reason: "Banned from sign-in activity" },
                }).then(() => {
                  bans.reload();
                  logins.reload();
                })
              }
              bans={bans.data ?? []}
            />
          </PageCard>
          <PageCard
            title="Blocked networks"
            action={
              <ReasonDialog
                trigger={
                  <Button variant="outline" size="sm">
                    Block an IP
                  </Button>
                }
                title="Block a network"
                description="Sessions from this address end immediately and sign-in from it is refused. Use a CIDR to block a range."
                fields={[
                  {
                    name: "ip",
                    label: "IP address or CIDR",
                    validate: ipOrCidr,
                    placeholder: "203.0.113.42",
                  },
                ]}
                confirmLabel="Block"
                destructive
                onConfirm={(v, reason) =>
                  admin("/security/ip-bans", {
                    method: "POST",
                    json: { ip: (v.ip ?? "").trim(), reason },
                  }).then(bans.reload)
                }
              />
            }
          >
            {bans.data && bans.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">No networks are blocked.</p>
            ) : (
              <ul className="divide-y">
                {(bans.data ?? []).map((ip) => (
                  <li key={ip} className="flex items-center justify-between py-2.5">
                    <span className="font-mono text-sm">{ip}</span>
                    <ReasonDialog
                      trigger={
                        <Button variant="ghost" size="sm">
                          Unblock
                        </Button>
                      }
                      title={`Unblock ${ip}`}
                      confirmLabel="Unblock"
                      onConfirm={(_v, reason) =>
                        admin("/security/ip-bans/remove", {
                          method: "POST",
                          json: { ip, reason },
                        }).then(bans.reload)
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </PageCard>
        </div>
      </div>

      {action?.kind === "edit" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => {
            if (!o) close();
          }}
          title={`Edit ${action.member.name}`}
          fields={[
            {
              name: "name",
              label: "Full name",
              defaultValue: action.member.name,
              validate: length(1, 80, "Name"),
            },
            {
              name: "role",
              label: "Role",
              kind: "select",
              options: ROLE_OPTIONS,
              defaultValue: action.member.role,
              validate: oneOf(["admin", "employee"], "Role"),
              hint:
                action.member.id === me
                  ? "You cannot change your own role."
                  : "Changing the role signs them out everywhere.",
            },
          ]}
          confirmLabel="Save"
          onConfirm={(v, reason) =>
            admin(`/admins/${action.member.id}`, {
              method: "PATCH",
              json: { name: v.name, role: v.role, reason },
            }).then(refresh)
          }
        />
      ) : null}
      {action?.kind === "resend" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => {
            if (!o) close();
          }}
          title={`Resend invite to ${action.member.email}`}
          description="The previous link stops working."
          confirmLabel="Resend"
          onConfirm={(_v, reason) =>
            admin(`/admins/${action.member.id}/resend-invite`, {
              method: "POST",
              json: { reason },
            }).then(refresh)
          }
        />
      ) : null}
      {action?.kind === "revoke" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => {
            if (!o) close();
          }}
          title={`Sign ${action.member.name} out everywhere`}
          description="Every active session ends. They can sign in again."
          confirmLabel="Sign out"
          onConfirm={(_v, reason) =>
            admin(`/admins/${action.member.id}/revoke-sessions`, {
              method: "POST",
              json: { reason },
            }).then(refresh)
          }
        />
      ) : null}
      {action?.kind === "disable" || action?.kind === "enable" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => {
            if (!o) close();
          }}
          title={`${action.kind === "disable" ? "Disable" : "Enable"} ${action.member.name}`}
          description={
            action.kind === "disable"
              ? "They are signed out immediately and cannot sign in until enabled."
              : undefined
          }
          destructive={action.kind === "disable"}
          confirmLabel={action.kind === "disable" ? "Disable" : "Enable"}
          onConfirm={(_v, reason) =>
            admin(`/admins/${action.member.id}/disabled`, {
              method: "POST",
              json: { disabled: action.kind === "disable", reason },
            }).then(refresh)
          }
        />
      ) : null}
      {action?.kind === "delete" ? (
        <ReasonDialog
          open
          onOpenChange={(o) => {
            if (!o) close();
          }}
          title={`Remove ${action.member.name} from the team`}
          description="Their access ends now. The account and its audit history are kept for the record; the email can be invited again later."
          destructive
          confirmLabel="Remove"
          onConfirm={(_v, reason) =>
            admin(`/admins/${action.member.id}`, { method: "DELETE", json: { reason } }).then(
              refresh,
            )
          }
        />
      ) : null}
    </Shell>
  );
}
