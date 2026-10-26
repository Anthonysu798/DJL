import { sql } from "drizzle-orm";
import type { DjlDatabase } from "@djl/db";
import type {
  AnalyticsAccountActivity,
  AnalyticsPlatform,
  AnalyticsRange,
  AnalyticsReport,
  AnalyticsSourceHealth,
} from "@synara/contracts/cloud";
import { requirePermission, type AdminPrincipal } from "../admin/AdminAuth.ts";
import { ApiError } from "../http/errors.ts";
import { writeAudit } from "../audit/AuditLog.ts";
import { analyticsCsv, analyticsRows } from "./export.ts";

export class AnalyticsAdminService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly clock: { now: () => Date } = { now: () => new Date() },
    private readonly environment: AnalyticsReport["environment"] = "local",
  ) {}

  async accountActivity(
    principal: AdminPrincipal,
    userId: string,
  ): Promise<AnalyticsAccountActivity> {
    requirePermission(principal, "users.read");
    if (!principal.mfaVerified)
      throw new ApiError(403, "mfa_required", "Administrator verification required.");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new ApiError(400, "invalid_user", "Invalid user.");
    const since = new Date(this.clock.now().getTime() - 30 * 86_400_000).toISOString();
    const filter = sql`a.user_id=${userId} AND a.day>=${since.slice(0, 10)} AND a.channel IN ('stable','beta')
      AND a.first_seen_at <= ${this.clock.now().toISOString()}::timestamptz
      AND EXISTS (SELECT 1 FROM "user" u WHERE u.id=a.user_id AND u.ban_reason IS DISTINCT FROM 'self_delete')`;
    const [platforms, features] = await Promise.all([
      this.db.execute<AnalyticsAccountActivity["platforms"][number]>(
        sql`SELECT a.platform,count(DISTINCT a.installation_id)::int AS installations,max(a.last_seen_at)::text AS "lastSeenAt" FROM analytics_daily_activity a WHERE ${filter} GROUP BY a.platform ORDER BY a.platform`,
      ),
      this.db.execute<AnalyticsAccountActivity["features"][number]>(
        sql`SELECT a.feature,sum(a.events)::int AS actions FROM analytics_daily_activity a WHERE ${filter} AND a.feature <> 'app' GROUP BY a.feature ORDER BY a.feature`,
      ),
    ]);
    return {
      since,
      platforms: platforms.map((row) => ({
        ...row,
        lastSeenAt: new Date(row.lastSeenAt).toISOString(),
      })),
      features: [...features],
    };
  }

  async export(
    principal: AdminPrincipal,
    input: { range: AnalyticsRange; platform?: AnalyticsPlatform | null; includeTest?: boolean },
  ): Promise<string> {
    const report = await this.report(principal, input);
    const csv = analyticsCsv(report);
    await this.db.transaction(async (tx) =>
      writeAudit(tx, {
        actorType: "admin",
        actorId: principal.adminId,
        action: "analytics.export",
        targetType: "analytics",
        targetId: "product-analytics",
        after: {
          range: report.range,
          platform: report.platform,
          includeTest: report.includeTest,
          rowCount: analyticsRows(report).length - 1,
        },
        reason: "Internal aggregate analytics export",
      }),
    );
    return csv;
  }

  async report(
    principal: AdminPrincipal,
    input: { range: AnalyticsRange; platform?: AnalyticsPlatform | null; includeTest?: boolean },
  ): Promise<AnalyticsReport> {
    requirePermission(principal, "stats.read");
    if (!principal.mfaVerified)
      throw new ApiError(403, "mfa_required", "Administrator verification required.");
    if (
      !["day", "week", "month", "year"].includes(input.range) ||
      (input.platform && !["desktop", "ios", "web"].includes(input.platform))
    )
      throw new ApiError(400, "invalid_analytics_filter", "Invalid analytics filter.");
    const days = { day: 1, week: 7, month: 30, year: 365 }[input.range];
    const now = this.clock.now();
    const since = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days + 1),
    );
    const platform = input.platform ?? null;
    const sinceIso = since.toISOString();
    const nowIso = now.toISOString();
    const day = sinceIso.slice(0, 10);
    const activityFilter = sql`a.day >= ${day} AND a.day <= ${nowIso.slice(0, 10)} AND a.first_seen_at <= ${nowIso}::timestamptz
      AND (${platform}::text IS NULL OR a.platform = ${platform})
      AND (${input.includeTest === true} OR a.channel IN ('stable','beta'))
      AND (a.user_id IS NULL OR EXISTS (SELECT 1 FROM "user" u WHERE u.id = a.user_id AND u.ban_reason IS DISTINCT FROM 'self_delete'))`;
    const installFilter = sql`(${platform}::text IS NULL OR i.platform = ${platform}) AND (${input.includeTest === true} OR i.channel IN ('stable','beta'))`;
    const cloudFilter = sql`r.created_at >= ${sinceIso}::timestamptz AND r.created_at <= ${nowIso}::timestamptz
      AND (${platform}::text IS NULL OR d.kind = ${platform}) AND (r.user_id IS NULL OR EXISTS (SELECT 1 FROM "user" u WHERE u.id = r.user_id AND u.ban_reason IS DISTINCT FROM 'self_delete'))`;
    const [
      accounts,
      activity,
      installed,
      cloud,
      history,
      platforms,
      versions,
      features,
      cohorts,
      sourceRows,
      downloads,
      health,
      downloadHistory,
    ] = await Promise.all([
      this.db.execute<AnalyticsReport["accounts"]>(sql`SELECT
        (SELECT count(*)::int FROM "user" WHERE ban_reason IS DISTINCT FROM 'self_delete') AS registered,
        (SELECT count(*)::int FROM organization) AS organizations,
        (SELECT count(DISTINCT org_id)::int FROM subscriptions WHERE status = 'active') AS "paidOrganizations"`),
      this.db.execute<{ activeAccounts: number; activeInstallations: number }>(sql`SELECT
        (SELECT count(DISTINCT user_id)::int FROM (
          SELECT a.user_id FROM analytics_daily_activity a WHERE ${activityFilter}
          UNION ALL SELECT r.user_id FROM usage_requests r LEFT JOIN devices d ON d.id = r.device_id AND d.user_id = r.user_id WHERE ${cloudFilter}
        ) actors) AS "activeAccounts",
        count(DISTINCT a.installation_id)::int AS "activeInstallations" FROM analytics_daily_activity a WHERE ${activityFilter}`),
      this.db.execute<{
        recentlyActiveInstallations: number;
        reportingInstallations: number;
        reportingStartedAt: string | null;
      }>(sql`SELECT
        count(*) FILTER (WHERE i.last_seen_at >= ${new Date(now.getTime() - 300_000).toISOString()}::timestamptz AND i.last_seen_at <= ${nowIso}::timestamptz)::int AS "recentlyActiveInstallations",
        count(*) FILTER (WHERE i.first_opened_at IS NOT NULL)::int AS "reportingInstallations",
        min(i.first_opened_at)::text AS "reportingStartedAt" FROM analytics_installations i WHERE ${installFilter}`),
      this.db.execute<
        Omit<AnalyticsReport["cloud"], "revenueUsdCents"> & { revenueUsdCents: string }
      >(sql`SELECT count(*)::int AS requests,
        count(*) FILTER (WHERE r.status='settled')::int AS successful,
        count(*) FILTER (WHERE r.status IN ('failed','released','cut_off'))::int AS failed,
        count(*) FILTER (WHERE r.status IN ('reserved','streaming'))::int AS pending,
        coalesce(sum(r.input_tokens),0)::text AS "inputTokens", coalesce(sum(r.output_tokens),0)::text AS "outputTokens",
        coalesce(sum(r.settled_micro),0)::text AS "creditsMicro",
        (SELECT coalesce(sum(amount_paid_usd_cents),0)::text FROM invoices WHERE created_at >= ${sinceIso}::timestamptz AND created_at <= ${nowIso}::timestamptz) AS "revenueUsdCents",
        count(*) FILTER (WHERE d.kind IS NULL)::int AS "unattributedRequests" FROM usage_requests r LEFT JOIN devices d ON d.id=r.device_id AND d.user_id=r.user_id WHERE ${cloudFilter}`),
      this.db.execute<AnalyticsReport["history"][number]>(sql`WITH activity AS (
          SELECT a.day, a.user_id, a.installation_id FROM analytics_daily_activity a WHERE ${activityFilter}
          UNION ALL SELECT to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD'), r.user_id, NULL::uuid FROM usage_requests r LEFT JOIN devices d ON d.id=r.device_id AND d.user_id=r.user_id WHERE ${cloudFilter}
        ) SELECT day, count(DISTINCT user_id)::int AS "activeAccounts", count(DISTINCT installation_id)::int AS "activeInstallations" FROM activity GROUP BY day ORDER BY day`),
      this.db.execute<AnalyticsReport["platforms"][number]>(
        sql`SELECT a.platform, count(DISTINCT a.user_id)::int AS "activeAccounts", count(DISTINCT a.installation_id)::int AS "activeInstallations" FROM analytics_daily_activity a WHERE ${activityFilter} GROUP BY a.platform ORDER BY 3 DESC`,
      ),
      this.db.execute<AnalyticsReport["versions"][number]>(
        sql`SELECT a.platform,a.app_version AS "appVersion",count(DISTINCT a.installation_id)::int AS "activeInstallations" FROM analytics_daily_activity a WHERE ${activityFilter} GROUP BY a.platform,a.app_version ORDER BY 3 DESC LIMIT 50`,
      ),
      this.db.execute<AnalyticsReport["features"][number]>(
        sql`SELECT a.feature,sum(a.events)::int AS actions,count(DISTINCT a.user_id)::int AS "activeAccounts" FROM analytics_daily_activity a WHERE ${activityFilter} AND a.feature<>'app' GROUP BY a.feature ORDER BY 2 DESC`,
      ),
      this.db.execute<
        AnalyticsReport["cohorts"][number]
      >(sql`SELECT to_char(i.first_opened_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,count(*)::int AS installations,
        CASE WHEN (min(i.first_opened_at) AT TIME ZONE 'UTC')::date + 2 <= ${nowIso.slice(0, 10)}::date THEN
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_daily_activity a WHERE a.installation_id=i.id AND a.day=to_char((i.first_opened_at AT TIME ZONE 'UTC') + interval '1 day','YYYY-MM-DD')))::int ELSE NULL END AS "retainedDay1",
        CASE WHEN (min(i.first_opened_at) AT TIME ZONE 'UTC')::date + 8 <= ${nowIso.slice(0, 10)}::date THEN
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_daily_activity a WHERE a.installation_id=i.id AND a.day=to_char((i.first_opened_at AT TIME ZONE 'UTC') + interval '7 days','YYYY-MM-DD')))::int ELSE NULL END AS "retainedDay7"
        FROM analytics_installations i WHERE ${installFilter} AND i.first_opened_at >= ${sinceIso}::timestamptz AND i.first_opened_at <= ${nowIso}::timestamptz GROUP BY 1 ORDER BY 1 DESC LIMIT 30`),
      this.db.execute<{ source: string; last: string; first: string }>(
        sql`SELECT source,max(observed_at)::text AS last,min(observed_at)::text AS first FROM analytics_source_snapshots WHERE dimension_key <> '_health' AND observed_at <= ${nowIso}::timestamptz GROUP BY source`,
      ),
      this.db.execute<
        AnalyticsReport["downloads"][number]
      >(sql`WITH latest AS (SELECT DISTINCT ON (source,dimension_key) source,dimension_key AS dimension,value::text AS count,observed_at::text AS "observedAt",
        metadata->>'platform' AS platform,metadata->>'version' AS version,metadata->>'assetType' AS "assetType",metadata->>'name' AS name
        FROM analytics_source_snapshots WHERE dimension_key <> '_health' AND observed_at <= ${nowIso}::timestamptz ORDER BY source,dimension_key,observed_at DESC)
        SELECT * FROM latest ORDER BY CASE WHEN dimension LIKE '%:total' OR dimension LIKE 'visits:%' THEN 0 ELSE 1 END, source, "observedAt" DESC, dimension LIMIT 200`),
      this.db.execute<{
        source: string;
        status: string;
        visibility: "public" | "private";
        at: string;
      }>(
        sql`SELECT DISTINCT ON(source) source,metadata->>'status' AS status,metadata->>'visibility' AS visibility,observed_at::text AS at FROM analytics_source_snapshots WHERE dimension_key='_health' AND observed_at <= ${nowIso}::timestamptz ORDER BY source,observed_at DESC`,
      ),
      this.db.execute<AnalyticsReport["downloadHistory"][number]>(sql`WITH observations AS (
        SELECT source,observed_at,value,lag(value) OVER (PARTITION BY source,dimension_key ORDER BY observed_at) AS previous
        FROM analytics_source_snapshots WHERE observed_at <= ${nowIso}::timestamptz AND
          ((source='github' AND dimension_key LIKE 'asset:%') OR (source='stats-worker' AND dimension_key='downloads:total'))
        ) SELECT to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,source,
          sum(greatest(value-previous,0))::text AS downloads FROM observations
          WHERE previous IS NOT NULL AND observed_at >= ${sinceIso}::timestamptz
          GROUP BY 1,2 ORDER BY 1,2`),
    ]);
    const sources: AnalyticsSourceHealth[] = (["stats-worker", "github", "app-store"] as const).map(
      (id) => {
        const row = sourceRows.find((source) => source.source === id);
        const attempt = health.find((source) => source.source === id);
        const observedAt = attempt?.status === "connected" ? attempt.at : row?.last;
        return {
          id,
          status:
            attempt?.status === "error"
              ? "error"
              : !row
                ? "disconnected"
                : now.getTime() - new Date(observedAt!).getTime() > 3_600_000
                  ? "stale"
                  : "connected",
          lastObservedAt: observedAt ? new Date(observedAt).toISOString() : null,
          lastAttemptAt: attempt ? new Date(attempt.at).toISOString() : null,
          coverageStartedAt: row ? new Date(row.first).toISOString() : null,
          visibility: attempt?.visibility ?? null,
        };
      },
    );
    return {
      environment: this.environment,
      range: input.range,
      since: sinceIso,
      asOf: nowIso,
      platform,
      includeTest: input.includeTest === true,
      accounts: accounts[0]!,
      activity: {
        ...activity[0]!,
        ...installed[0]!,
        reportingStartedAt: installed[0]?.reportingStartedAt
          ? new Date(installed[0].reportingStartedAt).toISOString()
          : null,
      },
      cloud: cloud[0]!,
      history: [...history],
      platforms: [...platforms],
      versions: [...versions],
      features: [...features],
      cohorts: [...cohorts],
      sources,
      downloadHistory: [...downloadHistory],
      downloads: [...downloads],
    };
  }
}
