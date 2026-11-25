// FILE: providerUsage/providers/cursor.test.ts
// Purpose: A stale Cursor editor token must not hide a valid cursor-agent (CLI) login.

import { afterEach, describe, expect, it, vi } from "vitest";

const keychain = vi.hoisted(() => ({ value: null as string | null }));
const stateDb = vi.hoisted(() => ({ values: {} as Record<string, string> }));

vi.mock("../credentials", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../credentials")>()),
  readKeychainPassword: async () => keychain.value,
}));
vi.mock("../sqlite", () => ({
  readItemTableValues: async () => stateDb.values,
}));

import { cursorUsageFetcher } from "./cursor";

const NOW_MS = 1_780_000_000_000;

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function jwt(expMs: number, tag: string): string {
  return `${encode({ alg: "none" })}.${encode({ exp: Math.floor(expMs / 1000), tag })}.sig`;
}

function usageResponse(): Response {
  return new Response(JSON.stringify({ planUsage: { totalPercentUsed: 30 } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const ctx = { homeDir: "/nonexistent", env: {}, platform: "darwin" as const, nowMs: NOW_MS };

afterEach(() => {
  vi.unstubAllGlobals();
  keychain.value = null;
  stateDb.values = {};
});

describe("cursorUsageFetcher", () => {
  it("uses the cursor-agent token when the editor token has expired", async () => {
    const cliToken = jwt(NOW_MS + 3_600_000, "cli");
    keychain.value = cliToken;
    stateDb.values = { "cursorAuth/accessToken": jwt(NOW_MS - 60_000, "ide") };
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe(`Bearer ${cliToken}`);
      return usageResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await cursorUsageFetcher.fetch(ctx);

    expect(snapshot.status).toBe("ok");
    expect(snapshot.limits[0]?.usedPercent).toBe(30);
  });

  it("falls back to the editor token when the CLI token is rejected", async () => {
    const cliToken = jwt(NOW_MS + 3_600_000, "cli");
    const ideToken = jwt(NOW_MS + 3_600_000, "ide");
    keychain.value = cliToken;
    stateDb.values = { "cursorAuth/accessToken": ideToken };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        const auth = headers?.Authorization;
        return auth === `Bearer ${cliToken}`
          ? new Response("{}", { status: 401 })
          : usageResponse();
      }),
    );

    const snapshot = await cursorUsageFetcher.fetch(ctx);

    expect(snapshot.status).toBe("ok");
  });

  it("reports needs-auth only when every token is expired", async () => {
    keychain.value = jwt(NOW_MS - 1, "cli");
    stateDb.values = { "cursorAuth/accessToken": jwt(NOW_MS - 1, "ide") };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await cursorUsageFetcher.fetch(ctx);

    expect(snapshot.status).toBe("needs-auth");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
