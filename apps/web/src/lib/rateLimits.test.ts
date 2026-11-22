import type { OrchestrationThreadActivity } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { createAccountRateLimitsSelector } from "./rateLimits";

function activity(
  id: string,
  kind: string,
  payload: Record<string, unknown>,
  createdAt = "2099-04-08T18:00:00.000Z",
): OrchestrationThreadActivity {
  return { id, kind, payload, createdAt, tone: "info", summary: kind, turnId: null } as never;
}

// The shape ingestion stores for a native Codex `account/rateLimits/updated` notification.
const codexLimits = (usedPercent: number, createdAt?: string) =>
  activity(
    `codex-${usedPercent}`,
    "account.rate-limits.updated",
    {
      provider: "codex",
      rateLimits: {
        primary: { usedPercent, windowDurationMins: 300, resetsAt: 4_102_444_800 },
        secondary: null,
      },
    },
    createdAt,
  );

describe("createAccountRateLimitsSelector", () => {
  it("derives live limits from rate-limit activities across chats", () => {
    const select = createAccountRateLimitsSelector();
    const limits = select({
      activityByThreadId: {
        a: { one: codexLimits(92) },
        b: {
          two: activity("claude", "account.rate-limits.updated", {
            provider: "claudeAgent",
            rate_limit_info: { status: "allowed", rateLimitType: "seven_day", utilization: 0.4 },
          }),
        },
      },
    });
    expect(limits).toEqual([
      {
        provider: "codex",
        updatedAt: "2099-04-08T18:00:00.000Z",
        limits: [
          {
            window: "5h",
            usedPercent: 92,
            windowDurationMins: 300,
            resetsAt: "2100-01-01T00:00:00.000Z",
          },
        ],
      },
      {
        provider: "claudeAgent",
        updatedAt: "2099-04-08T18:00:00.000Z",
        limits: [{ window: "Weekly", usedPercent: 40, windowDurationMins: 10_080 }],
        status: "allowed",
      },
    ]);
  });

  it("keeps the same result while unrelated activity streams in", () => {
    const select = createAccountRateLimitsSelector();
    const limitsActivity = codexLimits(50);
    const first = select({ activityByThreadId: { a: { one: limitsActivity } } });
    const second = select({
      activityByThreadId: {
        a: { one: limitsActivity, tool: activity("tool", "tool.updated", { detail: "x" }) },
      },
    });
    expect(second).toBe(first);
  });

  it("returns the newer limits when a fresh update arrives", () => {
    const select = createAccountRateLimitsSelector();
    const first = select({ activityByThreadId: { a: { one: codexLimits(50) } } });
    const next = select({
      activityByThreadId: {
        a: { one: codexLimits(50), two: codexLimits(97, "2099-04-08T18:05:00.000Z") },
      },
    });
    expect(next).not.toBe(first);
    expect(next[0]?.limits?.[0]?.usedPercent).toBe(97);
  });

  it("returns an empty list with no activities", () => {
    expect(createAccountRateLimitsSelector()({})).toEqual([]);
  });
});
