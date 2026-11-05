import { ServiceMap } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";
import type { AdminAuth, AdminPrincipal } from "../admin/AdminAuth.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import type { CommerceAlertsService } from "./CommerceAlertsService.ts";
import { makeCommerceAlertRoutes } from "./alertRoutes.ts";

const administrator: AdminPrincipal = {
  adminId: "00000000-0000-4000-8000-000000000001",
  email: "admin@test.invalid",
  role: "admin",
  sessionId: "admin-session",
  mfaVerified: true,
};
function fixture(p: AdminPrincipal | Error = administrator, error?: Error) {
  const list = vi.fn(async () => {
    if (error) throw error;
    return {
      enabled: false,
      externalDelivery: {
        enabled: false,
        configuration: "disabled",
        mode: "mock",
        counts: {
          pending: 0,
          submitting: 0,
          accepted: 0,
          simulated: 0,
          needsReview: 0,
          skipped: 0,
        },
        lastAttemptAt: null,
      },
      monitor: { status: "disabled" },
      incidents: [],
      counts: { open: 0, pending: 0 },
      nextCursor: null,
    };
  });
  const resolve = vi.fn(async () => {
    if (p instanceof Error) throw p;
    return p;
  });
  const router = HttpRouter.toWebHandler(
    makeCommerceAlertRoutes({
      commerceAlerts: { list } as unknown as CommerceAlertsService,
      adminAuth: { resolve } as unknown as AdminAuth,
    }),
    { disableLogger: true },
  );
  const context = ServiceMap.make(RequestContext, {
    traceId: "commerce-alert-http",
    ip: "127.0.0.1",
    userAgent: null,
    region: "test",
    startedAt: Date.now(),
  });
  return {
    list,
    resolve,
    dispose: router.dispose,
    call: (path = "/admin/v1/commerce/alerts", method = "GET", cookie = "djl_admin=admin-cookie") =>
      router.handler(
        new Request(`http://commerce.test${path}`, { method, headers: { cookie } }),
        context,
      ),
  };
}
describe("commerce alerts read-only administrator boundary", () => {
  it("requires independent admin authentication, permission and MFA before reading monitoring", async () => {
    for (const p of [
      new ApiError(401, "unauthorized", "Admin required"),
      { ...administrator, role: "employee" as const },
      { ...administrator, mfaVerified: false },
    ]) {
      const f = fixture(p);
      try {
        expect((await f.call()).status).toBe(p instanceof Error ? 401 : 403);
        expect(f.list).not.toHaveBeenCalled();
      } finally {
        await f.dispose();
      }
    }
  });
  it("forwards only filtering and cursor, never caller owner/org selectors", async () => {
    const f = fixture();
    try {
      expect(
        (
          await f.call(
            "/admin/v1/commerce/alerts?status=all&cursor=opaque&ownerId=someone&orgId=team",
          )
        ).status,
      ).toBe(200);
      expect(f.list).toHaveBeenCalledExactlyOnceWith({ status: "all", cursor: "opaque" });
      expect(f.resolve).toHaveBeenCalledExactlyOnceWith("admin-cookie", "127.0.0.1");
    } finally {
      await f.dispose();
    }
  });
  it("has no public/buyer route, manual scan trigger, or alert mutation", async () => {
    const f = fixture();
    try {
      for (const path of ["/v1/commerce/alerts", "/admin/v1/commerce/alerts/scan"])
        expect([404, 405]).toContain((await f.call(path)).status);
      expect([404, 405]).toContain((await f.call("/admin/v1/commerce/alerts", "POST")).status);
      expect(f.list).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
  it("returns unavailable, not an empty healthy queue, when the read fails", async () => {
    const f = fixture(administrator, new Error("private database diagnostic"));
    try {
      const response = await f.call();
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).toContain("commerce_alerts_unavailable");
      expect(body).not.toContain("private database diagnostic");
      expect(body).not.toContain('"incidents":[]');
    } finally {
      await f.dispose();
    }
  });
  it("preserves safe validation errors without claiming scan success", async () => {
    const f = fixture(administrator, new ApiError(400, "bad_cursor", "Invalid cursor."));
    try {
      const response = await f.call();
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("bad_cursor");
    } finally {
      await f.dispose();
    }
  });
});
