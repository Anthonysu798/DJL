import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readClaudeLogin } from "./claudeLogin";

const now = Date.UTC(2026, 10, 26, 12);
let dir = "";
const store = (oauth: Record<string, unknown>) =>
  writeFile(join(dir, ".credentials.json"), JSON.stringify({ claudeAiOauth: oauth }));
// Linux keeps the login in .credentials.json, so no real Keychain is read here.
const read = () => readClaudeLogin({ configDir: dir, platform: "linux", nowMs: now });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "djl-claude-login-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("readClaudeLogin", () => {
  it("is signed in while a refresh token is stored, even after the access token ran out", async () => {
    await store({
      accessToken: "old",
      refreshToken: "refresh",
      expiresAt: now - 3_600_000,
      refreshTokenExpiresAt: now + 20 * 86_400_000,
      subscriptionType: "max",
    });
    await writeFile(
      join(dir, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "two@example.com" } }),
    );
    expect(await read()).toEqual({
      signedIn: true,
      email: "two@example.com",
      subscriptionType: "max",
      accessExpiresAtMs: now - 3_600_000,
    });
  });

  it("is signed out once Claude wiped the tokens", async () => {
    await store({ accessToken: "", refreshToken: "", expiresAt: 0, subscriptionType: "max" });
    expect((await read()).signedIn).toBe(false);
  });

  it("is signed out once the refresh token passed its own expiry", async () => {
    await store({
      accessToken: "old",
      refreshToken: "refresh",
      expiresAt: now - 3_600_000,
      refreshTokenExpiresAt: now - 60_000,
    });
    expect((await read()).signedIn).toBe(false);
  });

  it("is signed in on a valid access token without a refresh token", async () => {
    await store({ accessToken: "token", expiresAt: now + 3_600_000 });
    expect((await read()).signedIn).toBe(true);
  });

  it("is signed out with no stored login", async () => {
    expect((await read()).signedIn).toBe(false);
  });
});
