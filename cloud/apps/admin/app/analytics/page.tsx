"use client";
import { useState } from "react";
import { Activity, Download, Laptop, Users, Wallet } from "lucide-react";
import type { AnalyticsPlatform, AnalyticsRange, AnalyticsReport } from "@synara/contracts/cloud";
import { Shell } from "@/components/Shell";
import { PageCard, headRowClass, rowClass } from "@/components/PageCard";
import { StatTile } from "@/components/charts/StatTile";
import { Bars } from "@/components/charts/Bars";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/components/LocaleProvider";
import { admin } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import type { MessageKey } from "@/lib/i18n";

const featureLabels: Record<string, MessageKey> = {
  cloud_chat: "analytics.cloudChat",
  local_task: "analytics.localTask",
  remote_control: "analytics.remote",
  voice: "analytics.voice",
  images: "analytics.images",
};
const rangeLabels: Record<AnalyticsRange, MessageKey> = {
  day: "range.today",
  week: "range.week",
  month: "range.month",
  year: "range.year",
};
const platformLabels: Record<AnalyticsPlatform, MessageKey> = {
  desktop: "analytics.desktop",
  ios: "analytics.ios",
  web: "analytics.web",
};
const selectStyle = "rounded-lg border border-border bg-card px-3 py-2 text-sm";

export default function AnalyticsPage() {
  const { t, number, date, credits, currency, percent } = useI18n();
  const [range, setRange] = useState<AnalyticsRange>("week");
  const [platform, setPlatform] = useState<AnalyticsPlatform | "all">("all");
  const [includeTest, setIncludeTest] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const report = useLoad(
    () =>
      admin<AnalyticsReport>(
        `/analytics?range=${range}${platform === "all" ? "" : `&platform=${platform}`}&includeTest=${includeTest}`,
      ),
    [range, platform, includeTest],
  );
  const data = report.data;
  const count = (source: string, dimension: string) => {
    const row = data?.downloads.find(
      (entry) => entry.source === source && entry.dimension === dimension,
    );
    return row ? number(BigInt(row.count)) : "—";
  };
  const platformName = (value: string) =>
    platformLabels[value as AnalyticsPlatform]
      ? t(platformLabels[value as AnalyticsPlatform])
      : value;
  const exportReport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const result = await admin<{ csv: string }>("/analytics/export", {
        method: "POST",
        json: { range, ...(platform === "all" ? {} : { platform }), includeTest },
      });
      const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "djl-product-analytics.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError(t("common.error"));
    } finally {
      setExporting(false);
    }
  };
  return (
    <Shell
      title={t("nav.analytics")}
      subtitle={t("analytics.description")}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t("common.range")}
            value={range}
            className={selectStyle}
            onChange={(event) => setRange(event.target.value as AnalyticsRange)}
          >
            {Object.entries(rangeLabels).map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </select>
          <select
            aria-label={t("analytics.platform")}
            value={platform}
            className={selectStyle}
            onChange={(event) => setPlatform(event.target.value as AnalyticsPlatform | "all")}
          >
            <option value="all">{t("analytics.allPlatforms")}</option>
            {Object.entries(platformLabels).map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            disabled={!data || exporting}
            onClick={() => void exportReport()}
          >
            {t("analytics.export")}
          </Button>
          <Button variant="outline" onClick={report.reload}>
            {t("common.refresh")}
          </Button>
        </div>
      }
    >
      <label className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={includeTest}
          onChange={(event) => setIncludeTest(event.target.checked)}
        />
        {t("analytics.testData")}
      </label>
      {report.error || exportError ? (
        <p role="alert" className="mb-5 text-sm text-destructive">
          {report.error ?? exportError}
        </p>
      ) : null}
      {!data ? (
        <p role="status">{t("common.loading")}</p>
      ) : (
        <div className="space-y-5">
          <p className="text-xs text-muted-foreground">
            {t("analytics.environment", {
              environment: t(
                (
                  {
                    local: "analytics.environmentLocal",
                    test: "analytics.environmentTest",
                    staging: "analytics.environmentStaging",
                    production: "analytics.environmentProduction",
                  } as const
                )[data.environment],
              ),
            })}{" "}
            · {t("analytics.observed")}:{" "}
            {date(data.asOf, { dateStyle: "medium", timeStyle: "short" })}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label={t("analytics.registered")}
              icon={Users}
              value={number(data.accounts.registered)}
            />
            <StatTile
              label={t("analytics.activeAccounts")}
              icon={Activity}
              value={number(data.activity.activeAccounts)}
              hint={t("analytics.activeAccountsHint")}
            />
            <StatTile
              label={t("analytics.recent")}
              icon={Laptop}
              value={number(data.activity.recentlyActiveInstallations)}
            />
            <StatTile
              label={t("dashboard.gatewayRequests")}
              icon={Activity}
              value={number(data.cloud.requests)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label={t("analytics.githubDownloads")}
              icon={Download}
              value={count("github", "downloads:total")}
            />
            <StatTile
              label={t("analytics.redirects")}
              icon={Download}
              value={count("stats-worker", "downloads:total")}
            />
            <StatTile
              label={t("analytics.legacyInstalls")}
              icon={Laptop}
              value={count("stats-worker", "installs:total")}
            />
            <StatTile
              label={t("analytics.reportingInstalls")}
              icon={Laptop}
              value={number(data.activity.reportingInstallations)}
              hint={t("analytics.reportingHint")}
            />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <Bars
              title={t("analytics.activity")}
              rows={data.history.map((row) => ({ day: row.day, value: row.activeAccounts }))}
            />
            <PageCard title={t("analytics.platforms")}>
              <Table>
                <TableHeader>
                  <TableRow className={headRowClass}>
                    <TableHead>{t("analytics.platform")}</TableHead>
                    <TableHead>{t("analytics.activeAccounts")}</TableHead>
                    <TableHead>{t("analytics.activeInstalls")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.platforms.map((row) => (
                    <TableRow key={row.platform} className={rowClass}>
                      <TableCell>{platformName(row.platform)}</TableCell>
                      <TableCell>{number(row.activeAccounts)}</TableCell>
                      <TableCell>{number(row.activeInstallations)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!data.platforms.length ? (
                <p className="mt-4 text-sm text-muted-foreground">{t("charts.noData")}</p>
              ) : null}
            </PageCard>
          </div>
          <PageCard title={t("analytics.sources")}>
            <div className="grid gap-4 md:grid-cols-3">
              {data.sources.map((source) => (
                <div key={source.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {source.id === "github"
                        ? "GitHub"
                        : source.id === "app-store"
                          ? "App Store"
                          : "DJL Stats"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t(`analytics.${source.status}`)}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {source.visibility
                      ? t(`analytics.${source.visibility}`)
                      : t("analytics.unknown")}
                  </p>
                  <dl className="mt-3 space-y-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">{t("analytics.observed")}</dt>
                      <dd>
                        {source.lastObservedAt
                          ? date(source.lastObservedAt, { dateStyle: "medium", timeStyle: "short" })
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("analytics.coverage")}</dt>
                      <dd>{source.coverageStartedAt ? date(source.coverageStartedAt) : "—"}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          </PageCard>
          <PageCard title={t("analytics.downloadHistory")}>
            <p className="mb-4 text-xs text-muted-foreground">
              {t("analytics.downloadHistoryHint")}
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("charts.day")}</TableHead>
                  <TableHead>{t("common.source")}</TableHead>
                  <TableHead>{t("analytics.count")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.downloadHistory.map((row) => (
                  <TableRow key={`${row.source}:${row.day}`}>
                    <TableCell>
                      {date(`${row.day}T00:00:00Z`, { timeZone: "UTC", dateStyle: "medium" })}
                    </TableCell>
                    <TableCell>{row.source === "github" ? "GitHub" : "DJL Stats"}</TableCell>
                    <TableCell>{number(BigInt(row.downloads))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!data.downloadHistory.length ? (
              <p className="mt-4 text-sm text-muted-foreground">{t("charts.noData")}</p>
            ) : null}
          </PageCard>
          <PageCard title={t("analytics.assets")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.source")}</TableHead>
                  <TableHead>{t("analytics.dimension")}</TableHead>
                  <TableHead>{t("analytics.count")}</TableHead>
                  <TableHead>{t("analytics.observed")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.downloads.map((row) => (
                  <TableRow key={`${row.source}:${row.dimension}`}>
                    <TableCell>{row.source === "github" ? "GitHub" : "DJL Stats"}</TableCell>
                    <TableCell className="max-w-96 break-all">
                      {row.name ?? row.dimension}
                    </TableCell>
                    <TableCell>{number(BigInt(row.count))}</TableCell>
                    <TableCell>
                      {date(row.observedAt, { dateStyle: "medium", timeStyle: "short" })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PageCard>
          <div className="grid gap-5 xl:grid-cols-2">
            <PageCard title={t("analytics.features")}>
              <Table>
                <TableHeader>
                  <TableRow className={headRowClass}>
                    <TableHead>{t("analytics.feature")}</TableHead>
                    <TableHead>{t("common.actions")}</TableHead>
                    <TableHead>{t("analytics.activeAccounts")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.features.map((row) => (
                    <TableRow key={row.feature} className={rowClass}>
                      <TableCell>
                        {featureLabels[row.feature] ? t(featureLabels[row.feature]!) : row.feature}
                      </TableCell>
                      <TableCell>{number(row.actions)}</TableCell>
                      <TableCell>{number(row.activeAccounts)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!data.features.length ? (
                <p className="mt-4 text-sm text-muted-foreground">{t("charts.noData")}</p>
              ) : null}
            </PageCard>
            <PageCard title={t("analytics.cloudUsage")}>
              <dl className="grid gap-4 sm:grid-cols-2">
                {[
                  [t("analytics.inputTokens"), number(BigInt(data.cloud.inputTokens))],
                  [t("analytics.outputTokens"), number(BigInt(data.cloud.outputTokens))],
                  [t("analytics.spent"), credits(data.cloud.creditsMicro)],
                  [t("analytics.totalRevenue"), currency(Number(data.cloud.revenueUsdCents) / 100)],
                  [t("analytics.success"), number(data.cloud.successful)],
                  [t("analytics.failed"), number(data.cloud.failed)],
                  [t("analytics.pending"), number(data.cloud.pending)],
                  [t("analytics.unattributed"), number(data.cloud.unattributedRequests)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 text-lg tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </PageCard>
          </div>
          <PageCard title={t("analytics.retention")}>
            <Table>
              <TableHeader>
                <TableRow className={headRowClass}>
                  <TableHead>{t("charts.day")}</TableHead>
                  <TableHead>{t("analytics.reportingInstalls")}</TableHead>
                  <TableHead>{t("analytics.day1")}</TableHead>
                  <TableHead>{t("analytics.day7")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.cohorts.map((row) => (
                  <TableRow key={row.day} className={rowClass}>
                    <TableCell>
                      {date(`${row.day}T00:00:00Z`, { dateStyle: "medium", timeZone: "UTC" })}
                    </TableCell>
                    <TableCell>{number(row.installations)}</TableCell>
                    <TableCell>
                      {row.retainedDay1 === null
                        ? t("analytics.notMature")
                        : percent(row.retainedDay1 / row.installations)}
                    </TableCell>
                    <TableCell>
                      {row.retainedDay7 === null
                        ? t("analytics.notMature")
                        : percent(row.retainedDay7 / row.installations)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!data.cohorts.length ? (
              <p className="mt-4 text-sm text-muted-foreground">{t("charts.noData")}</p>
            ) : null}
          </PageCard>
          <PageCard title={t("analytics.versions")}>
            <Table>
              <TableHeader>
                <TableRow className={headRowClass}>
                  <TableHead>{t("analytics.platform")}</TableHead>
                  <TableHead>{t("common.version")}</TableHead>
                  <TableHead>{t("analytics.activeInstalls")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.versions.map((row) => (
                  <TableRow key={`${row.platform}:${row.appVersion}`} className={rowClass}>
                    <TableCell>{platformName(row.platform)}</TableCell>
                    <TableCell>{row.appVersion}</TableCell>
                    <TableCell>{number(row.activeInstallations)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PageCard>
          <p className="max-w-5xl text-xs leading-relaxed text-muted-foreground">
            {t("analytics.provenance")}
          </p>
        </div>
      )}
    </Shell>
  );
}
