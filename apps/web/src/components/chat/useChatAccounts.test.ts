import type { OrchestrationThreadActivity, ServerProviderUsageSnapshot } from "@djl/contracts";
import { describe, expect, it } from "vitest";

import { latestAccountSwitch, usageLeftPercent, withChatAccount } from "./useChatAccounts";

const switched = (provider: string, toId: string, createdAt: string) =>
  ({
    id: `a-${toId}`,
    kind: "account.switched",
    tone: "info",
    summary: "Switched account",
    payload: { provider, toId },
    turnId: null,
    createdAt,
  }) as unknown as OrchestrationThreadActivity;

describe("chat accounts", () => {
  it("reads usage left from the tighter of the 5-hour and weekly windows", () => {
    const snapshot = {
      limits: [
        { window: "5h", usedPercent: 40 },
        { window: "Weekly", usedPercent: 75 },
        { window: "Opus", usedPercent: 99 },
      ],
    } as unknown as ServerProviderUsageSnapshot;
    expect(usageLeftPercent(snapshot)).toBe(25);
    expect(usageLeftPercent(null)).toBeNull();
  });

  it("finds the newest automatic switch for a provider", () => {
    const activities = [
      switched("codex", "codex-a", "2026-11-24T10:00:00Z"),
      switched("claudeAgent", "claude-b", "2026-11-24T11:00:00Z"),
      switched("codex", "codex-c", "2026-11-24T12:00:00Z"),
    ];
    expect(latestAccountSwitch(activities, "codex")).toEqual({
      id: "codex-c",
      at: Date.parse("2026-11-24T12:00:00Z"),
    });
    expect(latestAccountSwitch([], "codex")).toBeNull();
  });

  it("adds only the chat's explicit choice to turn options", () => {
    const base = { codex: { binaryPath: "codex" }, claudeAgent: { binaryPath: "claude" } };
    expect(withChatAccount(base, {})).toBe(base);
    expect(withChatAccount(base, { codex: { cliAccountId: "codex-a" } })).toEqual({
      codex: { binaryPath: "codex", cliAccountId: "codex-a" },
      claudeAgent: { binaryPath: "claude" },
    });
  });
});
