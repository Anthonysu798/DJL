/**
 * Red team: cross-site request forgery against cookie-authenticated routes,
 * plus the security headers every API response carries.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadApiEnv } from "../config/env.ts";
import { startApi, type ApiRuntime } from "../server.ts";
import { TestClient } from "../testing/client.ts";
import { csrfRefusal } from "./csrf.ts";

const trusted = new Set(["https://app.slcor.com"]);
const token = "t".repeat(43);
const session = "djl.session_token=abc";
const newDevice = () => ({ kind: "desktop", fingerprint: crypto.randomUUID() });

describe("csrfRefusal", () => {
  const post = (headers: Record<string, string>, path = "/v1/devices") =>
    csrfRefusal({ method: "POST", path, headers }, trusted);

  it("passes safe methods, auth routes, bearer calls, and cookie-less calls", () => {
    expect(
      csrfRefusal({ method: "GET", path: "/v1/me", headers: { cookie: session } }, trusted),
    ).toBeNull();
    expect(post({ cookie: session }, "/v1/auth/sign-out")).toBeNull();
    expect(post({ cookie: session, authorization: "Bearer x" })).toBeNull();
    expect(post({})).toBeNull();
  });

  it("refuses a cookie mutation from a missing or untrusted origin", () => {
    const cookie = `${session}; djl_csrf=${token}`;
    expect(post({ cookie, "x-csrf-token": token })).toBe("csrf_origin");
    expect(post({ cookie, "x-csrf-token": token, origin: "https://evil.example" })).toBe(
      "csrf_origin",
    );
    expect(post({ cookie, "x-csrf-token": token, origin: "null" })).toBe("csrf_origin");
  });

  it("refuses a missing, mismatched, or cookie-less token", () => {
    const origin = "https://app.slcor.com";
    expect(post({ cookie: `${session}; djl_csrf=${token}`, origin })).toBe("csrf_token");
    expect(
      post({ cookie: `${session}; djl_csrf=${token}`, origin, "x-csrf-token": "u".repeat(43) }),
    ).toBe("csrf_token");
    expect(post({ cookie: session, origin, "x-csrf-token": token })).toBe("csrf_token");
    expect(post({ cookie: `__Secure-${session}; djl_csrf=${token}`, origin })).toBe("csrf_token");
    expect(post({ cookie: `${session}; djl_csrf=${token}`, origin, "x-csrf-token": token })).toBe(
      null,
    );
  });
});

describe("csrf over HTTP", () => {
  let api: ApiRuntime;
  let client: TestClient;
  const device = { kind: "desktop", fingerprint: "fp-csrf" };

  beforeAll(async () => {
    const env = loadApiEnv({ ...process.env, DJL_ENV: "test", DJL_MOCK_EXTERNALS: "true" });
    api = await startApi({ env, port: 0, host: "127.0.0.1" });
    client = TestClient.for(api);
    await client.signUp(api, "csrf");
  });
  afterAll(async () => {
    await api.close();
  });

  it("rejects a cookie mutation without the token, with a forged token, or from a foreign origin", async () => {
    const missing = await client.call("/v1/devices", { method: "POST", csrf: false, json: device });
    expect(missing.status).toBe(403);
    expect((await missing.json()).error.code).toBe("csrf_token");

    const forged = await client.call("/v1/devices", {
      method: "POST",
      csrf: false,
      headers: { "x-csrf-token": "f".repeat(43) },
      json: device,
    });
    expect(forged.status).toBe(403);

    const foreign = await client.call("/v1/devices", {
      method: "POST",
      headers: { origin: "https://evil.example" },
      json: device,
    });
    expect(foreign.status).toBe(403);
    expect((await foreign.json()).error.code).toBe("csrf_origin");

    const ok = await client.call("/v1/devices", { method: "POST", json: device });
    expect(ok.status).toBe(201);
  });

  it("does not fall back to the cookie when explicit credentials are invalid", async () => {
    const browser = TestClient.for(api);
    const { email, password } = await browser.signUp(api, "csrf-credential-precedence");
    const denied: number[] = [];
    for (const authorization of ["Basic Zml4dHVyZTppbnZhbGlk", "Bearer invalid.invalid"]) {
      const response = await browser.call("/v1/devices", {
        method: "POST",
        csrf: false,
        headers: { authorization },
        json: newDevice(),
      });
      denied.push(response.status);
    }
    const readback = await browser.call("/v1/devices");
    expect(readback.status).toBe(200);
    const { devices } = (await readback.json()) as { devices: unknown[] };

    const cookie = await browser.call("/v1/devices", { method: "POST", json: newDevice() });
    const native = TestClient.for(api);
    const signIn = await native.call("/v1/auth/sign-in/email", {
      method: "POST",
      json: { email, password },
    });
    expect(signIn.status).toBe(200);
    const sessionToken = signIn.headers.get("set-auth-token");
    if (!sessionToken) throw new Error("Synthetic sign-in did not issue a session token.");
    const opaque = await native.call("/v1/devices", {
      method: "POST",
      bearer: sessionToken,
      json: newDevice(),
    });
    const mint = await native.call("/v1/auth/token", { bearer: sessionToken });
    expect(mint.status).toBe(200);
    const { token: jwt } = (await mint.json()) as { token: string };
    const access = await native.call("/v1/devices", {
      method: "POST",
      bearer: jwt,
      json: newDevice(),
    });
    expect([cookie.status, opaque.status, access.status]).toEqual([201, 201, 201]);
    expect({ statuses: denied, registered: devices.length }).toEqual({
      statuses: [401, 401],
      registered: 0,
    });
  });

  it("keeps the same token across calls and sends it as an HttpOnly strict cookie", async () => {
    const first = await client.call("/v1/csrf");
    const cookie = first.headers.getSetCookie().find((c) => c.startsWith("djl_csrf="));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const a = ((await first.json()) as { token: string }).token;
    const b = ((await (await client.call("/v1/csrf")).json()) as { token: string }).token;
    expect(b).toBe(a);
  });

  it("sends security headers on every response", async () => {
    const res = await client.call("/v1/me");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    const notFound = await client.call("/nope");
    expect(notFound.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});
