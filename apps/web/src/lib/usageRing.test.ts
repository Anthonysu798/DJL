import type {
  CloudAccountStatus,
  ServerProviderStatus,
  ServerProviderUsageSnapshot,
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveUsageRingEntries,
  finishedTurnProviders,
  runningTurnsKey,
  selectLowestUsageRow,
} from "./usageRing";

const AT = "2099-04-08T18:00:00.000Z";

function snapshot(
  provider: ServerProviderUsageSnapshot["provider"],
  overrides: Partial<ServerProviderUsageSnapshot> = {},
): ServerProviderUsageSnapshot {
  return { provider, updatedAt: AT, limits: [], usageLines: [], source: "test", ...overrides };
}

function providerStatus(
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

function cloud(
  windows: { fiveHour: [limit: string, remaining: string]; week: [string, string] } | null,
  overrides: Partial<CloudAccountStatus> = {},
): CloudAccountStatus {
  return {
    signedIn: true,
    apiBaseUrl: "https://api.test",
    checkedAt: AT,
    ...(windows
      ? {
          usage: {
            planId: "starter",
            windows: {
              fiveHour: {
                kind: "five_hour",
                limit: windows.fiveHour[0],
                used: "0",
                remaining: windows.fiveHour[1],
                resetsAt: null,
              },
              week: {
                kind: "week",
                limit: windows.week[0],
                used: "0",
                remaining: windows.week[1],
                resetsAt: "2099-04-14T18:00:00.000Z",
              },
            },
            banks: { count: 0, nextExpiresAt: null },
          },
        }
      : {}),
    ...overrides,
  } as CloudAccountStatus;
}

describe("usageRing", () => {
  it("picks the lowest remaining row across providers without merging same-named windows", () => {
    const entries = deriveUsageRingEntries({
      cloud: null,
      providerStatuses: [],
      snapshots: [
        snapshot("claudeAgent", {
          planName: "Max",
          limits: [
            { window: "5h", usedPercent: 10 },
            { window: "Weekly", usedPercent: 88 },
          ],
        }),
        snapshot("codex", {
          limits: [
            { window: "5h", usedPercent: 40 },
            { window: "Weekly", usedPercent: 30 },
          ],
        }),
      ],
    });

    expect(entries.map((entry) => entry.provider)).toEqual(["codex", "claudeAgent"]);
    expect(entries.map((entry) => entry.rows.map((row) => row.id))).toEqual([
      ["codex-5h", "codex-Weekly"],
      ["claudeAgent-5h", "claudeAgent-Weekly"],
    ]);
    const lowest = selectLowestUsageRow(entries);
    expect(lowest?.entry.name).toBe("Claude");
    expect(lowest?.entry.planName).toBe("Max");
    expect(lowest?.row.label).toBe("Weekly");
    expect(lowest?.row.remainingPercent).toBe(12);
    expect(lowest?.row.remainingTone).toBe("warning");
  });

  it("uses whichever of the snapshot or the live turn limits is newer, per window", () => {
    const snapshots = [
      snapshot("codex", {
        limits: [
          { window: "5h", usedPercent: 40 },
          { window: "Weekly", usedPercent: 30 },
        ],
      }),
      snapshot("claudeAgent", { limits: [{ window: "5h", usedPercent: 20 }] }),
    ];
    const entries = deriveUsageRingEntries({
      cloud: null,
      providerStatuses: [],
      snapshots,
      liveRateLimits: [
        // Newer than the snapshot: its 5h window wins, Weekly stays from the snapshot.
        {
          provider: "codex",
          updatedAt: "2099-04-08T18:05:00.000Z",
          limits: [{ window: "5h", usedPercent: 95 }],
        },
        // Older than the snapshot: the snapshot keeps its value.
        {
          provider: "claudeAgent",
          updatedAt: "2099-04-08T17:00:00.000Z",
          limits: [{ window: "5h", usedPercent: 99 }],
        },
      ],
    });

    expect(entries.map((entry) => entry.rows.map((row) => [row.id, row.remainingPercent]))).toEqual(
      [
        [
          ["codex-5h", 5],
          ["codex-Weekly", 70],
        ],
        [["claudeAgent-5h", 80]],
      ],
    );
  });

  it("ignores live limits for a provider whose snapshot is not ok", () => {
    const entries = deriveUsageRingEntries({
      cloud: null,
      providerStatuses: [],
      snapshots: [snapshot("codex", { status: "needs-auth" })],
      liveRateLimits: [
        { provider: "codex", updatedAt: AT, limits: [{ window: "5h", usedPercent: 50 }] },
      ],
    });
    expect(entries[0]?.rows).toEqual([]);
  });

  it("folds DJL Cloud windows and credits in and lets them win the ring", () => {
    const entries = deriveUsageRingEntries({
      cloud: cloud({ fiveHour: ["1000000", "50000"], week: ["2000000", "1500000"] }, {
        credits: {
          orgId: "o1",
          balances: { trial: "0", plan: "2000000000", topup: "0" },
          total: "2000000000",
          display: { total: "2000.00", trial: "0.00", plan: "2000.00", topup: "0.00" },
        },
      } as Partial<CloudAccountStatus>),
      providerStatuses: [],
      snapshots: [snapshot("codex", { limits: [{ window: "Weekly", usedPercent: 50 }] })],
    });

    expect(entries.map((entry) => entry.provider)).toEqual(["djlCloud", "codex"]);
    const [djlCloud] = entries;
    expect(djlCloud?.planName).toBe("starter");
    expect(djlCloud?.credits).toBe("2000.00");
    expect(djlCloud?.rows.map((row) => [row.label, row.remainingPercent])).toEqual([
      ["5h", 5],
      ["Weekly", 75],
    ]);
    expect(djlCloud?.rows.every((row) => row.pace === null && row.markerPercent === null)).toBe(
      true,
    );
    const lowest = selectLowestUsageRow(entries);
    expect(lowest?.entry.provider).toBe("djlCloud");
    expect(lowest?.row.remainingTone).toBe("danger");
  });

  it("omits DJL Cloud when signed out or the session expired", () => {
    const signedOut = { signedIn: false, apiBaseUrl: "https://api.test", checkedAt: AT };
    const expired = cloud(
      { fiveHour: ["100", "1"], week: ["100", "1"] },
      { problem: "session_expired" },
    );
    for (const status of [signedOut, expired, null, undefined]) {
      expect(
        deriveUsageRingEntries({ cloud: status, providerStatuses: [], snapshots: [] }),
      ).toEqual([]);
    }
  });

  it("gives a window with a zero limit no row instead of a made-up percentage", () => {
    const entries = deriveUsageRingEntries({
      cloud: cloud({ fiveHour: ["0", "0"], week: ["0", "0"] }),
      providerStatuses: [],
      snapshots: [],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe("ok");
    expect(entries[0]?.rows).toEqual([]);
    expect(selectLowestUsageRow(entries)).toBeNull();
  });

  it("reports a fully used limit as zero left", () => {
    const entries = deriveUsageRingEntries({
      cloud: cloud({ fiveHour: ["1000", "0"], week: ["1000", "900"] }),
      providerStatuses: [],
      snapshots: [],
    });

    expect(selectLowestUsageRow(entries)?.row.remainingPercent).toBe(0);
  });

  it("keeps errored and signed-out providers listed but out of the ring", () => {
    const limits = [{ window: "Weekly", usedPercent: 99 }];
    const entries = deriveUsageRingEntries({
      cloud: cloud({ fiveHour: ["100", "1"], week: ["100", "1"] }, { problem: "unreachable" }),
      providerStatuses: [],
      snapshots: [
        snapshot("codex", { status: "error", limits, planName: "Pro" }),
        snapshot("claudeAgent", { status: "needs-auth", limits }),
        snapshot("cursor", { status: "unsupported", limits }),
        snapshot("gemini", { limits: [{ window: "Current", usedPercent: 20 }] }),
      ],
    });

    expect(entries.map((entry) => [entry.provider, entry.status, entry.rows.length])).toEqual([
      ["djlCloud", "error", 0],
      ["codex", "error", 0],
      ["claudeAgent", "needs-auth", 0],
      ["cursor", "unsupported", 0],
      ["gemini", "ok", 1],
    ]);
    expect(entries[1]?.planName).toBeNull();
    const lowest = selectLowestUsageRow(entries);
    expect(lowest?.entry.provider).toBe("gemini");
    expect(lowest?.row.remainingPercent).toBe(80);
  });

  it("lists signed-in agents without limit data and never gives them a number", () => {
    const entries = deriveUsageRingEntries({
      cloud: null,
      snapshots: [snapshot("codex", { limits: [{ window: "Weekly" }] })],
      providerStatuses: [
        providerStatus("codex"),
        providerStatus("opencode"),
        providerStatus("pi"),
        providerStatus("kimi", { authStatus: "unauthenticated" }),
        providerStatus("qwen", { authStatus: "unknown" }),
        providerStatus("grok", { available: false }),
        providerStatus("djlCloud"),
        providerStatus("group"),
      ],
    });

    expect(entries.map((entry) => entry.provider)).toEqual(["codex", "opencode", "pi"]);
    expect(entries.every((entry) => entry.status === "ok" && entry.rows.length === 0)).toBe(true);
    expect(selectLowestUsageRow(entries)).toBeNull();
  });

  it("has nothing to show before any data arrives", () => {
    const entries = deriveUsageRingEntries({
      cloud: undefined,
      providerStatuses: [],
      snapshots: [],
    });

    expect(entries).toEqual([]);
    expect(selectLowestUsageRow(entries)).toBeNull();
  });
});

const session = (provider: string, orchestrationStatus: string) =>
  ({ provider, orchestrationStatus }) as never;

describe("runningTurnsKey", () => {
  it("lists only the chats with a turn in progress, in a stable order", () => {
    expect(
      runningTurnsKey({
        b: session("claudeAgent", "running"),
        a: session("codex", "running"),
        c: session("cursor", "ready"),
        d: null,
      }),
    ).toBe("a:codex|b:claudeAgent");
    expect(runningTurnsKey({ c: session("cursor", "idle") })).toBe("");
    expect(runningTurnsKey(undefined)).toBe("");
  });

  it("names each agent whose turn just ended, once", () => {
    expect(finishedTurnProviders("a:codex|b:claudeAgent|c:codex", "b:claudeAgent")).toEqual([
      "codex",
    ]);
    expect(finishedTurnProviders("a:codex", "a:codex|b:gemini")).toEqual([]);
    expect(finishedTurnProviders("", "")).toEqual([]);
  });
});
