import { ServiceMap } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { describe, expect, it, vi } from "vitest";

import type { AdminAuth, AdminPrincipal } from "../admin/AdminAuth.ts";
import type { Principal, PrincipalResolver } from "../auth/guard.ts";
import { RequestContext } from "../http/context.ts";
import { ApiError } from "../http/errors.ts";
import type { CommerceService } from "./CommerceService.ts";
import { makeCommerceRoutes } from "./routes.ts";

const user: Principal = {
  userId: "00000000-0000-4000-8000-000000000001",
  email: "buyer@test.invalid",
  emailVerified: true,
  banned: false,
  sessionId: "user-session",
  orgId: "team-ai-org",
  personalOrgId: "personal-org",
  role: "owner",
};
const admin: AdminPrincipal = {
  adminId: "00000000-0000-4000-8000-000000000002",
  email: "admin@test.invalid",
  role: "admin",
  sessionId: "admin-session",
  mfaVerified: true,
};

function fixture(
  principal: Principal | Error = user,
  administrator: AdminPrincipal | Error = admin,
) {
  const commerce = {
    catalog: vi.fn(async () => ({ products: [], currency: "CAD", mode: "disabled" })),
    profile: vi.fn(async () => ({})),
    favorites: vi.fn(async () => ({ userId: user.userId, productIds: [] })),
    setFavorite: vi.fn(async () => ({})),
    createOrder: vi.fn(async () => ({})),
    wallet: vi.fn(async () => ({})),
    ledgerEntries: vi.fn(async () => ({ entries: [] })),
    adminCatalog: vi.fn(async () => ({ products: [] })),
    saveProduct: vi.fn(async () => ({})),
    supplierStatement: vi.fn(async () => ({ rows: [], settlementAssessment: "not_assessed" })),
    recordSupplierPaymentDocument: vi.fn(async () => ({ record: {} })),
    listSupplierPaymentDocuments: vi.fn(async () => ({ records: [] })),
    getSupplierPaymentDocument: vi.fn(async () => ({ record: {} })),
    reportSupplierIssue: vi.fn(async () => ({ ok: true })),
    adminOrders: vi.fn(async () => ({ orders: [] })),
    adminOrder: vi.fn(async () => ({ order: {} })),
    adminWithdrawal: vi.fn(async () => ({ withdrawal: {} })),
    listWithdrawals: vi.fn(async () => ({ withdrawals: [] })),
    deliver: vi.fn(async () => ({ ok: true })),
    releaseCommissions: vi.fn(async () => ({ released: 0 })),
    setOpenCase: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
    createSupplier: vi.fn(async () => ({ supplier: {} })),
    adminSupplierMembers: vi.fn(async () => ({ members: [] })),
    addSupplierMember: vi.fn(async () => ({ ok: true })),
    revokeSupplierMember: vi.fn(async () => ({ ok: true })),
    setSupplierActive: vi.fn(async () => ({ ok: true })),
    reviewWithdrawal: vi.fn(async () => ({ withdrawal: {} })),
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
    makeCommerceRoutes({
      commerce: commerce as unknown as CommerceService,
      principals: { resolve } as PrincipalResolver,
      adminAuth: { resolve: resolveAdmin } as unknown as AdminAuth,
    }),
    { disableLogger: true },
  );
  const context = ServiceMap.make(RequestContext, {
    traceId: "commerce-http-test",
    ip: "127.0.0.1",
    userAgent: null,
    region: "test",
    startedAt: Date.now(),
  });
  const call = (path: string, method = "GET", body?: unknown) =>
    router.handler(
      new Request(`http://commerce.test${path}`, {
        method,
        headers: { "content-type": "application/json", cookie: "djl_admin=admin-cookie" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      context,
    );
  return { commerce, resolve, resolveAdmin, call, dispose: router.dispose };
}

describe("commerce HTTP trust boundaries", () => {
  it("scopes favorite reads and writes to the authenticated buyer, not a submitted user id", async () => {
    const f = fixture();
    const id = "00000000-0000-4000-8000-000000000003";
    try {
      expect((await f.call("/v1/commerce/favorites?userId=someone-else")).status).toBe(200);
      expect(f.commerce.favorites).toHaveBeenCalledExactlyOnceWith(user.userId);
      expect(
        (
          await f.call(`/v1/commerce/favorites/${id}`, "POST", {
            userId: "someone-else",
            expectedUserId: user.userId,
            saved: false,
          })
        ).status,
      ).toBe(200);
      expect(f.commerce.setFavorite).toHaveBeenCalledExactlyOnceWith(
        { id: user.userId, type: "user", traceId: "commerce-http-test" },
        id,
        false,
        user.userId,
      );
    } finally {
      await f.dispose();
    }
  });
  it("requires sign-in for favorites and verified email for favorite writes", async () => {
    const guest = fixture(new ApiError(401, "unauthorized", "Sign in required"));
    const unverified = fixture({ ...user, emailVerified: false });
    try {
      expect((await guest.call("/v1/commerce/favorites")).status).toBe(401);
      expect(guest.commerce.favorites).not.toHaveBeenCalled();
      expect(
        (
          await unverified.call(
            "/v1/commerce/favorites/00000000-0000-4000-8000-000000000003",
            "POST",
            {
              expectedUserId: user.userId,
              saved: true,
            },
          )
        ).status,
      ).toBe(403);
      expect(unverified.commerce.setFavorite).not.toHaveBeenCalled();
    } finally {
      await guest.dispose();
      await unverified.dispose();
    }
  });
  it("routes TEST supplier payment document registration through the administrator boundary", async () => {
    const f = fixture();
    const supplierId = "00000000-0000-4000-8000-000000000003";
    const body = {
      operationId: "00000000-0000-4000-8000-000000000006",
      amountCents: 3000,
      currency: "CAD",
      reference: "Synthetic shared reference",
      evidenceReference: "Synthetic document only; not bank confirmation",
      reason: "Synthetic TEST supplier payment document",
    };
    try {
      const response = await f.call(
        `/admin/v1/commerce/suppliers/${supplierId}/payment-records`,
        "POST",
        body,
      );
      expect(response.status).toBe(200);
      expect(f.commerce.recordSupplierPaymentDocument).toHaveBeenCalledExactlyOnceWith(
        { id: admin.adminId, type: "admin", traceId: "commerce-http-test" },
        supplierId,
        body,
      );
    } finally {
      await f.dispose();
    }
  });

  it("routes supplier document history and operation lookup through administrator reads", async () => {
    const f = fixture();
    const supplierId = "00000000-0000-4000-8000-000000000003";
    const operationId = "00000000-0000-4000-8000-000000000006";
    const actor = { id: admin.adminId, type: "admin", traceId: "commerce-http-test" };
    try {
      expect(
        (await f.call(`/admin/v1/commerce/suppliers/${supplierId}/payment-records?page=2`)).status,
      ).toBe(200);
      expect(f.commerce.listSupplierPaymentDocuments).toHaveBeenCalledExactlyOnceWith(
        actor,
        supplierId,
        "2",
      );
      expect(
        (
          await f.call(
            `/admin/v1/commerce/suppliers/${supplierId}/payment-records/by-operation/${operationId}`,
          )
        ).status,
      ).toBe(200);
      expect(f.commerce.getSupplierPaymentDocument).toHaveBeenCalledExactlyOnceWith(
        actor,
        supplierId,
        operationId,
      );
    } finally {
      await f.dispose();
    }
  });

  it("requires separate administrator permissions and MFA for every document endpoint", async () => {
    const base = "/commerce/suppliers/00000000-0000-4000-8000-000000000003/payment-records";
    for (const principal of [
      new ApiError(401, "unauthorized", "Admin required"),
      { ...admin, mfaVerified: false },
      { ...admin, role: "employee" as const },
    ]) {
      const f = fixture(user, principal);
      try {
        for (const [path, method, body] of [
          [base, "POST", {}],
          [base, "GET", undefined],
          [base + "/by-operation/00000000-0000-4000-8000-000000000006", "GET", undefined],
        ] as const) {
          expect((await f.call("/admin/v1" + path, method, body)).status).toBe(
            principal instanceof Error ? 401 : 403,
          );
          expect((await f.call("/v1" + path, method, body)).status).toBe(404);
        }
        expect(f.commerce.recordSupplierPaymentDocument).not.toHaveBeenCalled();
        expect(f.commerce.listSupplierPaymentDocuments).not.toHaveBeenCalled();
        expect(f.commerce.getSupplierPaymentDocument).not.toHaveBeenCalled();
      } finally {
        await f.dispose();
      }
    }
  });

  it.each([
    ["start-payment", "start_payment"],
    ["mark-payment-unknown", "mark_unknown"],
    ["confirm-payment-success", "confirm_payment_success"],
  ])("routes %s through the administrator boundary with a fixed action", async (path, action) => {
    const f = fixture();
    const id = "00000000-0000-4000-8000-000000000005";
    const body = {
      operationId: "00000000-0000-4000-8000-000000000006",
      reason: "Manual operation review",
    };
    try {
      expect(
        (await f.call(`/admin/v1/commerce/withdrawals/${id}/${path}`, "POST", body)).status,
      ).toBe(200);
      expect(f.commerce.reviewWithdrawal).toHaveBeenCalledExactlyOnceWith(
        { id: admin.adminId, type: "admin", traceId: "commerce-http-test" },
        id,
        action,
        body,
      );
    } finally {
      await f.dispose();
    }
  });

  it("requires separate administrator permission and MFA before every manual payment mutation", async () => {
    const id = "00000000-0000-4000-8000-000000000005";
    for (const principal of [
      new ApiError(401, "unauthorized", "Admin required"),
      { ...admin, mfaVerified: false },
      { ...admin, role: "employee" as const },
    ]) {
      const f = fixture(user, principal);
      try {
        for (const path of ["start-payment", "mark-payment-unknown", "confirm-payment-success"]) {
          expect(
            (await f.call(`/admin/v1/commerce/withdrawals/${id}/${path}`, "POST", {})).status,
          ).toBe(principal instanceof Error ? 401 : 403);
          expect((await f.call(`/v1/commerce/withdrawals/${id}/${path}`, "POST", {})).status).toBe(
            404,
          );
        }
        expect(f.commerce.reviewWithdrawal).not.toHaveBeenCalled();
      } finally {
        await f.dispose();
      }
    }
  });
  it("uses path-scoped supplier/member IDs and verified administrator metadata for supplier access changes", async () => {
    const supplierId = "00000000-0000-4000-8000-000000000003";
    const memberId = "00000000-0000-4000-8000-000000000004";
    const actor = { id: admin.adminId, type: "admin", traceId: "commerce-http-test" };
    const reason = "Administrator checked supplier access";
    const f = fixture();
    try {
      expect(
        (
          await f.call(
            `/admin/v1/commerce/suppliers/${supplierId}/members?page=2&supplierId=forged&userId=forged`,
          )
        ).status,
      ).toBe(200);
      expect(f.commerce.adminSupplierMembers).toHaveBeenCalledExactlyOnceWith(supplierId, "2");
      expect(
        (
          await f.call("/admin/v1/commerce/suppliers", "POST", {
            name: "Supplier",
            returnAddress: "Toronto",
            reason,
            idempotencyKey: "supplier-create-route-intent",
          })
        ).status,
      ).toBe(200);
      expect(f.commerce.createSupplier).toHaveBeenCalledExactlyOnceWith(actor, {
        name: "Supplier",
        returnAddress: "Toronto",
        reason,
        idempotencyKey: "supplier-create-route-intent",
      });
      expect(
        (
          await f.call(`/admin/v1/commerce/suppliers/${supplierId}/members`, "POST", {
            userId: memberId,
            reason,
          })
        ).status,
      ).toBe(200);
      expect(f.commerce.addSupplierMember).toHaveBeenCalledExactlyOnceWith(
        actor,
        supplierId,
        memberId,
        reason,
      );
      expect(
        (
          await f.call(
            `/admin/v1/commerce/suppliers/${supplierId}/members/${memberId}/revoke`,
            "POST",
            { supplierId: "forged", userId: "forged", actorId: "forged", reason },
          )
        ).status,
      ).toBe(200);
      expect(f.commerce.revokeSupplierMember).toHaveBeenCalledExactlyOnceWith(
        actor,
        supplierId,
        memberId,
        reason,
      );
      expect(
        (
          await f.call(`/admin/v1/commerce/suppliers/${supplierId}/status`, "POST", {
            supplierId: "forged",
            active: false,
            reason,
          })
        ).status,
      ).toBe(200);
      expect(f.commerce.setSupplierActive).toHaveBeenCalledExactlyOnceWith(
        actor,
        supplierId,
        false,
        reason,
      );
    } finally {
      await f.dispose();
    }
  });
  it("requires administrator permission and verified MFA on every supplier access endpoint", async () => {
    const supplierId = "00000000-0000-4000-8000-000000000003";
    const memberId = "00000000-0000-4000-8000-000000000004";
    for (const principal of [
      new ApiError(401, "unauthorized", "Admin required"),
      { ...admin, mfaVerified: false },
      { ...admin, role: "employee" as const },
    ]) {
      const f = fixture(user, principal),
        status = principal instanceof Error ? 401 : 403;
      try {
        expect((await f.call(`/admin/v1/commerce/suppliers/${supplierId}/members`)).status).toBe(
          status,
        );
        expect(
          (
            await f.call(
              `/admin/v1/commerce/suppliers/${supplierId}/members/${memberId}/revoke`,
              "POST",
              { reason: "Review" },
            )
          ).status,
        ).toBe(status);
        expect(
          (
            await f.call(`/admin/v1/commerce/suppliers/${supplierId}/status`, "POST", {
              active: false,
              reason: "Review",
            })
          ).status,
        ).toBe(status);
        expect(
          (
            await f.call(`/admin/v1/commerce/suppliers/${supplierId}/members`, "POST", {
              userId: memberId,
              reason: "Review",
            })
          ).status,
        ).toBe(status);
        expect(
          (
            await f.call("/admin/v1/commerce/suppliers", "POST", {
              name: "Supplier",
              returnAddress: "Toronto",
              reason: "Review",
            })
          ).status,
        ).toBe(status);
        for (const call of [
          f.commerce.adminSupplierMembers,
          f.commerce.revokeSupplierMember,
          f.commerce.setSupplierActive,
          f.commerce.addSupplierMember,
          f.commerce.createSupplier,
        ])
          expect(call).not.toHaveBeenCalled();
      } finally {
        await f.dispose();
      }
    }
  });
  it("accepts only a reviewed close envelope and binds support actions to verified staff", async () => {
    const id = "00000000-0000-4000-8000-000000000003";
    const path = `/admin/v1/commerce/items/${id}/case`;
    const actor = { id: admin.adminId, type: "admin", traceId: "commerce-http-test" };
    const revision = "a".repeat(64);
    const close = { reviewedClose: { reason: "Reviewed support outcome", revision } };
    const f = fixture();
    try {
      expect((await f.call(path, "POST", close)).status).toBe(200);
      expect(f.commerce.setOpenCase).toHaveBeenCalledExactlyOnceWith(
        actor,
        id,
        false,
        close.reviewedClose.reason,
        revision,
      );
      expect((await f.call(path, "POST", { ...close, handledBy: "forged" })).status).toBe(400);
      expect(
        (
          await f.call(path, "POST", {
            reviewedClose: { ...close.reviewedClose, handledAt: "forged" },
          })
        ).status,
      ).toBe(400);
      expect(
        (await f.call(path, "POST", { open: false, reason: "Legacy without review" })).status,
      ).toBe(409);
      expect(f.commerce.setOpenCase).toHaveBeenCalledOnce();
      expect((await f.call(path, "POST", { open: true, reason: "Support follow-up" })).status).toBe(
        200,
      );
      expect(f.commerce.setOpenCase).toHaveBeenLastCalledWith(actor, id, true, "Support follow-up");
    } finally {
      await f.dispose();
    }
    for (const principal of [
      new ApiError(401, "unauthorized", "Admin required"),
      { ...admin, role: "employee" as const },
      { ...admin, mfaVerified: false },
    ]) {
      const denied = fixture(user, principal);
      try {
        expect((await denied.call(path, "POST", close)).status).toBe(
          principal instanceof Error ? 401 : 403,
        );
        expect(denied.commerce.setOpenCase).not.toHaveBeenCalled();
        expect((await denied.call(`/admin/v1/commerce/orders/${id}`)).status).toBe(
          principal instanceof Error ? 401 : 403,
        );
        expect(denied.commerce.adminOrder).not.toHaveBeenCalled();
      } finally {
        await denied.dispose();
      }
    }
  });
  it("forwards the mandatory operator evidence to delivery and commission-release services", async () => {
    const id = "00000000-0000-4000-8000-000000000003";
    const f = fixture();
    try {
      expect(
        (
          await f.call(`/admin/v1/commerce/items/${id}/deliver`, "POST", {
            reason: "Operator reviewed receipt",
          })
        ).status,
      ).toBe(200);
      expect(f.commerce.deliver).toHaveBeenCalledExactlyOnceWith(
        { id: admin.adminId, type: "admin", traceId: "commerce-http-test" },
        id,
        "Operator reviewed receipt",
      );
      expect(
        (
          await f.call("/admin/v1/commerce/commissions/release", "POST", {
            reason: "Operator reviewed eligibility",
          })
        ).status,
      ).toBe(200);
      expect(f.commerce.releaseCommissions).toHaveBeenCalledExactlyOnceWith(
        { id: admin.adminId, type: "admin", traceId: "commerce-http-test" },
        "Operator reviewed eligibility",
      );
    } finally {
      await f.dispose();
    }
  });
  it("uses the verified session for supplier issue reports and ignores claimed supplier authority", async () => {
    const id = "00000000-0000-4000-8000-000000000003";
    const body = {
      kind: "out_of_stock",
      reason: "No stock",
      idempotencyKey: "issue-test-key",
      userId: "other",
      role: "admin",
    };
    const f = fixture();
    try {
      expect((await f.call(`/v1/commerce/supplier/items/${id}/issues`, "POST", body)).status).toBe(
        200,
      );
      expect(f.commerce.reportSupplierIssue).toHaveBeenCalledExactlyOnceWith(
        { id: user.userId, type: "user", traceId: "commerce-http-test" },
        id,
        body,
      );
    } finally {
      await f.dispose();
    }
    const unverified = fixture({ ...user, emailVerified: false });
    try {
      expect(
        (await unverified.call(`/v1/commerce/supplier/items/${id}/issues`, "POST", body)).status,
      ).toBe(403);
      expect(unverified.commerce.reportSupplierIssue).not.toHaveBeenCalled();
    } finally {
      await unverified.dispose();
    }
  });
  it("locates historical orders and withdrawals directly, without accepting owner selectors", async () => {
    const id = "00000000-0000-4000-8000-000000000003";
    const f = fixture();
    try {
      expect((await f.call(`/admin/v1/commerce/orders/${id}?ownerId=other`)).status).toBe(200);
      expect(f.commerce.adminOrder).toHaveBeenCalledExactlyOnceWith(id);
      expect((await f.call(`/admin/v1/commerce/withdrawals/${id}?userId=other`)).status).toBe(200);
      expect(f.commerce.adminWithdrawal).toHaveBeenCalledExactlyOnceWith(id);
    } finally {
      await f.dispose();
    }
    for (const p of [
      new ApiError(401, "unauthorized", "Admin required"),
      { ...admin, mfaVerified: false },
      { ...admin, role: "employee" as const },
    ]) {
      const denied = fixture(user, p);
      try {
        for (const path of ["orders", "withdrawals"])
          expect((await denied.call(`/admin/v1/commerce/${path}/${id}`)).status).toBe(
            p instanceof Error ? 401 : 403,
          );
        expect(denied.commerce.adminOrder).not.toHaveBeenCalled();
        expect(denied.commerce.adminWithdrawal).not.toHaveBeenCalled();
      } finally {
        await denied.dispose();
      }
    }
  });
  it("keeps the catalog public but personal data authenticated", async () => {
    const f = fixture(new ApiError(401, "unauthorized", "Sign in required."));
    try {
      expect((await f.call("/v1/commerce/catalog")).status).toBe(200);
      expect(f.resolve).not.toHaveBeenCalled();
      expect((await f.call("/v1/commerce/wallet")).status).toBe(401);
      expect(f.commerce.wallet).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
  it("uses personal user identity, ignoring requested ownerId/orgId in user ledger reads", async () => {
    const f = fixture();
    try {
      expect((await f.call("/v1/commerce/wallet/entries?ownerId=other&orgId=team")).status).toBe(
        200,
      );
      expect(f.commerce.ledgerEntries).toHaveBeenCalledExactlyOnceWith(user.userId, undefined);
    } finally {
      await f.dispose();
    }
  });
  it("requires verified email for mutations and rejects array bodies before service calls", async () => {
    const unverified = fixture({ ...user, emailVerified: false });
    try {
      expect((await unverified.call("/v1/commerce/orders", "POST", {})).status).toBe(403);
      expect(unverified.commerce.createOrder).not.toHaveBeenCalled();
    } finally {
      await unverified.dispose();
    }
    const f = fixture();
    try {
      expect((await f.call("/v1/commerce/orders", "POST", [])).status).toBe(400);
      expect(f.commerce.createOrder).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
  it("does not turn AI organization owners or support employees into commerce administrators", async () => {
    const unauthenticated = fixture(
      user,
      new ApiError(401, "unauthorized", "Admin sign-in required."),
    );
    try {
      expect((await unauthenticated.call("/admin/v1/commerce/catalog")).status).toBe(401);
      expect(unauthenticated.commerce.adminCatalog).not.toHaveBeenCalled();
    } finally {
      await unauthenticated.dispose();
    }
    const support = fixture(user, { ...admin, role: "employee" });
    try {
      expect((await support.call("/admin/v1/commerce/catalog")).status).toBe(403);
      expect((await support.call("/admin/v1/commerce/catalog", "POST", {})).status).toBe(403);
      expect(support.commerce.saveProduct).not.toHaveBeenCalled();
    } finally {
      await support.dispose();
    }
  });
  it("requires administrator MFA even when the session resolves", async () => {
    const f = fixture(user, { ...admin, mfaVerified: false });
    try {
      const result = await f.call("/admin/v1/commerce/ledger");
      expect(result.status).toBe(403);
      expect((await result.json()).error.code).toBe("mfa_required");
      expect(f.commerce.ledgerEntries).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  });
  it("forwards a bounded-page input while never accepting a caller-supplied ledger owner", async () => {
    const f = fixture();
    try {
      expect((await f.call("/admin/v1/commerce/catalog?page=2")).status).toBe(200);
      expect(f.commerce.adminCatalog).toHaveBeenCalledExactlyOnceWith("2");
      expect((await f.call("/v1/commerce/wallet/entries?page=1&ownerId=other")).status).toBe(200);
      expect(f.commerce.ledgerEntries).toHaveBeenCalledExactlyOnceWith(user.userId, "1");
    } finally {
      await f.dispose();
    }
  });
  it("scopes supplier statements to the server actor and preserves exact UTC query boundaries", async () => {
    const f = fixture();
    const supplierId = "00000000-0000-4000-8000-000000000003";
    const from = "2026-01-01T00:00:00.000001Z",
      to = "2026-02-01T00:00:00.123456Z";
    try {
      const query = new URLSearchParams({
        from,
        to,
        page: "1",
        ownerId: admin.adminId,
        userId: admin.adminId,
      });
      expect((await f.call(`/v1/commerce/supplier/${supplierId}/statement?${query}`)).status).toBe(
        200,
      );
      expect(f.commerce.supplierStatement).toHaveBeenNthCalledWith(
        1,
        { id: user.userId, type: "user", traceId: "commerce-http-test" },
        supplierId,
        { from, to, page: "1" },
      );
      expect(
        (await f.call(`/admin/v1/commerce/suppliers/${supplierId}/statement?${query}`)).status,
      ).toBe(200);
      expect(f.commerce.supplierStatement).toHaveBeenNthCalledWith(
        2,
        { id: admin.adminId, type: "admin", traceId: "commerce-http-test" },
        supplierId,
        { from, to, page: "1" },
      );
    } finally {
      await f.dispose();
    }
  });
  it("requires separate admin permission and MFA for supplier statement reads", async () => {
    const supplierId = "00000000-0000-4000-8000-000000000003";
    for (const p of [
      new ApiError(401, "unauthorized", "Admin required"),
      { ...admin, mfaVerified: false },
      { ...admin, role: "employee" as const },
    ]) {
      const f = fixture(user, p);
      try {
        expect((await f.call(`/admin/v1/commerce/suppliers/${supplierId}/statement`)).status).toBe(
          p instanceof Error ? 401 : 403,
        );
        expect(f.commerce.supplierStatement).not.toHaveBeenCalled();
      } finally {
        await f.dispose();
      }
    }
  });
  it("forwards attention and withdrawal-status filters only to administrator list methods", async () => {
    const f = fixture();
    try {
      expect(
        (await f.call("/admin/v1/commerce/orders?attention=needs_attention&page=3")).status,
      ).toBe(200);
      expect(f.commerce.adminOrders).toHaveBeenCalledExactlyOnceWith("3", "needs_attention");
      expect((await f.call("/admin/v1/commerce/withdrawals?status=approved&page=2")).status).toBe(
        200,
      );
      expect(f.commerce.listWithdrawals).toHaveBeenNthCalledWith(1, undefined, "2", "approved");
      expect(
        (await f.call("/v1/commerce/withdrawals?status=approved&ownerId=other&page=1")).status,
      ).toBe(200);
      expect(f.commerce.listWithdrawals).toHaveBeenNthCalledWith(2, user.userId, "1");
    } finally {
      await f.dispose();
    }
  });
});
