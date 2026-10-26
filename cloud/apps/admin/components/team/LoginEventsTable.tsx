"use client";
import { useI18n } from "../LocaleProvider";
import type { MessageKey } from "@/lib/i18n";
import { Ban } from "lucide-react";

import { StatusPill, headRowClass, rowClass } from "@/components/PageCard";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface LoginEvent {
  id: string;
  adminId: string | null;
  email: string;
  outcome: string;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  timezone: string | null;
  locale: string | null;
  platform: string | null;
  screen: string | null;
  deviceId: string | null;
  createdAt: string;
}

const OUTCOME: Record<string, { label: MessageKey; tone: "success" | "danger" | "neutral" }> = {
  success: { label: "login.success", tone: "success" },
  bad_password: { label: "login.badPassword", tone: "danger" },
  bad_totp: { label: "login.badTotp", tone: "danger" },
  totp_required: { label: "login.pending", tone: "neutral" },
  locked_out: { label: "login.locked", tone: "danger" },
  disabled: { label: "login.disabled", tone: "danger" },
  ip_blocked: { label: "login.blockedNetwork", tone: "danger" },
  ip_not_allowed: { label: "login.networkDenied", tone: "danger" },
  not_active: { label: "login.invitePending", tone: "neutral" },
  unknown_email: { label: "login.unknownEmail", tone: "danger" },
};

/** Compress a user agent into browser + OS words a human can scan. */
function describeAgent(ua: string | null): string {
  if (!ua) return "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return [browser, os].filter(Boolean).join(" · ");
}

export function LoginEventsTable({
  events,
  showMember = false,
  bans = [],
  onBan,
}: {
  events: readonly LoginEvent[];
  showMember?: boolean;
  bans?: readonly string[];
  onBan?: ((ip: string) => Promise<unknown>) | undefined;
}) {
  const { t, date } = useI18n();
  if (events.length === 0)
    return <p className="text-sm text-muted-foreground">{t("login.empty")}</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className={headRowClass}>
            <TableHead>{t("common.when")}</TableHead>
            {showMember ? <TableHead>{t("common.who")}</TableHead> : null}
            <TableHead>{t("login.outcome")}</TableHead>
            <TableHead>{t("login.network")}</TableHead>
            <TableHead>{t("login.device")}</TableHead>
            {onBan ? (
              <TableHead className="w-10">
                <span className="sr-only">{t("login.ban")}</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((e) => {
            const o = OUTCOME[e.outcome];
            const banned = e.ip ? bans.includes(e.ip) : false;
            return (
              <TableRow key={e.id} className={rowClass}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {date(e.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                </TableCell>
                {showMember ? <TableCell className="max-w-48 truncate">{e.email}</TableCell> : null}
                <TableCell>
                  <StatusPill tone={o?.tone ?? "neutral"}>{o ? t(o.label) : e.outcome}</StatusPill>
                </TableCell>
                <TableCell>
                  <span className="block font-mono text-xs">{e.ip ?? t("common.unknown")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[e.country, e.timezone, e.locale].filter(Boolean).join(" · ")}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="block text-xs">
                    {describeAgent(e.userAgent)}
                    {e.platform ? ` · ${e.platform}` : ""}
                    {e.screen ? ` · ${e.screen}` : ""}
                  </span>
                  <span
                    className="block font-mono text-[11px] text-muted-foreground"
                    title={t("login.deviceId")}
                  >
                    {e.deviceId ? e.deviceId.slice(0, 18) : ""}
                  </span>
                </TableCell>
                {onBan ? (
                  <TableCell className="text-right">
                    {e.ip && !banned ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        aria-label={t("login.blockIp", { ip: e.ip })}
                        title={t("login.blockIp", { ip: e.ip })}
                        onClick={() => onBan(e.ip!)}
                      >
                        <Ban className="size-4" />
                      </Button>
                    ) : banned ? (
                      <span className="text-xs text-destructive">{t("login.blocked")}</span>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
