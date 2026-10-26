import { and, isNull, lt, or } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import {
  readGithubAssetCounts,
  readStatsWorkerSummary,
  type AssetSnapshot,
  type AnalyticsFetch,
} from "@djl/api/analytics-sources";

interface AnalyticsJobDeps {
  readonly db: DjlDatabase;
  readonly now?: () => Date;
  readonly fetchImpl?: AnalyticsFetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export async function collectAnalyticsSources(
  deps: AnalyticsJobDeps,
): Promise<{ collected: number; failed: number }> {
  const env = deps.env ?? process.env;
  if (env.DJL_MOCK_EXTERNALS === "true" && !deps.fetchImpl) return { collected: 0, failed: 0 };
  const now = deps.now?.() ?? new Date();
  const github = readGithubAssetCounts({
    repo: env.ANALYTICS_GITHUB_REPO ?? "Anthonysu798/DJL",
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
  const stats = readStatsWorkerSummary({
    ...(env.ANALYTICS_STATS_URL ? { url: env.ANALYTICS_STATS_URL } : {}),
    ...(env.ANALYTICS_STATS_READ_TOKEN ? { token: env.ANALYTICS_STATS_READ_TOKEN } : {}),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
  const results = await Promise.allSettled([github, stats]);
  let collected = 0;
  let failed = 0;
  for (let index = 0; index < results.length; index++) {
    const result = results[index]!;
    const source = index === 0 ? "github" : "stats-worker";
    const snapshots: AssetSnapshot[] = result.status === "fulfilled" ? [...result.value] : [];
    if (result.status === "fulfilled" && source === "github") {
      snapshots.push({
        source: "github",
        dimensionKey: "downloads:total",
        value: snapshots.reduce((sum, item) => sum + item.value, 0n),
        metadata: { assetType: "aggregate" },
      });
    }
    if (result.status === "rejected") failed++;
    await deps.db.transaction(async (tx) => {
      if (snapshots.length) {
        const rows = await tx
          .insert(schema.analyticsSourceSnapshots)
          .values(
            snapshots.map((snapshot) => ({
              source: snapshot.source,
              dimensionKey: snapshot.dimensionKey,
              value: snapshot.value,
              metadata: snapshot.metadata,
              observedAt: now,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: schema.analyticsSourceSnapshots.id });
        collected += rows.length;
      }
      await tx
        .insert(schema.analyticsSourceSnapshots)
        .values({
          source,
          dimensionKey: "_health",
          observedAt: now,
          value: result.status === "fulfilled" ? 1n : 0n,
          metadata: {
            status: result.status === "fulfilled" ? "connected" : "error",
            visibility:
              source === "stats-worker" && env.ANALYTICS_STATS_READ_TOKEN ? "private" : "public",
          },
        })
        .onConflictDoNothing();
    });
  }
  return { collected, failed };
}

export async function pruneAnalytics(deps: Pick<AnalyticsJobDeps, "db" | "now">): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const rawCutoff = new Date(now.getTime() - 30 * 86_400_000);
  const aggregateCutoff = new Date(now.getTime() - 400 * 86_400_000);
  await deps.db
    .delete(schema.analyticsEvents)
    .where(lt(schema.analyticsEvents.receivedAt, rawCutoff));
  await deps.db
    .delete(schema.analyticsDailyActivity)
    .where(lt(schema.analyticsDailyActivity.day, aggregateCutoff.toISOString().slice(0, 10)));
  await deps.db
    .delete(schema.analyticsSourceSnapshots)
    .where(lt(schema.analyticsSourceSnapshots.observedAt, aggregateCutoff));
  await deps.db
    .delete(schema.analyticsInstallations)
    .where(
      or(
        lt(schema.analyticsInstallations.lastSeenAt, aggregateCutoff),
        and(
          isNull(schema.analyticsInstallations.lastSeenAt),
          lt(schema.analyticsInstallations.createdAt, aggregateCutoff),
        ),
      ),
    );
}
