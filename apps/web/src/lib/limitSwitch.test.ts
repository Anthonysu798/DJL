import type { ServerProviderStatus, ServerProviderUsageSnapshot } from "@djl/contracts";
import { describe, expect, it } from "vitest";

import {
  isRateLimitError,
  limitSwitchNoticeKey,
  pickLimitSwitchTarget,
  selectLowLimitRow,
} from "./limitSwitch";
import { deriveUsageRingEntries } from "./usageRing";

const AT = "2099-04-08T18:00:00.000Z";

function snapshot(
  provider: ServerProviderUsageSnapshot["provider"],
  usedPercents: number[] = [],
  overrides: Partial<ServerProviderUsageSnapshot> = {},
): ServerProviderUsageSnapshot {
  return {
    provider,
    updatedAt: AT,
    limits: usedPercents.map((usedPercent, index) => ({
      window: index === 0 ? "5h" : "Weekly",
      usedPercent,
      resetsAt: "2099-04-08T20:00:00.000Z",
    })),
    usageLines: [],
    source: "test",
    ...overrides,
  };
}

function status(
  provider: ServerProviderStatus["provider"],
  overrides: Partial<ServerProviderStatus> = {},
): ServerProviderStatus {
  return {
    provider,
    status: "ready",
    available: true,
    authStatus: "authenticated",
    checkedAt: AT,
    ...overrides,
  };
}

function entries(
  snapshots: ServerProviderUsageSnapshot[],
  providerStatuses: ServerProviderStatus[] = [],
) {
  return deriveUsageRingEntries({ snapshots, providerStatuses, cloud: null });
}

describe("selectLowLimitRow", () => {
  it("returns the lowest window at or below 10% left", () => {
    const [codex] = entries([snapshot("codex", [50, 90])]);
    expect(selectLowLimitRow(codex)?.label).toBe("Weekly");
    expect(selectLowLimitRow(codex)?.remainingPercent).toBe(10);
  });

  it("returns null with room left or no limit data", () => {
    const [healthy, unknown] = entries([snapshot("codex", [50, 89]), snapshot("claudeAgent")]);
    expect(selectLowLimitRow(healthy)).toBeNull();
    expect(selectLowLimitRow(unknown)).toBeNull();
    expect(selectLowLimitRow(undefined)).toBeNull();
  });
});

describe("pickLimitSwitchTarget", () => {
  it("prefers the signed-in agent with the most quota left", () => {
    const target = pickLimitSwitchTarget({
      current: "codex",
      entries: entries([
        snapshot("codex", [99]),
        snapshot("claudeAgent", [60, 70]),
        snapshot("cursor", [10]),
        snapshot("gemini"),
      ]),
      providerStatuses: [],
    });
    expect(target?.provider).toBe("cursor");
  });

  it("prefers known quota over unknown, and unknown over nothing", () => {
    const withUnknown = entries(
      [snapshot("codex", [99]), snapshot("claudeAgent", [80])],
      [status("grok")],
    );
    expect(
      pickLimitSwitchTarget({ current: "codex", entries: withUnknown, providerStatuses: [] })
        ?.provider,
    ).toBe("claudeAgent");

    const onlyUnknown = entries([snapshot("codex", [99])], [status("grok")]);
    expect(
      pickLimitSwitchTarget({ current: "codex", entries: onlyUnknown, providerStatuses: [] })
        ?.provider,
    ).toBe("grok");
  });

  it("never offers an agent that is itself low, signed out, unavailable or not a handoff target", () => {
    const target = pickLimitSwitchTarget({
      current: "codex",
      entries: [
        ...entries([
          snapshot("codex", [20]),
          snapshot("claudeAgent", [95]),
          snapshot("cursor", [], { status: "needs-auth" }),
          snapshot("gemini", [10]),
        ]),
        {
          key: "djlCloud",
          provider: "djlCloud",
          inUse: null,
          name: "DJL Cloud",
          planName: null,
          status: "ok",
          cliSignedIn: true,
          rows: [],
          usageLines: [],
          credits: null,
          source: null,
        },
      ],
      providerStatuses: [status("gemini", { available: false })],
    });
    expect(target).toBeNull();
  });
});

describe("isRateLimitError", () => {
  it.each([
    "Rate limit reached",
    "You've hit your usage limit. Try again at 5pm.",
    "429 Too Many Requests",
    "rate_limit_error: overloaded",
  ])("recognizes %s", (message) => {
    expect(isRateLimitError(message)).toBe(true);
  });

  it.each([null, undefined, "", "Working folder is unavailable", "Context window exceeded"])(
    "ignores %s",
    (message) => {
      expect(isRateLimitError(message)).toBe(false);
    },
  );
});

describe("limitSwitchNoticeKey", () => {
  it("names the agent and window, so a new window after a reset asks again", () => {
    const [codex] = entries([snapshot("codex", [95])]);
    const row = selectLowLimitRow(codex)!;
    expect(limitSwitchNoticeKey(row)).toBe("codex-5h|2099-04-08T20:00:00.000Z");
    expect(limitSwitchNoticeKey({ ...row, resetsAt: "2099-04-09T01:00:00.000Z" })).not.toBe(
      limitSwitchNoticeKey(row),
    );
  });
});
