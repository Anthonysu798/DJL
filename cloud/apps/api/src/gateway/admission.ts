/**
 * Gateway admission: an ordered chain of policies run before a request is
 * routed or reserved. The gateway runs kill switch → abuse → rate → window.
 *
 * A policy refuses by throwing an ApiError. It may return a release function
 * when it holds something for the request's lifetime (a concurrency slot);
 * the gateway calls it once the request settles, and the chain calls it
 * itself if a later policy refuses.
 */
import { eq } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";
import { decideAdmission } from "@djl/domain";

import type { Settings } from "../config/settings.ts";
import { ApiError } from "../http/errors.ts";
import { gatewayInFlight } from "../observability.ts";
import type { OrgPlan } from "../usage/plans.ts";
import type { RequestFacts } from "./GatewayService.ts";
import type { RateLimiter } from "./RateLimiter.ts";

export type PlanLimits = OrgPlan;

export interface AdmissionContext {
  readonly facts: RequestFacts;
  readonly limits: PlanLimits;
}

export type AdmissionRelease = () => Promise<void>;

export interface AdmissionPolicy {
  readonly name: string;
  readonly admit: (ctx: AdmissionContext) => Promise<AdmissionRelease | void>;
}

/** Placeholder for a slot another feature fills (abuse, usage windows). */
export const allowAll = (name: string): AdmissionPolicy => ({ name, admit: async () => {} });

/** Runs the policies in order; the returned release is idempotent. */
export async function runAdmission(
  policies: readonly AdmissionPolicy[],
  ctx: AdmissionContext,
): Promise<AdmissionRelease> {
  const held: AdmissionRelease[] = [];
  const releaseAll = async () => {
    for (const release of held.splice(0).toReversed()) await release();
  };
  try {
    for (const policy of policies) {
      const release = await policy.admit(ctx);
      if (release) held.push(release);
    }
  } catch (error) {
    await releaseAll();
    throw error;
  }
  return releaseAll;
}

export function killSwitchPolicy(db: DjlDatabase): AdmissionPolicy {
  return {
    name: "kill_switch",
    admit: async () => {
      const row = await db.query.killSwitches.findFirst({
        where: eq(schema.killSwitches.name, "gateway"),
      });
      if (row?.engaged)
        throw new ApiError(503, "gateway_paused", "The model gateway is temporarily paused.");
    },
  };
}

/** Plans at or above this weight are still admitted when the instance is at its hard cap. */
const TOP_PRIORITY_WEIGHT = 16;

/**
 * Per-user and per-IP request rates, the org's concurrent-stream slot, and the
 * instance's in-flight caps (from Settings). `load` is the instance counter
 * the gateway reports in its status.
 */
export function rateLimitPolicy(deps: {
  readonly limiter: RateLimiter;
  readonly settings: Settings;
  readonly load: { inFlight: number };
}): AdmissionPolicy {
  const { limiter, settings, load } = deps;
  return {
    name: "rate",
    admit: async ({ facts, limits }) => {
      const [ipPerMinute, softCap, hardCap] = await Promise.all([
        settings.get("gateway.ip_requests_per_minute"),
        settings.get("gateway.soft_cap_streams"),
        settings.get("gateway.hard_cap_streams"),
      ]);
      const perUser = await limiter.hit(
        `user:${facts.principal.userId}`,
        limits.requestsPerMinute,
        60,
      );
      if (!perUser.allowed)
        throw new ApiError(
          429,
          "rate_limited",
          `Too many requests. Retry in ${perUser.retryAfterSeconds}s.`,
        );
      if (facts.ipHash) {
        const perIp = await limiter.hit(`ip:${facts.ipHash}`, ipPerMinute, 60);
        if (!perIp.allowed)
          throw new ApiError(429, "rate_limited", "Too many requests from this network.");
      }
      const hold = await limiter.acquire(
        `org:${facts.principal.orgId}`,
        limits.concurrentStreams,
        600,
      );
      if (!hold.acquired)
        throw new ApiError(
          429,
          "rate_limited",
          `Your plan allows ${limits.concurrentStreams} concurrent streams.`,
        );
      const decision = decideAdmission({
        inFlight: load.inFlight,
        softCap,
        hardCap,
        priorityWeight: limits.priorityWeight,
        maxPriorityWeight: TOP_PRIORITY_WEIGHT,
      });
      if (decision !== "admit" && limits.priorityWeight < TOP_PRIORITY_WEIGHT) {
        await hold.release();
        throw new ApiError(503, "overloaded", "Servers are busy. Try again in a moment.");
      }
      load.inFlight += 1;
      gatewayInFlight.add(1);
      return async () => {
        load.inFlight -= 1;
        gatewayInFlight.add(-1);
        await hold.release();
      };
    },
  };
}
