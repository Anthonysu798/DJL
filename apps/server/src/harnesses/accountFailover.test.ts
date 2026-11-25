import type { CliAccountSummary, ServerProviderUsageSnapshot } from "@djl/contracts";
import { describe, expect, it } from "vitest";

import { isUsageLimitMessage, pickFailoverAccount, remainingUsagePercent } from "./accountFailover";

const account = (id: string, overrides: Partial<CliAccountSummary> = {}): CliAccountSummary => ({
  id,
  provider: "codex",
  name: id,
  isDefault: id === "default",
  active: false,
  status: "signedIn",
  email: null,
  ...overrides,
});
const usage = (accountId: string, fiveHour: number, weekly = 0) => ({
  accountId,
  provider: "codex" as const,
  snapshot: {
    provider: "codex",
    updatedAt: "now",
    limits: [
      { window: "5h", usedPercent: fiveHour },
      { window: "Weekly", usedPercent: weekly },
    ],
    usageLines: [],
    source: "test",
  } as unknown as ServerProviderUsageSnapshot,
});

describe("account failover", () => {
  it("recognises usage-limit failures", () => {
    expect(isUsageLimitMessage("You've hit your usage limit. Try again at 3:40 PM.")).toBe(true);
    expect(isUsageLimitMessage("Claude AI usage limit reached|1761234567")).toBe(true);
    expect(isUsageLimitMessage("429 Too Many Requests")).toBe(true);
    expect(isUsageLimitMessage("Working folder is unavailable")).toBe(false);
    expect(isUsageLimitMessage(null)).toBe(false);
  });

  it("measures usage left by the tighter window", () => {
    expect(remainingUsagePercent(usage("a", 30, 80).snapshot)).toBe(20);
    expect(remainingUsagePercent(undefined)).toBe(50);
  });

  it("picks the signed-in account with the most usage left and skips tried or limited ones", () => {
    const pick = pickFailoverAccount({
      provider: "codex",
      accounts: [
        account("default"),
        account("codex-a"),
        account("codex-b"),
        account("codex-out", { status: "signedOut" }),
        account("claude-x", { provider: "claudeAgent" }),
        account("codex-later"),
      ],
      usage: [
        usage("default", 100),
        usage("codex-a", 70),
        usage("codex-b", 10),
        usage("codex-later", 0),
      ],
      tried: new Set(["default"]),
      limitedUntil: new Map([["codex-later", 2_000]]),
      now: 1_000,
    });
    expect(pick?.id).toBe("codex-b");
  });

  it("returns null when every other account is out of usage", () => {
    expect(
      pickFailoverAccount({
        provider: "codex",
        accounts: [account("default"), account("codex-a")],
        usage: [usage("codex-a", 99)],
        tried: new Set(["default"]),
        limitedUntil: new Map(),
        now: 0,
      }),
    ).toBeNull();
  });
});
