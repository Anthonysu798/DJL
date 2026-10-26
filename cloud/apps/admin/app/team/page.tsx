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
import { useI18n } from "@/components/LocaleProvider";
import type { MessageKey } from "@/lib/i18n";
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

export const ROLE_LABEL: Record<Member["role"], MessageKey> = {
  admin: "role.admin",
  employee: "role.employee",
};
export const ROLE_OPTIONS = [
  { value: "employee", label: "team.employeeRole" },
  { value: "admin", label: "team.adminRole" },
];

export function MemberStatus({ status }: { status: Member["status"] }) {
  const { t } = useI18n();
  if (status === "active") return <StatusPill tone="success">{t("common.active")}</StatusPill>;
  if (status === "disabled") return <StatusPill tone="danger">{t("common.disabled")}</StatusPill>;
  return <StatusPill tone="neutral">{t("team.invited")}</StatusPill>;
}

type Action = "edit" | "disable" | "enable" | "resend" | "revoke" | "delete" | null;

export default function TeamPage() {
  const { t, date } = useI18n();
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
      title={t("nav.team")}
      subtitle={t("team.description")}
      actions={
        <ReasonDialog
          trigger={
            <Button className="h-10 rounded-xl">
              <UserPlus className="size-4" />
              {t("team.inviteMember")}
            </Button>
          }
          title={t("team.inviteTitle")}
          description={t("team.inviteHint")}
          fields={[
            {
              name: "name",
              label: t("team.fullName"),
              validate: length(1, 80, t("common.name")),
              placeholder: "Ada Lovelace",
            },
            {
              name: "email",
              label: t("team.workEmail"),
              validate: emailRule,
              inputMode: "email",
              placeholder: "ada@slcor.com",
            },
            {
              name: "role",
              label: t("team.role"),
              kind: "select",
              options: ROLE_OPTIONS.map((option) => ({
                ...option,
                label: t(option.label as MessageKey),
              })),
              defaultValue: "employee",
              validate: oneOf(["admin", "employee"], t("team.role")),
            },
          ]}
          confirmLabel={t("team.sendInvite")}
          onConfirm={(v, reason) =>
            admin("/admins", { method: "POST", json: { ...v, reason } }).then(refresh)
          }
        />
      }
    >
      <div className="space-y-5">
        <PageCard title={t("team.members")}>
          {members.error ? (
            <p role="alert" className="text-sm text-destructive">
              {members.error}
            </p>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow className={headRowClass}>
                <TableHead>{t("team.member")}</TableHead>
                <TableHead>{t("team.role")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("team.twoFactor")}</TableHead>
                <TableHead>{t("team.lastSignIn")}</TableHead>
                <TableHead className="w-12 text-right">
                  <span className="sr-only">{t("common.actions")}</span>
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
                            <span className="ml-2 text-xs text-muted-foreground">
                              {t("team.you")}
                            </span>
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {m.email}
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t(ROLE_LABEL[m.role])}</Badge>
                  </TableCell>
                  <TableCell>
                    <MemberStatus status={m.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.totpEnabled ? t("team.enrolled") : t("team.notEnrolled")}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {m.lastLoginAt ? (
                      <>
                        <span className="block">
                          {date(m.lastLoginAt, { dateStyle: "medium", timeStyle: "short" })}
                        </span>
                        <span className="block font-mono text-xs">{m.lastLoginIp ?? ""}</span>
                      </>
                    ) : (
                      t("team.never")
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground"
                          aria-label={t("team.actionsFor", { email: m.email })}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem onSelect={() => router.push(`/team/${m.id}`)}>
                          {t("users.openProfile")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setAction({ kind: "edit", member: m })}>
                          {t("team.editRole")}
                        </DropdownMenuItem>
                        {m.status === "invited" ? (
                          <DropdownMenuItem
                            onSelect={() => setAction({ kind: "resend", member: m })}
                          >
                            {t("team.resendInvite")}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onSelect={() => setAction({ kind: "revoke", member: m })}>
                          {t("team.signOutEverywhere")}
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
                              {m.status === "disabled" ? t("common.enable") : t("common.disable")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setAction({ kind: "delete", member: m })}
                            >
                              {t("team.removeFromTeam")}
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <DropdownMenuItem disabled>{t("team.cannotRemoveSelf")}</DropdownMenuItem>
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
            title={t("team.activity")}
            action={
              <Button variant="ghost" size="sm" onClick={logins.reload}>
                {t("common.refresh")}
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
            title={t("settings.blocked")}
            action={
              <ReasonDialog
                trigger={
                  <Button variant="outline" size="sm">
                    {t("team.blockIp")}
                  </Button>
                }
                title={t("team.blockNetwork")}
                description={t("team.blockHint")}
                fields={[
                  {
                    name: "ip",
                    label: t("team.ipCidr"),
                    validate: ipOrCidr,
                    placeholder: "203.0.113.42",
                  },
                ]}
                confirmLabel={t("team.block")}
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
              <p className="text-sm text-muted-foreground">{t("team.noBlocked")}</p>
            ) : (
              <ul className="divide-y">
                {(bans.data ?? []).map((ip) => (
                  <li key={ip} className="flex items-center justify-between py-2.5">
                    <span className="font-mono text-sm">{ip}</span>
                    <ReasonDialog
                      trigger={
                        <Button variant="ghost" size="sm">
                          {t("team.unblock")}
                        </Button>
                      }
                      title={t("team.unblockIp", { ip })}
                      confirmLabel={t("team.unblock")}
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
          title={t("team.editMember", { name: action.member.name })}
          fields={[
            {
              name: "name",
              label: t("team.fullName"),
              defaultValue: action.member.name,
              validate: length(1, 80, t("common.name")),
            },
            {
              name: "role",
              label: t("team.role"),
              kind: "select",
              options: ROLE_OPTIONS.map((option) => ({
                ...option,
                label: t(option.label as MessageKey),
              })),
              defaultValue: action.member.role,
              validate: oneOf(["admin", "employee"], t("team.role")),
              hint: action.member.id === me ? t("team.ownRole") : t("team.roleSignsOut"),
            },
          ]}
          confirmLabel={t("common.save")}
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
          title={t("team.resendTo", { email: action.member.email })}
          description={t("team.resendHint")}
          confirmLabel={t("team.resend")}
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
          title={t("team.signOutMember", { name: action.member.name })}
          description={t("team.signOutHint")}
          confirmLabel={t("team.signOut")}
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
          title={t(action.kind === "disable" ? "team.disableMember" : "team.enableMember", {
            name: action.member.name,
          })}
          description={action.kind === "disable" ? t("team.disableHint") : undefined}
          destructive={action.kind === "disable"}
          confirmLabel={action.kind === "disable" ? t("common.disable") : t("common.enable")}
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
          title={t("team.removeMember", { name: action.member.name })}
          description={t("team.removeHint")}
          destructive
          confirmLabel={t("team.remove")}
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
