"use client";
import type { AnalyticsAccountActivity } from "@synara/contracts/cloud";
import { PageCard } from "@/components/PageCard";
import { useI18n } from "@/components/LocaleProvider";
import { admin } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";
import type { MessageKey } from "@/lib/i18n";
const features: Record<string, MessageKey> = {
  cloud_chat: "analytics.cloudChat",
  local_task: "analytics.localTask",
  remote_control: "analytics.remote",
  voice: "analytics.voice",
  images: "analytics.images",
};
const platforms: Record<string, MessageKey> = {
  ios: "analytics.ios",
  desktop: "analytics.desktop",
  web: "analytics.web",
};
export function ProductActivityPanel({ userId }: { userId: string }) {
  const { t, number, date } = useI18n();
  const report = useLoad(
    () => admin<AnalyticsAccountActivity>(`/users/${userId}/analytics`),
    [userId],
  );
  return (
    <PageCard title={t("analytics.userActivity")}>
      <p className="mb-4 text-xs text-muted-foreground">{t("analytics.userActivityHint")}</p>
      {report.error ? <p role="alert">{report.error}</p> : null}
      <dl className="grid gap-4 sm:grid-cols-2">
        {report.data?.platforms.map((row) => (
          <div key={row.platform}>
            <dt>{platforms[row.platform] ? t(platforms[row.platform]!) : row.platform}</dt>
            <dd>
              {t("analytics.reportingInstalls")}: {number(row.installations)} ·{" "}
              {t("analytics.lastActivity")}:{" "}
              {date(row.lastSeenAt, { dateStyle: "medium", timeStyle: "short" })}
            </dd>
          </div>
        ))}
      </dl>
      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        {report.data?.features.map((row) => (
          <div key={row.feature}>
            <dt className="text-sm text-muted-foreground">
              {features[row.feature] ? t(features[row.feature]!) : row.feature}
            </dt>
            <dd>{number(row.actions)}</dd>
          </div>
        ))}
      </dl>
      {report.data && !report.data.platforms.length ? (
        <p className="text-sm text-muted-foreground">{t("charts.noData")}</p>
      ) : null}
    </PageCard>
  );
}
