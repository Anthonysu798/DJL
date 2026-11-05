import { ServiceMap } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";

import type { AdminAuth, AdminPrincipal } from "../admin/AdminAuth.ts";
import type { Principal, PrincipalResolver } from "../auth/guard.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import { COMMERCE_STRIPE_TEST_WEBHOOK_PATH, makeCommercePaymentRoutes } from "./paymentRoutes.ts";

const orderId = "00000000-0000-4000-8000-000000000001";
const user: Principal = {
  userId: "00000000-0000-4000-8000-000000000002",
  email: "shopper@test.invalid",
  emailVerified: true,
  banned: false,
  sessionId: "user-test",
  orgId: "ai-team-not-commerce",
  personalOrgId: "personal",
  role: "owner",
};
const admin: AdminPrincipal = {
  adminId: "00000000-0000-4000-8000-000000000003",
  email: "admin@test.invalid",
  role: "admin",
  sessionId: "admin-test",
  mfaVerified: true,
};
function trackedRawBody(bytes: Uint8Array, chunkBytes = 16 * 1024) {
  let producedBytes = 0;
  const cancelled = vi.fn();
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (producedBytes === bytes.byteLength) {
          controller.close();
          return;
        }
        const end = Math.min(producedBytes + chunkBytes, bytes.byteLength);
        controller.enqueue(bytes.subarray(producedBytes, end));
        producedBytes = end;
      },
      cancel: cancelled,
    },
    { highWaterMark: 0 },
  );
  return { body, cancelled, producedBytes: () => producedBytes };
}
function fixture(
  principal: Principal | Error = user,
  administrator: AdminPrincipal | Error = admin,
) {
  const payments = {
    checkout: vi.fn(async () => ({
      payment: { status: "open" },
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_fixture",
    })),
    status: vi.fn(async () => ({ payment: { status: "unknown" } })),
    cancel: vi.fn(async () => ({ payment: { status: "cancel_requested" } })),
    requestRefund: vi.fn(async () => ({ refund: { status: "pending" } })),
    reconcile: vi.fn(async () => ({ payment: { status: "unknown" } })),
    handleWebhook: vi.fn(async () => ({ received: true as const, outcome: "processed" })),
    listExternalRefunds: vi.fn(async () => ({
      refunds: [],
      page: 0,
      hasMore: false,
      enabled: false,
    })),
    externalRefundDetail: vi.fn(async () => ({ canAllocate: false })),
    observeExternalRefund: vi.fn(async () => ({ canAllocate: false })),
    allocateExternalRefund: vi.fn(async () => ({ applied: true, reviewCleared: false })),
  };
  const resolve = vi.fn(async () => {
    if (principal instanceof Error) throw principal;
    return principal;
  });
  const resolveAdmin = vi.fn(async () => {
    if (administrator instanceof Error) throw administrator;
    return administrator;
  });
  const router = HttpRouter.toWebHandler(
    makeCommercePaymentRoutes({
      commercePayments: payments as never,
      principals: { resolve } as PrincipalResolver,
      adminAuth: { resolve: resolveAdmin } as unknown as AdminAuth,
    }),
    { disableLogger: true },
  );
  const context = ServiceMap.make(RequestContext, {
    traceId: "commerce-payment-http",
    ip: "127.0.0.1",
    userAgent: null,
    region: "test",
    startedAt: Date.now(),
  });
  const request = (
    path: string,
    options: {
      method?: string;
      body?: unknown;
      raw?: string | ReadableStream<Uint8Array>;
      headers?: Record<string, string>;
    } = {},
  ) =>
    router.handler(
      new Request(`http://commerce.test${path}`, {
        method:
          options.method ??
          (options.body === undefined && options.raw === undefined ? "GET" : "POST"),
        headers: {
          "content-type": "application/json",
          cookie: "djl_admin=admin-token",
          ...options.headers,
        },
        ...(options.raw === undefined && options.body === undefined
          ? {}
          : { body: options.raw ?? JSON.stringify(options.body) }),
        ...(typeof options.raw === "object" ? { duplex: "half" as const } : {}),
      }),
      context,
    );
  return { payments, resolve, resolveAdmin, request, dispose: router.dispose };
}
describe("Stripe TEST commerce route trust boundaries", () => {
  it("scopes status to personal user identity regardless of query selectors or AI owner role", async () => {
    const f = fixture();
    try {
      expect(
        (await f.request(`/v1/commerce/orders/${orderId}/payment?userId=foreign&orgId=other`))
          .status,
      ).toBe(200);
      expect(f.payments.status).toHaveBeenCalledExactlyOnceWith(orderId, user.userId);
    } finally {
      await f.dispose();
    }
  });
  it("passes only the persisted operation key to checkout/cancel, not a client-selected payment mode", async () => {
    const f = fixture();
    try {
      expect(
        (
          await f.request(`/v1/commerce/orders/${orderId}/checkout`, {
            body: {
              idempotencyKey: "checkout-key",
              provider: "stripe_live",
              secretKey: "must-not-forward",
            },
          })
        ).status,
      ).toBe(200);
      expect(f.payments.checkout).toHaveBeenCalledExactlyOnceWith(
        { id: user.userId, type: "user", traceId: "commerce-payment-http" },
        orderId,
        "checkout-key",
      );
      expect(
        (
          await f.request(`/v1/commerce/orders/${orderId}/checkout/cancel`, {
            body: { idempotencyKey: "cancel-key" },
          })
        ).status,
      ).toBe(200);
      expect(f.payments.cancel).toHaveBeenCalledExactlyOnceWith(
        { id: user.userId, type: "user", traceId: "commerce-payment-http" },
        orderId,
        "cancel-key",
      );
    } finally {
      await f.dispose();
    }
  });
  it("requires authentication and verified email before payment mutations", async () => {
    const missing = fixture(new ApiError(401, "unauthorized", "Sign in required."));
    try {
      expect((await missing.request(`/v1/commerce/orders/${orderId}/payment`)).status).toBe(401);
      expect(missing.payments.status).not.toHaveBeenCalled();
    } finally {
      await missing.dispose();
    }
    const f = fixture({ ...user, emailVerified: false });
    try {
      expect(
        (
          await f.request(`/v1/commerce/orders/${orderId}/checkout`, {
            body: { idempotencyKey: "test-key" },
          })
        ).status,
      ).toBe(403);
      expect(f.payments.checkout).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
  it("requires valid order identifiers and object bodies before service calls", async () => {
    const f = fixture();
    try {
      expect(
        (
          await f.request("/v1/commerce/orders/not-a-uuid/checkout", {
            body: { idempotencyKey: "test-key" },
          })
        ).status,
      ).toBe(400);
      expect(
        (await f.request(`/v1/commerce/orders/${orderId}/checkout`, { body: [] })).status,
      ).toBe(400);
      expect(f.payments.checkout).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
  it("uses separate administrator MFA and permissions for reconciliation/refunds", async () => {
    for (const administrator of [
      new ApiError(401, "unauthorized", "Admin sign-in required."),
      { ...admin, mfaVerified: false },
      { ...admin, role: "employee" as const },
    ]) {
      const f = fixture(user, administrator);
      try {
        const response = await f.request(`/admin/v1/commerce/orders/${orderId}/payment/reconcile`, {
          body: { reason: "Provider check" },
        });
        expect(response.status).toBe(administrator instanceof Error ? 401 : 403);
        expect(f.payments.reconcile).not.toHaveBeenCalled();
      } finally {
        await f.dispose();
      }
    }
    const f = fixture();
    try {
      expect((await f.request(`/admin/v1/commerce/orders/${orderId}/payment`)).status).toBe(200);
      expect(f.payments.status).toHaveBeenCalledExactlyOnceWith(orderId);
      expect(
        (
          await f.request(`/admin/v1/commerce/orders/${orderId}/payment/reconcile`, {
            body: { reason: "Explicit review" },
          })
        ).status,
      ).toBe(200);
      expect(f.payments.reconcile).toHaveBeenCalledExactlyOnceWith(
        { id: admin.adminId, type: "admin", traceId: "commerce-payment-http" },
        orderId,
        "Explicit review",
      );
      const body = { refundTotalCents: 100, reason: "Test return", idempotencyKey: "refund-key" };
      expect(
        (await f.request(`/admin/v1/commerce/items/${orderId}/provider-refunds`, { body })).status,
      ).toBe(200);
      expect(f.payments.requestRefund).toHaveBeenCalledExactlyOnceWith(
        { id: admin.adminId, type: "admin", traceId: "commerce-payment-http" },
        orderId,
        body,
      );
    } finally {
      await f.dispose();
    }
  });
  it("preserves exact webhook bytes and passes signature/trace without a user or administrator session", async () => {
    const f = fixture(
      new ApiError(401, "unauthorized", "No session"),
      new ApiError(401, "unauthorized", "No admin"),
    );
    try {
      const raw = '  { "id": "evt_test",\n "type": "checkout.session.completed" }\n';
      const response = await f.request(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, {
        raw,
        headers: { "stripe-signature": "t=1,v1=signature" },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ received: true, outcome: "processed" });
      expect(f.payments.handleWebhook).toHaveBeenCalledExactlyOnceWith(
        raw,
        "t=1,v1=signature",
        "commerce-payment-http",
      );
      expect(f.resolve).not.toHaveBeenCalled();
      expect(f.resolveAdmin).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
  it("rejects missing signatures and oversized raw UTF-8 bodies before service processing", async () => {
    const f = fixture();
    try {
      expect((await f.request(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, { raw: "{}" })).status).toBe(400);
      expect(
        (
          await f.request(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, {
            raw: "{}",
            headers: { "stripe-signature": "signature", "content-length": String(256 * 1024 + 1) },
          })
        ).status,
      ).toBe(413);
      expect(
        (
          await f.request(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, {
            raw: "中".repeat(100000),
            headers: { "stripe-signature": "signature" },
          })
        ).status,
      ).toBe(413);
      expect(f.payments.handleWebhook).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
  it("cancels an oversized unknown-length webhook stream before reading it in full", async () => {
    const f = fixture();
    const limit = 256 * 1024;
    const chunkBytes = 16 * 1024;
    const source = trackedRawBody(new Uint8Array(1024 * 1024).fill(120), chunkBytes);
    try {
      const response = await f.request(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, {
        raw: source.body,
        headers: { "stripe-signature": "signature" },
      });
      expect(response.status).toBe(413);
      expect((await response.json()).error.code).toBe("payload_too_large");
      expect(f.payments.handleWebhook).not.toHaveBeenCalled();
      // Permit adapter read-ahead, not a brittle zero-overshoot or elapsed-time assertion.
      expect(source.producedBytes()).toBeLessThanOrEqual(limit + 4 * chunkBytes);
      expect(source.producedBytes()).toBeLessThan(1024 * 1024);
      expect(source.cancelled).toHaveBeenCalledOnce();
      expect(f.resolve).not.toHaveBeenCalled();
      expect(f.resolveAdmin).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
  it.each([0, 1])(
    "measures a streamed raw webhook at the UTF-8 byte limit plus %i bytes without changing its contents",
    async (extraBytes) => {
      const f = fixture();
      const limit = 256 * 1024;
      const paddingBytes = limit - Buffer.byteLength('{"padding":""}', "utf8");
      const raw =
        `{"padding":"${"中".repeat(Math.floor(paddingBytes / 3))}${"x".repeat(paddingBytes % 3)}"}` +
        " ".repeat(extraBytes);
      const bytes = new TextEncoder().encode(raw);
      expect(bytes.byteLength).toBe(limit + extraBytes);
      expect(raw.length).toBeLessThan(limit);
      const source = trackedRawBody(bytes);
      try {
        const response = await f.request(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, {
          raw: source.body,
          headers: { "stripe-signature": "utf8-boundary-signature" },
        });
        expect(response.status).toBe(extraBytes === 0 ? 200 : 413);
        if (extraBytes === 0) {
          expect(f.payments.handleWebhook).toHaveBeenCalledExactlyOnceWith(
            raw,
            "utf8-boundary-signature",
            "commerce-payment-http",
          );
        } else {
          expect((await response.json()).error.code).toBe("payload_too_large");
          expect(f.payments.handleWebhook).not.toHaveBeenCalled();
        }
      } finally {
        await f.dispose();
      }
    },
  );
  it("passes absent and zero-byte webhook bodies through as the original empty payload", async () => {
    const f = fixture();
    try {
      for (const raw of [undefined, ""]) {
        const response = await f.request(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, {
          method: "POST",
          ...(raw === undefined ? {} : { raw }),
          headers: { "stripe-signature": "empty-body-signature" },
        });
        expect(response.status).toBe(200);
      }
      expect(f.payments.handleWebhook.mock.calls).toEqual([
        ["", "empty-body-signature", "commerce-payment-http"],
        ["", "empty-body-signature", "commerce-payment-http"],
      ]);
    } finally {
      await f.dispose();
    }
  });
  it("maps a webhook source read failure to bad_body without calling the payment service", async () => {
    const f = fixture();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("synthetic-body-read-failure"));
      },
    });
    try {
      const response = await f.request(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, {
        raw: body,
        headers: { "stripe-signature": "signature" },
      });
      expect(response.status).toBe(400);
      const result = await response.json();
      expect(result.error.code).toBe("bad_body");
      expect(JSON.stringify(result)).not.toContain("synthetic-body-read-failure");
      expect(f.payments.handleWebhook).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
  it("passes fail-closed service refusals through without inventing payment success", async () => {
    const f = fixture();
    try {
      f.payments.handleWebhook.mockRejectedValueOnce(
        new ApiError(503, "commerce_funds_disabled", "Test payments are disabled."),
      );
      const response = await f.request(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, {
        raw: "{}",
        headers: { "stripe-signature": "signature" },
      });
      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("commerce_funds_disabled");
    } finally {
      await f.dispose();
    }
  });
  it("redacts unexpected provider/database failures instead of logging raw bodies or credentials", async () => {
    const f = fixture();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      f.payments.handleWebhook.mockRejectedValueOnce(
        new Error("private-key private-address raw-event-body"),
      );
      const response = await f.request(COMMERCE_STRIPE_TEST_WEBHOOK_PATH, {
        raw: "{}",
        headers: { "stripe-signature": "signature" },
      });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toMatch(/private-key|private-address|raw-event-body/);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
      await f.dispose();
    }
  });
  it("routes external refund paging, verified-event observation, and full allocation through the administrator boundary", async () => {
    const f = fixture();
    const input = {
      expectedVersion: 2,
      allocations: [{ itemId: orderId, amountCents: 100 }],
      reason: "Allocate the already completed test refund",
      idempotencyKey: "external-request-01",
    };
    try {
      expect(
        (await f.request(`/admin/v1/commerce/orders/${orderId}/external-refunds?page=2`)).status,
      ).toBe(200);
      expect(f.payments.listExternalRefunds).toHaveBeenCalledExactlyOnceWith(orderId, "2");
      expect((await f.request(`/admin/v1/commerce/external-refunds/${orderId}`)).status).toBe(200);
      expect(f.payments.externalRefundDetail).toHaveBeenCalledExactlyOnceWith(orderId);
      expect(
        (
          await f.request("/admin/v1/commerce/external-refunds/observe", {
            body: { sourceEventId: "evt_verified_test", reason: "Check the provider record" },
          })
        ).status,
      ).toBe(200);
      expect(f.payments.observeExternalRefund).toHaveBeenCalledExactlyOnceWith(
        { id: admin.adminId, type: "admin", traceId: "commerce-payment-http" },
        "evt_verified_test",
        "Check the provider record",
      );
      expect(
        (
          await f.request(`/admin/v1/commerce/external-refunds/${orderId}/allocate`, {
            body: input,
          })
        ).status,
      ).toBe(200);
      expect(f.payments.allocateExternalRefund).toHaveBeenCalledExactlyOnceWith(
        { id: admin.adminId, type: "admin", traceId: "commerce-payment-http" },
        orderId,
        input,
      );
      expect(
        (await f.request(`/v1/commerce/external-refunds/${orderId}/allocate`, { body: input }))
          .status,
      ).toBe(404);
    } finally {
      await f.dispose();
    }
  });
  it("requires admin authentication, commerce permission and MFA for every external refund mutation", async () => {
    for (const denied of [
      new ApiError(401, "unauthorized", "Admin required"),
      { ...admin, role: "employee" as const },
      { ...admin, mfaVerified: false },
    ]) {
      const f = fixture(user, denied);
      try {
        const expected = denied instanceof Error ? 401 : 403;
        expect(
          (
            await f.request("/admin/v1/commerce/external-refunds/observe", {
              body: { sourceEventId: "evt_verified", reason: "test" },
            })
          ).status,
        ).toBe(expected);
        expect(
          (await f.request(`/admin/v1/commerce/external-refunds/${orderId}/allocate`, { body: {} }))
            .status,
        ).toBe(expected);
        expect(f.payments.observeExternalRefund).not.toHaveBeenCalled();
        expect(f.payments.allocateExternalRefund).not.toHaveBeenCalled();
      } finally {
        await f.dispose();
      }
    }
  });
});
