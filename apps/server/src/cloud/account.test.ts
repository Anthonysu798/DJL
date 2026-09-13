import type { FetchLike } from "./api";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CloudAccount } from "./account";
import { cloudSessionPath, readCloudSession, writeCloudSession } from "./session";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let secretsDir = "";
beforeEach(async () => {
  secretsDir = await mkdtemp(join(tmpdir(), "djl-cloud-"));
  process.env.DJL_CLOUD_API_URL = "https://cloud.test";
});
afterEach(() => {
  delete process.env.DJL_CLOUD_API_URL;
});

describe("cloud session store", () => {
  it("writes the session with owner-only permissions and reads it back", async () => {
    await writeCloudSession(secretsDir, {
      apiBaseUrl: "https://cloud.test",
      token: "tok",
      userId: "u1",
      email: "a@b.c",
      orgId: "o1",
      createdAt: "2026-09-12T00:00:00.000Z",
    });
    const mode = (await stat(cloudSessionPath(secretsDir))).mode & 0o777;
    expect(mode).toBe(0o600);
    expect((await readCloudSession(secretsDir))?.email).toBe("a@b.c");
    expect(JSON.parse(await readFile(cloudSessionPath(secretsDir), "utf8")).token).toBe("tok");
  });

  it("returns null for a missing or malformed file", async () => {
    expect(await readCloudSession(secretsDir)).toBeNull();
  });
});

describe("CloudAccount device flow", () => {
  it("starts sign-in, polls until approved, stores the session, and reports credits", async () => {
    const calls: string[] = [];
    let polls = 0;
    const fetchImpl: FetchLike = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/v1/auth/device/code")) {
        return jsonResponse(200, {
          device_code: "dev-1",
          user_code: "ABCD-EFGH",
          verification_uri: "https://app.test/device",
          verification_uri_complete: "https://app.test/device?user_code=ABCD-EFGH",
          expires_in: 600,
          interval: 5,
        });
      }
      if (url.endsWith("/v1/auth/device/token")) {
        polls += 1;
        if (polls === 1) return jsonResponse(400, { error: { code: "authorization_pending", message: "pending" } });
        return jsonResponse(200, { access_token: "sess-1", token_type: "Bearer" });
      }
      if (url.endsWith("/v1/me")) return jsonResponse(200, { user: { id: "u1", email: "me@test.invalid" }, activeOrgId: "o1" });
      if (url.endsWith("/v1/credits")) {
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sess-1");
        return jsonResponse(200, { orgId: "o1", balances: { trial: "0", plan: "0", topup: "2500000000" }, total: "2500000000", display: { total: "2500.00", trial: "0.00", plan: "0.00", topup: "2500.00" } });
      }
      if (url.endsWith("/v1/auth/sign-out")) return jsonResponse(200, { success: true });
      return jsonResponse(404, { error: { code: "not_found", message: "nope" } });
    };
    const account = new CloudAccount({ secretsDir, region: async () => "auto", fetchImpl });
    expect((await account.status()).signedIn).toBe(false);
    const start = await account.startSignIn();
    expect(start.userCode).toBe("ABCD-EFGH");
    expect(await account.pollSignIn("dev-1")).toEqual({ state: "pending" });
    const done = await account.pollSignIn("dev-1");
    expect(done.state).toBe("complete");
    if (done.state !== "complete") throw new Error("expected completion");
    expect(done.status.signedIn).toBe(true);
    expect(done.status.email).toBe("me@test.invalid");
    expect(done.status.credits?.display.total).toBe("2500.00");
    expect((await readCloudSession(secretsDir))?.token).toBe("sess-1");
    const out = await account.signOut();
    expect(out.signedIn).toBe(false);
    expect(await readCloudSession(secretsDir)).toBeNull();
    expect(calls.some((c) => c.endsWith("/v1/auth/sign-out"))).toBe(true);
  });

  it("reports an expired session when the control plane answers 401", async () => {
    await writeCloudSession(secretsDir, { apiBaseUrl: "https://cloud.test", token: "old", userId: "u1", email: "a@b.c", orgId: "o1", createdAt: "x" });
    const account = new CloudAccount({ secretsDir, region: async () => "global", fetchImpl: async () => jsonResponse(401, { error: { code: "unauthorized", message: "no" } }) });
    const status = await account.status();
    expect(status.signedIn).toBe(true);
    expect(status.problem).toBe("session_expired");
  });
});
