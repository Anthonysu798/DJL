/**
 * Gateway admission policy for abuse flags. An open `suspend` flag on the user
 * or their organization refuses the request; an open `warn` flag cuts the
 * user's request rate to a quarter of their plan's. Resolved flags are ignored.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { schema, type DjlDatabase } from "@djl/db";

import type { AdmissionPolicy } from "../gateway/admission.ts";
import type { RateLimiter } from "../gateway/RateLimiter.ts";
import { ApiError } from "../http/errors.ts";

const WARN_RATE_DIVISOR = 4;

export function abusePolicy(deps: {
  readonly db: DjlDatabase;
  readonly limiter: RateLimiter;
}): AdmissionPolicy {
  return {
    name: "abuse",
    admit: async ({ facts, limits }) => {
      const { userId, orgId } = facts.principal;
      const flags = await deps.db
        .select({ severity: schema.abuseFlags.severity })
        .from(schema.abuseFlags)
        .where(
          and(
            isNull(schema.abuseFlags.resolvedAt),
            inArray(schema.abuseFlags.severity, ["suspend", "warn"]),
            or(eq(schema.abuseFlags.userId, userId), eq(schema.abuseFlags.orgId, orgId)),
          ),
        );
      if (flags.some((f) => f.severity === "suspend"))
        throw new ApiError(403, "suspended", "This account is suspended. Contact support.");
      if (flags.length === 0) return;
      const limit = Math.max(1, Math.floor(limits.requestsPerMinute / WARN_RATE_DIVISOR));
      const hit = await deps.limiter.hit(`abuse-warn:${userId}`, limit, 60);
      if (!hit.allowed)
        throw new ApiError(
          429,
          "rate_limited",
          `Too many requests. Retry in ${hit.retryAfterSeconds}s.`,
        );
    },
  };
}
