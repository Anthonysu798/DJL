import { and, desc, eq, gt } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { DEFAULT_PLANS, type PlanId, type WindowCaps } from "@djl/domain";

export interface OrgPlan {
  readonly planId: PlanId;
  readonly concurrentStreams: number;
  readonly requestsPerMinute: number;
  readonly priorityWeight: number;
  readonly windowCaps: WindowCaps;
}

/**
 * The plan an org is on: its active subscription, else a live phone-verified
 * trial, else the free plan. Limits come from the admin-editable plans row,
 * falling back to the domain defaults when the row is missing.
 */
export async function planForOrg(db: DjlDatabase, orgId: string, now: Date): Promise<OrgPlan> {
  const sub = await db.query.subscriptions.findFirst({
    where: and(eq(schema.subscriptions.orgId, orgId), eq(schema.subscriptions.status, "active")),
    orderBy: [desc(schema.subscriptions.createdAt)],
  });
  const trial = sub
    ? undefined
    : await db.query.trialGrants.findFirst({
        where: and(
          eq(schema.trialGrants.orgId, orgId),
          eq(schema.trialGrants.status, "granted"),
          gt(schema.trialGrants.expiresAt, now),
        ),
      });
  const planId: PlanId = sub?.planId ?? (trial ? "trial" : "free");
  const row = await db.query.plans.findFirst({ where: eq(schema.plans.id, planId) });
  if (row)
    return {
      planId,
      concurrentStreams: row.concurrentStreams,
      requestsPerMinute: row.requestsPerMinute,
      priorityWeight: row.priorityWeight,
      windowCaps: { fiveHour: row.window5hMicro, week: row.windowWeekMicro },
    };
  const plan = DEFAULT_PLANS.find((p) => p.id === planId)!;
  return {
    planId,
    concurrentStreams: plan.concurrentStreams,
    requestsPerMinute: plan.requestsPerMinute,
    priorityWeight: plan.priorityWeight,
    windowCaps: { fiveHour: plan.window5h, week: plan.windowWeek },
  };
}
