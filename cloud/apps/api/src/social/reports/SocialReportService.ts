import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import {
  socialReportSchedules as schedules,
  socialWeeklyReports as reports,
} from "../../../../../packages/db/src/schema/socialReports.ts";
import type {
  CloudSocialReportScheduleInput,
  CloudSocialReportSchedule,
  CloudSocialWeeklyReport,
} from "../../../../../../packages/contracts/src/cloud/socialReports.ts";
import type { PublishingService } from "../publishing/PublishingService.ts";
import { isMember } from "../../auth/guard.ts";
import { ApiError } from "../../http/errors.ts";
import { nextWeeklyInstant, validateReportSchedule } from "./schedule.ts";

type Scope = { userId: string; orgId: string };
type Schedule = typeof schedules.$inferSelect;
type Provider = "instagram" | "tiktok" | "unknown";
type Metrics = CloudSocialWeeklyReport["posts"][number]["metrics"];
const unknownMetrics = (): Metrics => ({ views: null, likes: null, comments: null, shares: null });
const metricsKeys = ["views", "likes", "comments", "shares"] as const;
const providerName = (value: string | null): Provider =>
  value === "instagram" || value === "tiktok" ? value : "unknown";
const missing = () => new ApiError(404, "not_found", "Not found.");
const owned = (p: Scope) => and(eq(schedules.userId, p.userId), eq(schedules.orgId, p.orgId));

export class SocialReportService {
  constructor(
    private readonly db: DjlDatabase,
    private readonly publishing: Pick<PublishingService, "metrics">,
    private readonly now = () => new Date(),
  ) {}
  private async draft(p: Scope, id: string) {
    const [draft] = await this.db
      .select()
      .from(schema.socialDrafts)
      .where(
        and(
          eq(schema.socialDrafts.id, id),
          eq(schema.socialDrafts.userId, p.userId),
          eq(schema.socialDrafts.orgId, p.orgId),
        ),
      );
    if (!draft) throw missing();
    return draft;
  }
  private publicSchedule(
    row: Schedule | undefined,
    draft: { id: string; threadId: string; content: { timezone: string } },
  ): CloudSocialReportSchedule {
    return {
      id: row?.id ?? null,
      draftId: row?.draftId ?? draft.id,
      threadId: draft.threadId,
      enabled: row?.enabled ?? false,
      timezone: row?.timezone ?? draft.content.timezone,
      weekday: row?.weekday ?? 1,
      hour: row?.hour ?? 9,
      minute: row?.minute ?? 0,
      nextRunAt: row?.nextRunAt?.toISOString() ?? null,
    };
  }
  async getState(p: Scope, draftId: string) {
    const draft = await this.draft(p, draftId);
    const [schedule] = await this.db
      .select()
      .from(schedules)
      .where(and(owned(p), eq(schedules.threadId, draft.threadId)));
    const saved = await this.db
      .select({ content: reports.content })
      .from(reports)
      .where(
        and(
          eq(reports.userId, p.userId),
          eq(reports.orgId, p.orgId),
          eq(reports.threadId, draft.threadId),
        ),
      )
      .orderBy(desc(reports.periodEnd))
      .limit(12);
    return {
      schedule: this.publicSchedule(schedule, draft),
      reports: saved.map((row) => row.content),
    };
  }
  async getSchedule(p: Scope, draftId: string) {
    return (await this.getState(p, draftId)).schedule;
  }
  async setSchedule(p: Scope, draftId: string, input: CloudSocialReportScheduleInput) {
    validateReportSchedule(input);
    const draft = await this.draft(p, draftId);
    await this.db.transaction(async (tx) => {
      const next = input.enabled ? nextWeeklyInstant(this.now(), input) : null;
      const start = next ? nextWeeklyInstant(new Date(next.getTime() - 8 * 86400000), input) : null;
      await tx
        .insert(schedules)
        .values({
          ...p,
          draftId,
          threadId: draft.threadId,
          ...input,
          nextRunAt: next,
          periodStart: start,
        })
        .onConflictDoNothing();
      const [current] = await tx
        .select()
        .from(schedules)
        .where(and(owned(p), eq(schedules.threadId, draft.threadId)))
        .for("update");
      if (!current) throw missing();
      const unchanged =
        current.enabled === input.enabled &&
        current.timezone === input.timezone &&
        current.weekday === input.weekday &&
        current.hour === input.hour &&
        current.minute === input.minute;
      if (!unchanged)
        await tx
          .update(schedules)
          .set({ ...input, draftId, nextRunAt: next, periodStart: start, updatedAt: this.now() })
          .where(eq(schedules.id, current.id));
    });
    return this.getState(p, draftId);
  }
  async due(at = this.now(), limit = 20) {
    return (
      await this.db
        .select({ id: schedules.id })
        .from(schedules)
        .where(and(eq(schedules.enabled, true), lte(schedules.nextRunAt, at)))
        .orderBy(asc(schedules.nextRunAt))
        .limit(Math.max(1, Math.min(limit, 100)))
    ).map((row) => row.id);
  }
  /** Read-only provider calls. Row locking plus the period unique index make worker redelivery safe. */
  async execute(scheduleId: string, at = this.now(), maxPeriods = 1) {
    const periods = Math.max(1, Math.min(maxPeriods, 12));
    return this.db.transaction(async (tx) => {
      const [schedule] = await tx
        .select()
        .from(schedules)
        .where(
          and(
            eq(schedules.id, scheduleId),
            eq(schedules.enabled, true),
            lte(schedules.nextRunAt, at),
          ),
        )
        .for("update", { skipLocked: true });
      if (!schedule?.nextRunAt || !schedule.periodStart) return 0;
      const [user] = await tx
        .select({ banned: schema.user.banned })
        .from(schema.user)
        .where(eq(schema.user.id, schedule.userId));
      const [draft] = await tx
        .select({ threadId: schema.socialDrafts.threadId })
        .from(schema.socialDrafts)
        .where(
          and(
            eq(schema.socialDrafts.id, schedule.draftId),
            eq(schema.socialDrafts.userId, schedule.userId),
            eq(schema.socialDrafts.orgId, schedule.orgId),
          ),
        );
      if (
        !user ||
        user.banned ||
        !draft ||
        draft.threadId !== schedule.threadId ||
        !(await isMember(this.db, schedule.userId, schedule.orgId))
      ) {
        await tx
          .update(schedules)
          .set({ enabled: false, nextRunAt: null, updatedAt: this.now() })
          .where(eq(schedules.id, schedule.id));
        return 0;
      }
      let end = schedule.nextRunAt;
      let start = schedule.periodStart;
      let count = 0;
      while (end <= at && count < periods) {
        const [existing] = await tx
          .select({ id: reports.id })
          .from(reports)
          .where(and(eq(reports.scheduleId, schedule.id), eq(reports.periodEnd, end)));
        if (!existing) {
          const content = await this.collect(schedule, start, end);
          await tx
            .insert(reports)
            .values({
              id: content.id,
              scheduleId: schedule.id,
              orgId: schedule.orgId,
              userId: schedule.userId,
              threadId: schedule.threadId,
              periodStart: start,
              periodEnd: end,
              retrievedAt: new Date(content.retrievedAt),
              content,
            })
            .onConflictDoNothing();
        }
        count++;
        start = end;
        end = nextWeeklyInstant(end, schedule);
      }
      await tx
        .update(schedules)
        .set({ nextRunAt: end, periodStart: start, updatedAt: this.now() })
        .where(eq(schedules.id, schedule.id));
      return count;
    });
  }
  async tick(at = this.now(), options: { limit?: number; maxPeriodsPerSchedule?: number } = {}) {
    let generated = 0;
    for (const id of await this.due(at, options.limit ?? 20))
      generated += await this.execute(id, at, options.maxPeriodsPerSchedule ?? 3);
    return generated;
  }
  private async collect(
    schedule: Schedule,
    start: Date,
    end: Date,
  ): Promise<CloudSocialWeeklyReport> {
    const tasks = schema.socialPublishTasks;
    const accounts = schema.socialAccounts;
    const drafts = schema.socialDrafts;
    const condition = and(
      eq(tasks.userId, schedule.userId),
      eq(tasks.orgId, schedule.orgId),
      eq(drafts.threadId, schedule.threadId),
      eq(drafts.userId, schedule.userId),
      eq(drafts.orgId, schedule.orgId),
      eq(tasks.state, "published"),
      gte(tasks.updatedAt, start),
      lt(tasks.updatedAt, end),
    );
    const totals = await this.db
      .select({ provider: accounts.provider, count: sql<number>`count(*)::int` })
      .from(tasks)
      .innerJoin(drafts, eq(drafts.id, tasks.draftId))
      .leftJoin(
        accounts,
        and(
          eq(accounts.id, tasks.accountId),
          eq(accounts.userId, schedule.userId),
          eq(accounts.orgId, schedule.orgId),
        ),
      )
      .where(condition)
      .groupBy(accounts.provider);
    const rows = await this.db
      .select({ taskId: tasks.id, recordedAt: tasks.updatedAt, provider: accounts.provider })
      .from(tasks)
      .innerJoin(drafts, eq(drafts.id, tasks.draftId))
      .leftJoin(
        accounts,
        and(
          eq(accounts.id, tasks.accountId),
          eq(accounts.userId, schedule.userId),
          eq(accounts.orgId, schedule.orgId),
        ),
      )
      .where(condition)
      .orderBy(desc(tasks.updatedAt), asc(tasks.id))
      .limit(25);
    const posts: CloudSocialWeeklyReport["posts"][number][] = [];
    // Keep provider reads bounded. A partial provider failure never invents a metric.
    const collectPost = async (row: (typeof rows)[number]) => {
      let metrics = unknownMetrics();
      let postUrl: string | null = null;
      try {
        const result = await this.publishing.metrics(schedule, row.taskId);
        metrics = Object.fromEntries(
          metricsKeys.map((key) => [
            key,
            typeof result.metrics[key] === "number" &&
            Number.isFinite(result.metrics[key]) &&
            result.metrics[key]! >= 0
              ? result.metrics[key]
              : null,
          ]),
        ) as Metrics;
        postUrl = result.postUrl;
      } catch {
        /* Unavailable credentials/provider metrics remain null. */
      }
      return {
        taskId: row.taskId,
        provider: providerName(row.provider),
        postUrl,
        recordedAt: row.recordedAt.toISOString(),
        retrievedAt: this.now().toISOString(),
        metrics,
      };
    };
    for (let index = 0; index < rows.length; index += 4)
      posts.push(...(await Promise.all(rows.slice(index, index + 4).map(collectPost))));
    const providers = totals.map((total) => {
      const provider = providerName(total.provider);
      const included = posts.filter((post) => post.provider === provider);
      const metrics = Object.fromEntries(
        metricsKeys.map((key) => [
          key,
          included.length === total.count && included.every((post) => post.metrics[key] !== null)
            ? included.reduce((sum, post) => sum + post.metrics[key]!, 0)
            : null,
        ]),
      ) as Metrics;
      return { provider, publishedPosts: total.count, metrics };
    });
    const publishedPosts = totals.reduce((sum, total) => sum + total.count, 0);
    return {
      id: crypto.randomUUID(),
      threadId: schedule.threadId,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      retrievedAt: this.now().toISOString(),
      publishedPosts,
      inspectedPosts: posts.length,
      truncated: publishedPosts > posts.length,
      partial:
        publishedPosts > posts.length ||
        posts.some((post) => metricsKeys.some((key) => post.metrics[key] === null)),
      providers,
      posts,
    };
  }
}
