"use client";
import { statusLabel } from "@/lib/i18n/status";
import { useI18n } from "@/components/LocaleProvider";
import { errorMessage } from "@/lib/i18n/errors";
import { useEffect, useRef, useState } from "react";
import { Activity, Cpu, HardDrive, MemoryStick, RefreshCw, Server } from "lucide-react";
import {
  SERVER_TARGETS,
  operationConfirmation,
  type ServerOverview,
  type ServerAction,
  type ServerJob,
} from "@djl/domain";
import { Shell } from "@/components/Shell";
import { PageCard, StatusPill } from "@/components/PageCard";
import { StatTile } from "@/components/charts/StatTile";
import { ReasonDialog, type ReasonField } from "@/components/ReasonDialog";
import { Button } from "@/components/ui/button";
import { admin } from "@/lib/api";

type Range = "hour" | "day" | "week";

function HistoryChart({
  title,
  rows,
  format,
  color = "var(--chart-1)",
}: {
  title: string;
  rows: { at: number; value: number | null }[];
  format: (n: number) => string;
  color?: string;
}) {
  const { t, time } = useI18n();
  const values = rows.filter((r): r is { at: number; value: number } => r.value !== null);
  const max = Math.max(1, ...values.map((r) => r.value));
  const points = values
    .map(
      (r, i) =>
        30 + (i / Math.max(1, values.length - 1)) * 570 + "," + (170 - (r.value / max) * 140),
    )
    .join(" ");
  return (
    <PageCard title={title}>
      {values.length < 2 ? (
        <p className="grid h-44 place-items-center text-sm text-muted-foreground">
          {t("servers.collecting")}
        </p>
      ) : (
        <>
          <svg viewBox="0 0 640 190" className="h-44 w-full" role="img" aria-label={title}>
            {[0, 0.5, 1].map((n) => (
              <g key={n}>
                <line
                  x1="30"
                  x2="600"
                  y1={170 - n * 140}
                  y2={170 - n * 140}
                  stroke="var(--border)"
                />
                <text x="32" y={164 - n * 140} fontSize="10" fill="var(--muted-foreground)">
                  {format(n * max)}
                </text>
              </g>
            ))}
            <polyline
              points={points}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>{time(new Date(values[0]!.at * 1000))}</span>
            <span>{time(new Date(values[values.length - 1]!.at * 1000))}</span>
          </div>
        </>
      )}
    </PageCard>
  );
}

function OperationButton({
  action,
  target,
  label,
  releaseId,
  disabled,
  onQueued,
}: {
  action: ServerAction;
  target: string;
  label: string;
  releaseId?: string | undefined;
  disabled?: boolean;
  onQueued: (id: string) => void;
}) {
  const { t } = useI18n();
  const requestId = useRef<string | null>(null);
  const confirmation = operationConfirmation(action, target);
  const descriptions: Record<ServerAction, string> = {
    restart: t("servers.restartDescription"),
    backup: t("servers.backupDescription"),
    deploy: t("servers.deployDescription"),
    rollback: t("servers.rollbackDescription"),
    reboot: t("servers.rebootDescription"),
    acknowledge: t("servers.ackDescription"),
  };
  const fields: ReasonField[] = [
    {
      name: "confirmation",
      label: t("servers.typeConfirmation", { confirmation }),
      placeholder: confirmation,
      validate: (v) => (v === confirmation ? null : t("validation.exactConfirmation")),
    },
  ];
  if (action !== "acknowledge")
    fields.push({
      name: "totp",
      label: t("servers.currentCode"),
      inputMode: "numeric",
      placeholder: t("servers.sixDigit"),
      validate: (v) => (/^\d{6}$/.test(v) ? null : t("validation.authenticatorCode")),
    });
  return (
    <ReasonDialog
      title={label}
      description={descriptions[action]}
      confirmLabel={label}
      destructive={action === "reboot" || action === "restart" || action === "rollback"}
      trigger={
        <Button
          variant={action === "reboot" ? "destructive" : "outline"}
          size="sm"
          disabled={disabled}
        >
          {label}
        </Button>
      }
      fields={fields}
      onConfirm={async (values, reason) => {
        requestId.current ??= crypto.randomUUID();
        const result = await admin<{ id: string }>("/servers/operations", {
          method: "POST",
          json: {
            requestId: requestId.current,
            action,
            target,
            reason,
            confirmation: values.confirmation,
            ...(releaseId ? { releaseId } : {}),
            ...(values.totp ? { totp: values.totp } : {}),
          },
        });
        onQueued(result.id);
        requestId.current = null;
      }}
    />
  );
}

export default function ServersPage() {
  const { t, locale, date, number, bytes, percent } = useI18n();
  const stamp = (at: number) =>
    date(new Date(at * 1000), { dateStyle: "medium", timeStyle: "short" });
  const [range, setRange] = useState<Range>("hour");
  const [data, setData] = useState<ServerOverview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [logService, setLogService] = useState("api");
  const [logs, setLogs] = useState<string[] | null>(null);
  const [logError, setLogError] = useState<unknown>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ServerJob | null>(null);
  const [operationError, setOperationError] = useState<unknown>(null);
  const [releaseTarget, setReleaseTarget] = useState("admin");
  const [releaseId, setReleaseId] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    const refresh = async () => {
      try {
        const next = await admin<ServerOverview>("/servers?range=" + range);
        if (active) {
          setData(next);
          setError(null);
        }
      } catch (e) {
        if (active) setError(e);
      } finally {
        if (active) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [range, revision]);
  useEffect(() => {
    let active = true;
    setLogs(null);
    setLogError(null);
    void admin<{ lines: string[] }>("/servers/logs?service=" + logService)
      .then((next) => {
        if (active) setLogs(next.lines);
      })
      .catch((e: Error) => {
        if (active) setLogError(e.message);
      });
    return () => {
      active = false;
    };
  }, [logService, revision]);
  useEffect(() => {
    if (!pendingId) return;
    let active = true;
    const poll = async () => {
      try {
        const next = await admin<ServerJob>("/servers/operations/" + pendingId);
        if (!active) return;
        setReceipt(next);
        setOperationError(null);
        if (["succeeded", "failed", "scheduled"].includes(next.status)) {
          setPendingId(null);
          setRevision((n) => n + 1);
        }
      } catch (e) {
        if (active) setOperationError(e);
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [pendingId]);
  const sample = data?.latest;
  const stale = !!sample && Date.now() / 1000 - sample.at > 60;
  const ready = !!sample && !error && !stale && !!data?.canControl;
  const selectClass = "h-9 max-w-full rounded-lg border bg-card px-3 text-sm";
  const queue = (id: string) => {
    setPendingId(id);
    setReceipt(null);
    setOperationError(null);
    setRevision((n) => n + 1);
  };
  const releases = data?.releases.filter((r) => r.service === releaseTarget) ?? [];
  return (
    <Shell
      title={t("nav.servers")}
      subtitle={t("servers.description")}
      actions={
        <div className="flex gap-2">
          <select
            className={selectClass}
            aria-label={t("servers.range")}
            value={range}
            onChange={(e) => setRange(e.target.value as Range)}
          >
            <option value="hour">{t("servers.hour")}</option>
            <option value="day">{t("servers.day")}</option>
            <option value="week">{t("servers.week")}</option>
          </select>
          <Button
            variant="outline"
            aria-label={t("servers.refresh")}
            onClick={() => setRevision((n) => n + 1)}
          >
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {error ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-danger-bg p-4 text-sm text-danger-fg"
          >
            {errorMessage(error, locale)}{" "}
            {data ? t("servers.lastSnapshot") : t("servers.connectMetrics")}
          </div>
        ) : null}
        {stale ? (
          <p role="alert" className="text-sm text-chart-2">
            {t("servers.stale")}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <Server className="size-4" />
            {data?.host ?? "DJL VPS"}
            {sample
              ? t("servers.uptime", {
                  days: number(Math.floor(sample.uptime / 86400)),
                  hours: number(Math.floor((sample.uptime % 86400) / 3600)),
                })
              : ""}
          </span>
          <span>
            {sample
              ? t("servers.sampled", { date: stamp(sample.at) })
              : loading
                ? t("servers.connecting")
                : t("servers.waitSample")}
          </span>
        </div>
        <div className="grid grid-flow-dense gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            icon={Cpu}
            label={t("servers.cpuUsage")}
            value={
              sample?.cpu !== null && sample?.cpu !== undefined ? percent(sample.cpu / 100) : "—"
            }
            hint={
              sample
                ? t("servers.load", {
                    value: sample.load
                      .map((v) => number(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
                      .join(" / "),
                  })
                : t("servers.waitCpu")
            }
          />
          <StatTile
            icon={MemoryStick}
            label={t("servers.memory")}
            value={
              sample
                ? sample.memoryTotal
                  ? percent(sample.memoryUsed / sample.memoryTotal)
                  : "—"
                : "—"
            }
            hint={
              sample
                ? t("servers.memoryDetail", {
                    used: bytes(sample.memoryUsed),
                    total: bytes(sample.memoryTotal),
                    swap: bytes(sample.swapUsed),
                  })
                : t("servers.cacheNote")
            }
          />
          <StatTile
            icon={HardDrive}
            label={t("servers.diskUsage")}
            value={
              sample ? (sample.diskTotal ? percent(sample.diskUsed / sample.diskTotal) : "—") : "—"
            }
            hint={
              sample
                ? t("servers.diskDetail", {
                    available: bytes(sample.diskTotal - sample.diskUsed),
                    total: bytes(sample.diskTotal),
                  })
                : t("servers.rootFs")
            }
          />
          <StatTile
            icon={Activity}
            label={t("servers.networkTraffic")}
            value={sample ? bytes(sample.receiveRate + sample.transmitRate) + "/s" : "—"}
            hint={
              sample
                ? t("servers.networkDetail", {
                    receive: bytes(sample.receiveRate),
                    transmit: bytes(sample.transmitRate),
                  })
                : t("servers.networkInterface")
            }
          />
        </div>
        <div className="grid grid-flow-dense gap-4 xl:grid-cols-2">
          <HistoryChart
            title={t("servers.cpuHistory")}
            rows={(data?.history ?? []).map((r) => ({ at: r.at, value: r.cpu }))}
            format={(n) => percent(n / 100)}
          />
          <HistoryChart
            title={t("servers.networkThroughput")}
            rows={(data?.history ?? []).map((r) => ({
              at: r.at,
              value: r.receiveRate + r.transmitRate,
            }))}
            format={(n) => bytes(n) + "/s"}
            color="var(--chart-4)"
          />
          <HistoryChart
            title={t("servers.memoryHistory")}
            rows={(data?.history ?? []).map((r) => ({
              at: r.at,
              value: r.memoryTotal ? (r.memoryUsed / r.memoryTotal) * 100 : null,
            }))}
            format={(n) => percent(n / 100)}
            color="var(--chart-3)"
          />
          <HistoryChart
            title={t("servers.diskActivity")}
            rows={(data?.history ?? []).map((r) => ({
              at: r.at,
              value: r.diskReadRate + r.diskWriteRate,
            }))}
            format={(n) => bytes(n) + "/s"}
            color="var(--chart-2)"
          />
        </div>
        <PageCard
          title={t("servers.apiTraffic")}
          action={<span className="text-xs text-muted-foreground">{t("servers.sampleNote")}</span>}
        >
          <dl className="grid gap-5 sm:grid-cols-3">
            <div>
              <dt className="text-sm text-muted-foreground">{t("servers.requests")}</dt>
              <dd className="mt-2 text-2xl tabular-nums">
                {data?.traffic ? number(data.traffic.requests) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t("servers.httpErrors")}</dt>
              <dd className="mt-2 text-2xl tabular-nums">
                {data?.traffic ? number(data.traffic.errors) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t("servers.latency")}</dt>
              <dd className="mt-2 text-2xl tabular-nums">
                {data?.traffic
                  ? number(data.traffic.averageLatencyMs, { maximumFractionDigits: 1 }) + " ms"
                  : "—"}
              </dd>
            </div>
          </dl>
          {data?.traffic ? (
            <div
              className="mt-5 flex h-16 items-end gap-px"
              role="img"
              aria-label={t("servers.apiHistory")}
            >
              {data.traffic.history.map((r) => (
                <div
                  key={r.at}
                  title={t("servers.requestsAt", { date: stamp(r.at), count: number(r.requests) })}
                  className="min-w-0 flex-1 bg-foreground/40"
                  style={{
                    height:
                      Math.max(
                        2,
                        (r.requests /
                          Math.max(1, ...data.traffic!.history.map((p) => p.requests))) *
                          100,
                      ) + "%",
                  }}
                />
              ))}
            </div>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">{t("servers.noTraffic")}</p>
          )}
        </PageCard>
        {pendingId || receipt || operationError ? (
          <div role="status" className="rounded-xl border bg-card p-4 text-sm">
            <div className="flex gap-2">
              <Activity className={pendingId ? "size-4 animate-pulse" : "size-4"} />
              <span>
                {receipt
                  ? statusLabel(receipt.status, t) + " · " + receipt.target
                  : t("servers.waitOperation")}
              </span>
            </div>
            {operationError ? (
              <p className="mt-2 text-muted-foreground">
                {errorMessage(operationError, locale)} {t("servers.interruption")}
              </p>
            ) : null}
          </div>
        ) : null}
        <PageCard title={t("servers.services")}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="pb-3">{t("servers.service")}</th>
                  <th>{t("common.state")}</th>
                  <th>CPU</th>
                  <th>{t("servers.memory")}</th>
                  <th>{t("servers.restarts")}</th>
                  <th>
                    <span className="sr-only">{t("servers.controls")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(data?.services ?? []).map((s) => (
                  <tr key={s.service} className="border-b last:border-0">
                    <td className="py-4 font-medium">{s.service}</td>
                    <td>
                      <StatusPill
                        tone={
                          s.state === "running" && ["healthy", "not-configured"].includes(s.health)
                            ? "success"
                            : "danger"
                        }
                      >
                        {statusLabel(s.health === "not-configured" ? s.state : s.health, t)}
                      </StatusPill>
                    </td>
                    <td className="pr-4 tabular-nums">
                      {s.state === "unavailable" ? "—" : percent(s.cpu / 100)}
                    </td>
                    <td className="pr-4 whitespace-nowrap">
                      {s.state === "unavailable"
                        ? "—"
                        : bytes(s.memoryUsed) + " / " + bytes(s.memoryLimit)}
                    </td>
                    <td className="tabular-nums">{number(s.restarts)}</td>
                    <td className="text-right">
                      <OperationButton
                        action="restart"
                        target={s.service}
                        label={t("servers.restartTarget", { service: s.service })}
                        disabled={!ready || !!pendingId}
                        onQueued={queue}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data ? (
            <p className="py-6 text-sm text-muted-foreground">{t("servers.noServices")}</p>
          ) : null}
        </PageCard>
        <div className="grid grid-flow-dense gap-4 xl:grid-cols-2">
          <PageCard title={t("servers.alerts")}>
            <div className="space-y-4">
              {data?.alerts.length ? (
                data.alerts.map((a) => (
                  <div key={a.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={a.severity === "critical" ? "text-danger-fg" : "text-chart-2"}
                      >
                        {a.title}
                      </span>
                      {a.acknowledgedAt ? (
                        <span className="text-xs text-muted-foreground">
                          {t("servers.reviewed")}
                        </span>
                      ) : (
                        <OperationButton
                          action="acknowledge"
                          target={a.id}
                          label={t("servers.acknowledge")}
                          disabled={!ready}
                          onQueued={queue}
                        />
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("servers.since", { date: stamp(a.openedAt) })}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  {data ? t("servers.noAlerts") : t("servers.waitAlerts")}
                </p>
              )}
            </div>
          </PageCard>
          <PageCard
            title={t("servers.backups")}
            action={
              <OperationButton
                action="backup"
                target="vps"
                label={t("servers.createBackup")}
                disabled={!ready || !!pendingId}
                onQueued={queue}
              />
            }
          >
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
              {t("servers.backupNote")}
            </p>
            {data?.backups.length ? (
              <ul className="space-y-3">
                {data.backups.map((b) => (
                  <li key={b.id} className="flex justify-between gap-3 text-sm">
                    <span>{stamp(b.createdAt)}</span>
                    <span className="text-muted-foreground">{bytes(b.bytes)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t("servers.noBackups")}</p>
            )}
          </PageCard>
        </div>
        <PageCard
          title={t("servers.logs")}
          action={
            <select
              className={selectClass}
              aria-label={t("servers.logService")}
              value={logService}
              onChange={(e) => setLogService(e.target.value)}
            >
              {SERVER_TARGETS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          }
        >
          <p className="mb-3 text-xs text-muted-foreground">{t("servers.logsNote")}</p>
          <pre className="max-h-72 overflow-auto rounded-lg border bg-background p-4 text-xs leading-6 text-muted-foreground">
            {(logError ? errorMessage(logError, locale) : null) ??
              (logs
                ? logs.length
                  ? logs.join("\n")
                  : t("servers.noLogs")
                : t("servers.loadingLogs"))}
          </pre>
        </PageCard>
        <PageCard title={t("servers.deployments")}>
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
            {t("servers.deployNote")}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <select
              className={selectClass}
              aria-label={t("servers.deployService")}
              value={releaseTarget}
              onChange={(e) => {
                setReleaseTarget(e.target.value);
                setReleaseId("");
              }}
            >
              {["admin", "api", "worker", "web"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className={selectClass + " min-w-0 flex-1"}
              aria-label={t("servers.verifiedRelease")}
              value={releaseId}
              onChange={(e) => setReleaseId(e.target.value)}
            >
              <option value="">{t("servers.chooseRelease")}</option>
              {releases.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label + " · " + r.checks + " checks" + (r.current ? t("servers.current") : "")}
                </option>
              ))}
            </select>
            <OperationButton
              action="deploy"
              target={releaseTarget}
              releaseId={releaseId}
              label={t("servers.apply")}
              disabled={!ready || !releaseId || !!pendingId}
              onQueued={queue}
            />
            <OperationButton
              action="rollback"
              target={releaseTarget}
              releaseId={releaseId}
              label={t("servers.rollback")}
              disabled={
                !ready ||
                !releaseId ||
                !!pendingId ||
                releases.find((r) => r.id === releaseId)?.current === true
              }
              onQueued={queue}
            />
          </div>
          {!releases.length ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("servers.noReleases")}</p>
          ) : null}
        </PageCard>
        <PageCard title={t("servers.operations")}>
          <div className="space-y-3">
            {data?.jobs.length ? (
              data.jobs.map((j) => (
                <div
                  key={j.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-0"
                >
                  <div>
                    <p className="text-sm">{j.action + " · " + j.target}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {j.message + " · " + stamp(j.createdAt)}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">{statusLabel(j.status, t)}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t("servers.noOperations")}</p>
            )}
          </div>
        </PageCard>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 p-5">
          <div>
            <h2 className="text-sm font-medium">{t("servers.rebootTitle")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{t("servers.rebootNote")}</p>
          </div>
          <OperationButton
            action="reboot"
            target="vps"
            label={t("servers.reboot")}
            disabled={!ready || !!pendingId}
            onQueued={queue}
          />
        </div>
      </div>
    </Shell>
  );
}
