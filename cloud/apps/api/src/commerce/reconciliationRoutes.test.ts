import { ServiceMap } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";
import type { AdminAuth, AdminPrincipal } from "../admin/AdminAuth.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import type { CommerceReconciliationService } from "./CommerceReconciliationService.ts";
import {
  COMMERCE_RECONCILIATION_PATH,
  makeCommerceReconciliationRoutes,
} from "./reconciliationRoutes.ts";

const admin: AdminPrincipal = {
  adminId: crypto.randomUUID(),
  email: "admin@test.invalid",
  role: "admin",
  sessionId: "session",
  mfaVerified: true,
};
const csrf = "t".repeat(43);
function fixture(
  principal: AdminPrincipal | Error = admin,
  failure?: Error,
  adminMfaRequired = true,
) {
  const compare = vi.fn(async () => {
    if (failure) throw failure;
    return {
      mode: "test",
      source: "unverified_manual_test_statement",
      rows: [],
      summary: { rows: 0, matched: 0, exceptions: 0 },
    };
  });
  const resolve = vi.fn(async (token: string | null) => {
    if (!token || principal instanceof Error || token === "bad-bearer")
      throw new ApiError(401, "unauthorized", "Admin required");
    return principal;
  });
  const app = HttpRouter.toWebHandler(
    makeCommerceReconciliationRoutes({
      commerceReconciliation: { compare } as unknown as CommerceReconciliationService,
      adminAuth: { resolve } as unknown as AdminAuth,
      trustedOrigins: ["http://admin.test"],
      adminMfaRequired,
    }),
    { disableLogger: true },
  );
  const context = ServiceMap.make(RequestContext, {
    traceId: "comparison-test",
    ip: "127.0.0.1",
    userAgent: null,
    region: "test",
    startedAt: Date.now(),
  });
  return {
    compare,
    resolve,
    dispose: app.dispose,
    request: (
      body: unknown = { csv: "test csv" },
      headers: Record<string, string> = { authorization: "Bearer admin-token" },
      path = COMMERCE_RECONCILIATION_PATH,
      method = "POST",
    ) =>
      app.handler(
        new Request(`http://commerce.test${path}`, {
          method,
          headers: { "content-type": "application/json", ...headers },
          ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
        }),
        context,
      ),
  };
}
describe("manual TEST comparison administrator route", () => {
  it("disables this tool before authentication or CSV access when local policy can project unverified MFA as true", async () => {
    const f = fixture(admin, undefined, false);
    try {
      const response = await f.request({ csv: "private fixture" });
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("commerce_reconciliation_disabled");
      expect(f.resolve).not.toHaveBeenCalled();
      expect(f.compare).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
  it("requires authentication, independent commerce permission and verified MFA", async () => {
    for (const p of [
      new Error("not authenticated"),
      { ...admin, role: "employee" as const },
      { ...admin, mfaVerified: false },
    ]) {
      const f = fixture(p);
      try {
        expect((await f.request()).status).toBe(p instanceof Error ? 401 : 403);
        expect(f.compare).not.toHaveBeenCalled();
      } finally {
        await f.dispose();
      }
    }
  });
  it("passes only CSV to the service using a resolved Bearer rather than a cookie fallback", async () => {
    const f = fixture();
    try {
      expect(
        (
          await f.request(
            { csv: "exact csv" },
            { authorization: "Bearer admin-token", cookie: "djl_admin=other-cookie" },
          )
        ).status,
      ).toBe(200);
      expect(f.resolve).toHaveBeenCalledExactlyOnceWith("admin-token", "127.0.0.1");
      expect(f.compare).toHaveBeenCalledExactlyOnceWith("exact csv");
      for (const authorization of ["Basic not-a-token", "Bearer bad-bearer"]) {
        expect(
          (
            await f.request(
              { csv: "secret fixture" },
              {
                authorization,
                cookie: `djl_admin=valid-cookie; djl_csrf=${csrf}`,
                origin: "http://admin.test",
                "x-csrf-token": csrf,
              },
            )
          ).status,
        ).toBe(401);
      }
      expect(f.compare).toHaveBeenCalledTimes(1);
    } finally {
      await f.dispose();
    }
  });
  it("protects cookie-only uploads with a trusted Origin and exact double-submit CSRF", async () => {
    const f = fixture();
    try {
      for (const headers of [
        { cookie: `djl_admin=admin-cookie; djl_csrf=${csrf}` },
        {
          cookie: `djl_admin=admin-cookie; djl_csrf=${csrf}`,
          origin: "http://evil.test",
          "x-csrf-token": csrf,
        },
        { cookie: `djl_admin=admin-cookie; djl_csrf=${csrf}`, origin: "http://admin.test" },
        {
          cookie: `djl_admin=admin-cookie; djl_csrf=${csrf}`,
          origin: "http://admin.test",
          "x-csrf-token": "x".repeat(43),
        },
        {
          cookie: `djl_admin=admin-cookie; djl_csrf=${csrf}`,
          origin: "http://admin.test",
          "x-csrf-token": "é".repeat(43),
        },
      ])
        expect((await f.request(undefined, headers)).status).toBe(403);
      expect(f.compare).not.toHaveBeenCalled();
      expect(
        (
          await f.request(undefined, {
            cookie: `djl_admin=admin-cookie; djl_csrf=${csrf}`,
            origin: "http://admin.test",
            "x-csrf-token": csrf,
          })
        ).status,
      ).toBe(200);
    } finally {
      await f.dispose();
    }
  });
  it("rejects extra selectors and exposes no buyer endpoint, GET upload, or settlement command", async () => {
    const f = fixture();
    try {
      for (const body of [
        null,
        [],
        {},
        { csv: "text", ownerId: admin.adminId },
        { csv: "text", mode: "live" },
      ])
        expect((await f.request(body)).status).toBe(400);
      for (const [path, method] of [
        ["/v1/commerce/reconciliation/compare", "POST"],
        [COMMERCE_RECONCILIATION_PATH, "GET"],
        ["/admin/v1/commerce/reconciliation/settle", "POST"],
      ])
        expect([404, 405]).toContain((await f.request(undefined, undefined, path, method)).status);
      expect(f.compare).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
  it("fails without a report or a zero-difference claim and never logs uploaded/provider diagnostics", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const failure of [
      new Error("private CSV account or database detail"),
      new ApiError(503, "commerce_reconciliation_disabled", "Disabled."),
    ]) {
      const f = fixture(admin, failure);
      try {
        const response = await f.request();
        expect(response.status).toBe(503);
        const text = await response.text();
        expect(text).not.toContain('"report"');
        expect(text).not.toContain("private CSV");
        expect(text).not.toContain('"matched":0');
      } finally {
        await f.dispose();
      }
    }
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("retains parser validation/size codes and rejects oversized JSON before comparison", async () => {
    const f = fixture(
      admin,
      new ApiError(413, "commerce_reconciliation_csv_too_large", "Too large."),
    );
    try {
      const response = await f.request();
      expect(response.status).toBe(413);
      expect((await response.json()).error.code).toBe("commerce_reconciliation_csv_too_large");
      f.compare.mockClear();
      expect((await f.request({ csv: "x".repeat(256 * 1024) })).status).toBe(413);
      expect(f.compare).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
});
