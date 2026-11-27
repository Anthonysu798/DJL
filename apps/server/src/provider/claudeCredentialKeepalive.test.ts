// FILE: claudeCredentialKeepalive.test.ts
// Purpose: Regression tests for the Claude login keepalive.
// Layer: Provider utility tests.
// Exports: Vitest coverage for apps/server/src/provider/claudeCredentialKeepalive.ts.
import { describe, it, assert } from "@effect/vitest";

import {
  CLAUDE_CREDENTIAL_KEEPALIVE_AUTH_STATUS_ARGS,
  CLAUDE_CREDENTIAL_KEEPALIVE_MAX_INTERVAL_MS,
  isClaudeCredentialKeepaliveEnabled,
  renewDueClaudeLogins,
  resolveClaudeCredentialKeepaliveBinaryPath,
  resolveClaudeCredentialKeepaliveIntervalMs,
} from "./claudeCredentialKeepalive.ts";

describe("claudeCredentialKeepalive", () => {
  it("uses the documented Claude auth status command", () => {
    assert.deepEqual([...CLAUDE_CREDENTIAL_KEEPALIVE_AUTH_STATUS_ARGS], ["auth", "status"]);
  });

  it("is on by default and opts out with DJL_CLAUDE_KEEPALIVE=0", () => {
    assert.equal(isClaudeCredentialKeepaliveEnabled({ env: {} }), true);
    assert.equal(isClaudeCredentialKeepaliveEnabled({ env: { DJL_CLAUDE_KEEPALIVE: "1" } }), true);
    assert.equal(isClaudeCredentialKeepaliveEnabled({ env: { DJL_CLAUDE_KEEPALIVE: "0" } }), false);
    assert.equal(
      isClaudeCredentialKeepaliveEnabled({ env: { DJL_CLAUDE_KEEPALIVE: "false" } }),
      false,
    );
  });

  it("renews, one at a time, only signed-in logins whose access token is running out", async () => {
    const now = Date.UTC(2026, 10, 26, 12);
    const logins: Record<string, { signedIn: boolean; accessExpiresAtMs: number | null }> = {
      main: { signedIn: true, accessExpiresAtMs: now - 60_000 },
      "/accounts/fresh": { signedIn: true, accessExpiresAtMs: now + 6 * 3_600_000 },
      "/accounts/due": { signedIn: true, accessExpiresAtMs: now + 5 * 60_000 },
      "/accounts/out": { signedIn: false, accessExpiresAtMs: null },
    };
    const order: string[] = [];
    let running = 0;
    const renewed = await renewDueClaudeLogins({
      configDirs: [undefined, "/accounts/fresh", "/accounts/due", "/accounts/out", "/accounts/due"],
      nowMs: now,
      readLogin: async (input) => ({
        ...logins[input?.configDir ?? "main"]!,
        email: null,
        subscriptionType: null,
      }),
      renew: async (configDir) => {
        running += 1;
        assert.equal(running, 1);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(configDir ?? "main");
        running -= 1;
      },
    });
    assert.deepEqual(order, ["main", "/accounts/due"]);
    assert.deepEqual(renewed, [undefined, "/accounts/due"]);
  });

  it("resolves configured Claude binary paths with a safe default", () => {
    assert.equal(
      resolveClaudeCredentialKeepaliveBinaryPath("/opt/homebrew/bin/claude"),
      "/opt/homebrew/bin/claude",
    );
    assert.equal(
      resolveClaudeCredentialKeepaliveBinaryPath("  /custom/bin/claude  "),
      "/custom/bin/claude",
    );
    assert.equal(resolveClaudeCredentialKeepaliveBinaryPath("   "), "claude");
    assert.equal(resolveClaudeCredentialKeepaliveBinaryPath(undefined), "claude");
  });

  it("clamps keepalive intervals to Node's maximum timer delay", () => {
    assert.equal(
      resolveClaudeCredentialKeepaliveIntervalMs({
        DJL_CLAUDE_KEEPALIVE_MINUTES: "60",
      }),
      60 * 60 * 1000,
    );
    assert.equal(
      resolveClaudeCredentialKeepaliveIntervalMs({
        DJL_CLAUDE_KEEPALIVE_MINUTES: "999999999",
      }),
      CLAUDE_CREDENTIAL_KEEPALIVE_MAX_INTERVAL_MS,
    );
  });

  it("falls back to the default interval for invalid tuning values", () => {
    assert.equal(
      resolveClaudeCredentialKeepaliveIntervalMs({
        DJL_CLAUDE_KEEPALIVE_MINUTES: "0",
      }),
      15 * 60 * 1000,
    );
    assert.equal(resolveClaudeCredentialKeepaliveIntervalMs({}), 15 * 60 * 1000);
  });
});
