// FILE: ServerRow.tsx
// Purpose: One registered server: status, address, tags, stats strip, actions, expandable details.
// Layer: Settings UI components (servers)

import type { ServerRecord } from "@synara/contracts";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { CheckIcon, CopyIcon, EllipsisIcon, LoaderCircleIcon } from "~/lib/icons";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";
import { SETTINGS_CARD_ROW_CLASS_NAME } from "~/settingsPanelStyles";

import { formatBytes, percent, statusKey, statusTone, uptimeParts } from "./serverPanelModel";
import { ServerStatusDot } from "./ServerStatusDot";

export type ServerPendingAction = "test" | "refresh" | null;

export interface ServerRowProps {
  server: ServerRecord;
  pending: ServerPendingAction;
  /** Set right after creation so the row plays its enter + highlight animation. */
  justAdded?: boolean;
  onTest: () => void;
  onRefresh: () => void;
  onTrust: (fingerprint: string) => void;
  onEdit: () => void;
  onRemove: () => void;
}

function formatUptime(seconds: number, t: TFunction<"settings">) {
  const { days, hours, minutes } = uptimeParts(seconds);
  if (days > 0) return t("servers.stats.uptimeDays", { count: days, hours });
  if (hours > 0) return t("servers.stats.uptimeHours", { count: hours, minutes });
  return t("servers.stats.uptimeMinutes", { count: minutes });
}

function CopyButton({ value }: { value: string }) {
  const { t } = useTranslation("settings");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      size="chip"
      variant="outline"
      className="servers-press"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
      }}
    >
      {copied ? <CheckIcon className="servers-check-pop" /> : <CopyIcon />}
      {copied ? t("servers.actions.copied") : t("servers.actions.copy")}
    </Button>
  );
}

function Bar({ label, used, total }: { label: string; used: number; total: number }) {
  const [width, setWidth] = useState(0);
  const target = percent(used, total);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setWidth(target));
    return () => window.cancelAnimationFrame(frame);
  }, [target]);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums text-[var(--color-text-foreground)]">
          {formatBytes(used)} / {formatBytes(total)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-background-elevated-secondary)]">
        <div
          className={cn(
            "servers-bar-fill h-full rounded-full",
            target >= 90 ? "bg-destructive" : target >= 75 ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function ActionButton({
  label,
  busy,
  done,
  onClick,
  variant = "outline",
}: {
  label: string;
  busy: boolean;
  done: boolean;
  onClick: () => void;
  variant?: "outline" | "default";
}) {
  return (
    <Button
      size="sm"
      variant={variant}
      className="servers-press min-w-28"
      disabled={busy}
      onClick={onClick}
    >
      {busy ? (
        <LoaderCircleIcon className="animate-spin" />
      ) : done ? (
        <CheckIcon className="servers-check-pop" />
      ) : null}
      <span>{label}</span>
    </Button>
  );
}

export function ServerRow({
  server,
  pending,
  justAdded = false,
  onTest,
  onRefresh,
  onTrust,
  onEdit,
  onRemove,
}: ServerRowProps) {
  const { t, i18n } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [recentSuccess, setRecentSuccess] = useState<ServerPendingAction>(null);
  const [wasPending, setWasPending] = useState<ServerPendingAction>(null);

  const outcome = server.lastTest?.outcome;
  const needsHostKeyDecision = outcome === "host-key-unknown" || outcome === "host-key-changed";

  // Remember which action was running so its button can flash a check mark when it succeeds.
  useEffect(() => {
    if (pending) {
      setWasPending(pending);
      return;
    }
    if (wasPending) {
      setWasPending(null);
      if (outcome === "ok") setRecentSuccess(wasPending);
    }
  }, [pending, wasPending, outcome]);

  useEffect(() => {
    if (!recentSuccess) return;
    const timer = window.setTimeout(() => setRecentSuccess(null), 900);
    return () => window.clearTimeout(timer);
  }, [recentSuccess]);

  // A host-key decision is never hidden inside a collapsed row.
  useEffect(() => {
    if (needsHostKeyDecision) setOpen(true);
  }, [needsHostKeyDecision, server.lastTest?.at]);

  const tone = statusTone(server);
  const statusLabel = t(`servers.status.${statusKey(server, pending)}`);
  const stats = server.lastStats;
  const address = `${server.username}@${server.host}${server.port === 22 ? "" : `:${server.port}`}`;
  const locale = i18n.language;

  const stripItems: Array<{ key: string; label: string; value: string }> = [];
  if (stats?.load)
    stripItems.push({
      key: "load",
      label: t("servers.stats.load"),
      value: stats.load.one.toFixed(2),
    });
  if (stats?.memory)
    stripItems.push({
      key: "memory",
      label: t("servers.stats.memory"),
      value: `${percent(stats.memory.usedBytes, stats.memory.totalBytes)}%`,
    });
  if (stats?.disk)
    stripItems.push({
      key: "disk",
      label: t("servers.stats.disk"),
      value: `${percent(stats.disk.usedBytes, stats.disk.totalBytes)}%`,
    });
  if (stats?.uptimeSeconds !== undefined)
    stripItems.push({
      key: "uptime",
      label: t("servers.stats.uptime"),
      value: formatUptime(stats.uptimeSeconds, t),
    });

  return (
    <div
      className={cn(
        SETTINGS_CARD_ROW_CLASS_NAME,
        justAdded && "servers-row-enter servers-highlight-sweep",
      )}
      data-slot="settings-row"
      data-server-id={server.id}
    >
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="mt-1.5 inline-flex">
            <ServerStatusDot tone={tone} busy={pending !== null} label={statusLabel} />
          </span>
          <span className="min-w-0 flex-1 space-y-0.5">
            <span className="block truncate text-sm font-medium text-[var(--color-text-foreground)]">
              {server.name}
            </span>
            <span className="block truncate font-mono text-[11px] text-muted-foreground">
              {address}
            </span>
            {server.tags.length > 0 ? (
              <span className="flex flex-wrap gap-1 pt-1">
                {server.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="px-1.5 py-0 text-[10px] font-normal"
                  >
                    {tag}
                  </Badge>
                ))}
              </span>
            ) : null}
          </span>
        </button>

        <div className="flex w-full shrink-0 items-center gap-3 sm:w-auto sm:justify-end">
          {stripItems.length > 0 ? (
            <dl className="hidden items-center gap-3 font-mono text-[11px] tabular-nums md:flex">
              {stripItems.map((item, index) => (
                <div
                  key={item.key}
                  className="servers-stat-enter flex items-baseline gap-1"
                  style={{ ["--servers-stat-index" as string]: index }}
                >
                  <dt className="text-muted-foreground">{item.label}</dt>
                  <dd className="text-[var(--color-text-foreground)]">{item.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
            {t(`servers.tier.${server.permissionTier}`)}
          </Badge>
          <Menu>
            <MenuTrigger
              render={<Button size="icon" variant="ghost" aria-label={t("servers.actions.more")} />}
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-44">
              <MenuItem onClick={onTest}>{t("servers.actions.test")}</MenuItem>
              <MenuItem onClick={onRefresh}>{t("servers.actions.refresh")}</MenuItem>
              <MenuItem onClick={onEdit}>{t("servers.actions.edit")}</MenuItem>
              <MenuItem onClick={onRemove} className="text-destructive">
                {t("servers.actions.remove")}
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>

      <DisclosureRegion open={open}>
        <div className="space-y-4 pt-4">
          {needsHostKeyDecision && server.lastTest ? (
            <div
              className={cn(
                "rounded-lg border p-3 text-xs",
                outcome === "host-key-unknown"
                  ? "border-warning/40 bg-warning/8"
                  : "border-destructive/40 bg-destructive/8",
              )}
              role="alert"
            >
              <p className="font-medium text-[var(--color-text-foreground)]">
                {outcome === "host-key-unknown"
                  ? t("servers.hostKey.title")
                  : t("servers.hostKey.changedTitle")}
              </p>
              <p className="mt-1 text-muted-foreground">
                {outcome === "host-key-unknown"
                  ? t("servers.hostKey.body")
                  : t("servers.hostKey.changedBody")}
              </p>
              {server.lastTest.hostKey ? (
                <div className="mt-3 space-y-1.5">
                  <div className="text-[11px] text-muted-foreground">
                    {t("servers.hostKey.keyType")}:{" "}
                    <span className="font-mono">{server.lastTest.hostKey.type}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-[var(--color-background-elevated-secondary)] px-1.5 py-1 font-mono text-[11px] break-all">
                      {server.lastTest.hostKey.fingerprint}
                    </code>
                    <CopyButton value={server.lastTest.hostKey.fingerprint} />
                  </div>
                </div>
              ) : null}
              {outcome === "host-key-unknown" && server.lastTest.hostKey ? (
                <div className="mt-3 flex gap-2">
                  <ActionButton
                    label={t("servers.actions.trust")}
                    busy={pending === "test"}
                    done={false}
                    variant="default"
                    onClick={() => onTrust(server.lastTest!.hostKey!.fingerprint)}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="servers-press"
                    onClick={() => setOpen(false)}
                  >
                    {t("servers.actions.notNow")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {stats?.memory || stats?.disk ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {stats.memory ? (
                <Bar
                  label={t("servers.stats.memory")}
                  used={stats.memory.usedBytes}
                  total={stats.memory.totalBytes}
                />
              ) : null}
              {stats.disk ? (
                <Bar
                  label={`${t("servers.stats.disk")} ${stats.disk.mountPoint}`}
                  used={stats.disk.usedBytes}
                  total={stats.disk.totalBytes}
                />
              ) : null}
            </div>
          ) : null}

          <dl className="grid gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-2">
            {[
              [t("servers.stats.hostname"), stats?.hostname],
              [t("servers.stats.os"), stats?.os],
              [t("servers.stats.kernel"), stats?.kernel],
              [
                t("servers.stats.load"),
                stats?.load
                  ? `${stats.load.one.toFixed(2)} ${stats.load.five.toFixed(2)} ${stats.load.fifteen.toFixed(2)}`
                  : undefined,
              ],
              [
                t("servers.stats.uptime"),
                stats?.uptimeSeconds !== undefined
                  ? formatUptime(stats.uptimeSeconds, t)
                  : undefined,
              ],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="truncate font-mono text-[var(--color-text-foreground)]">
                  {value ?? (
                    <span className="text-muted-foreground/70">
                      {t("servers.stats.unavailable")}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-col gap-2 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              {server.lastTest ? (
                <p>
                  {t("servers.status.lastTested", {
                    when: formatRelativeTime(new Date(server.lastTest.at).toISOString(), locale),
                  })}
                  {" · "}
                  <span
                    className={cn(
                      tone === "danger" && "text-destructive",
                      tone === "warning" && "text-warning-foreground",
                    )}
                  >
                    {statusLabel}
                  </span>
                  {server.lastTest.latencyMs !== undefined
                    ? ` · ${t("servers.status.latency", { ms: server.lastTest.latencyMs })}`
                    : ""}
                </p>
              ) : (
                <p>{t("servers.status.neverTested")}</p>
              )}
              {server.lastTest?.message && !needsHostKeyDecision ? (
                <p className="font-mono text-[10px] break-words text-muted-foreground/80">
                  {server.lastTest.message}
                </p>
              ) : null}
              {stats ? (
                <p>
                  {t("servers.stats.collected", {
                    when: formatRelativeTime(new Date(stats.collectedAt).toISOString(), locale),
                  })}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <ActionButton
                label={t("servers.actions.test")}
                busy={pending === "test"}
                done={recentSuccess === "test"}
                onClick={onTest}
              />
              <ActionButton
                label={t("servers.actions.refresh")}
                busy={pending === "refresh"}
                done={recentSuccess === "refresh"}
                onClick={onRefresh}
              />
            </div>
          </div>
        </div>
      </DisclosureRegion>
    </div>
  );
}
