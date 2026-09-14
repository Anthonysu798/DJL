"use client";
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

const OUTCOME: Record<string, { label: string; tone: "success" | "danger" | "neutral" }> = {
  success: { label: "Signed in", tone: "success" },
  bad_password: { label: "Wrong password", tone: "danger" },
  bad_totp: { label: "Wrong 2FA code", tone: "danger" },
  totp_required: { label: "Password ok, 2FA pending", tone: "neutral" },
  locked_out: { label: "Locked out", tone: "danger" },
  disabled: { label: "Disabled account", tone: "danger" },
  ip_blocked: { label: "Blocked network", tone: "danger" },
  ip_not_allowed: { label: "Network not allowed", tone: "danger" },
  not_active: { label: "Invite not accepted", tone: "neutral" },
  unknown_email: { label: "Unknown email", tone: "danger" },
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
  if (events.length === 0)
    return <p className="text-sm text-muted-foreground">No sign-in attempts yet.</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className={headRowClass}>
            <TableHead>When</TableHead>
            {showMember ? <TableHead>Who</TableHead> : null}
            <TableHead>Outcome</TableHead>
            <TableHead>Network</TableHead>
            <TableHead>Device</TableHead>
            {onBan ? (
              <TableHead className="w-10">
                <span className="sr-only">Ban</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((e) => {
            const o = OUTCOME[e.outcome] ?? { label: e.outcome, tone: "neutral" as const };
            const banned = e.ip ? bans.includes(e.ip) : false;
            return (
              <TableRow key={e.id} className={rowClass}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {new Date(e.createdAt).toLocaleString()}
                </TableCell>
                {showMember ? <TableCell className="max-w-48 truncate">{e.email}</TableCell> : null}
                <TableCell>
                  <StatusPill tone={o.tone}>{o.label}</StatusPill>
                </TableCell>
                <TableCell>
                  <span className="block font-mono text-xs">{e.ip ?? "unknown"}</span>
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
                    title="Browser device id"
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
                        aria-label={`Block ${e.ip}`}
                        title={`Block ${e.ip}`}
                        onClick={() => onBan(e.ip!)}
                      >
                        <Ban className="size-4" />
                      </Button>
                    ) : banned ? (
                      <span className="text-xs text-destructive">blocked</span>
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
