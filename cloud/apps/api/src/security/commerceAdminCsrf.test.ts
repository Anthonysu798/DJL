import { describe, expect, it } from "vitest";
import { csrfRefusal } from "./csrf.ts";

const trustedOrigin = "https://admin.test";
const webOrigin = "https://app.test";
const trusted = new Set([trustedOrigin, webOrigin]);
const token = "t".repeat(43);
const cookie = `djl_admin=synthetic-admin-cookie; djl_csrf=${token}`;
const manualPayment = "/admin/v1/commerce/withdrawals/id/start-payment";
const refuse = (
  headers: Readonly<Record<string, string | undefined>>,
  path = manualPayment,
  method = "POST",
) => csrfRefusal({ method, path, headers }, trusted, trustedOrigin);

describe("commerce administrator cookie CSRF boundary (offline, no authentication proof)", () => {
  it.each([
    ["POST", manualPayment],
    ["POST", "/admin/v1/commerce/withdrawals/id/mark-payment-unknown"],
    ["POST", "/admin/v1/commerce/withdrawals/id/reject"],
    ["POST", "/admin/v1/commerce/items/id/refund"],
    ["POST", "/admin/v1/commerce/commissions/release"],
    ["POST", "/admin/v1/commerce/suppliers/id/members/user/revoke"],
    ["PATCH", "/admin/v1/commerce/catalog/id"],
  ])("requires double submit for cookie-authenticated %s %s", (method, path) => {
    expect(refuse({ cookie, origin: trustedOrigin }, path, method)).toBe("csrf_token");
  });

  it.each([
    undefined,
    "null",
    "https://untrusted.test",
    `${trustedOrigin}.untrusted.test`,
    webOrigin,
  ])("requires the exact admin Origin, not %s", (origin) => {
    expect(refuse({ cookie, origin, "x-csrf-token": token })).toBe("csrf_origin");
  });

  it.each([
    { cookie: "djl_admin=synthetic-admin-cookie", "x-csrf-token": token },
    { cookie, "x-csrf-token": "u".repeat(43) },
    { cookie, "x-csrf-token": token.slice(1) },
    { cookie: "djl_admin=synthetic-admin-cookie; djl_csrf=malformed", "x-csrf-token": "malformed" },
  ])("refuses an absent, malformed or mismatched double-submit value %#", (headers) => {
    expect(refuse({ ...headers, origin: trustedOrigin })).toBe("csrf_token");
  });

  it("accepts a trusted cookie mutation only with the matching well-formed token", () => {
    expect(refuse({ cookie, origin: trustedOrigin, "x-csrf-token": token })).toBeNull();
  });

  it.each(["GET", "HEAD", "OPTIONS"])("does not impose CSRF on safe %s", (method) => {
    expect(refuse({ cookie }, manualPayment, method)).toBeNull();
  });

  it("leaves explicit Authorization to the route's prioritized token authentication", () => {
    // This exemption is not authentication: an invalid header must fail in AdminAuth,
    // never fall back to the automatically attached cookie.
    expect(refuse({ cookie, authorization: "Bearer synthetic-token" })).toBeNull();
    expect(refuse({ cookie, authorization: "Bearer invalid-token" })).toBeNull();
  });

  it("does not mistake a different cookie or an absent credential for admin-cookie authentication", () => {
    expect(refuse({ cookie: "not_djl_admin=synthetic" })).toBeNull();
    expect(refuse({ cookie: "djl.session_token=synthetic-user" })).toBeNull();
    expect(refuse({})).toBeNull();
  });

  it("does not broaden protection into the signed callback", () => {
    expect(
      refuse({ cookie: "djl.session_token=synthetic-user" }, "/v1/commerce/webhooks/stripe-test"),
    ).toBeNull();
    expect(
      refuse({ cookie: "djl.session_token=synthetic-user" }, "/v1/commerce/orders/id/checkout"),
    ).toBe("csrf_origin");
  });
});

describe("admin cookie request forgery (offline)", () => {
  const adminCookie = "djl_admin=synthetic-admin-cookie";
  const paths = [
    "/admin/v1/admins",
    "/admin/v1/auth/totp/enroll",
    "/admin/v1/auth/logout",
    "/admin/v1/settings/admin.ip_allowlist",
    "/admin/v1/commerce-lookalike/write",
  ];

  it.each(paths)("refuses a cookie-only POST %s without the admin Origin", (path) => {
    for (const origin of [undefined, "null", webOrigin, "https://files.admin.test"])
      expect(refuse({ cookie: adminCookie, origin }, path)).toBe("csrf_origin");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("covers every mutating method: %s", (method) => {
    expect(refuse({ cookie: adminCookie, origin: webOrigin }, paths[0], method)).toBe(
      "csrf_origin",
    );
    expect(refuse({ cookie: adminCookie, origin: trustedOrigin }, paths[0], method)).toBeNull();
  });

  it("refuses every origin when no admin origin is configured", () => {
    expect(
      csrfRefusal(
        {
          method: "POST",
          path: paths[0]!,
          headers: { cookie: adminCookie, origin: trustedOrigin },
        },
        trusted,
      ),
    ).toBe("csrf_origin");
  });

  it("leaves bearer clients, reads, and requests without the admin cookie alone", () => {
    expect(refuse({ cookie: adminCookie, authorization: "Bearer token" }, paths[0])).toBeNull();
    expect(refuse({ cookie: adminCookie }, paths[0], "GET")).toBeNull();
    // Sign-in and invite acceptance never read the cookie, so a stale one changes nothing.
    for (const path of [
      "/admin/v1/auth/login",
      "/admin/v1/auth/invite/inspect",
      "/admin/v1/auth/invite/accept",
    ])
      expect(refuse({ cookie: adminCookie, origin: webOrigin }, path)).toBeNull();
  });
});
