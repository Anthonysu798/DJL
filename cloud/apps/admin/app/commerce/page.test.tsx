import { act, type ReactNode } from "react";
import type {
  CommercePaymentStatus,
  CommerceExternalRefund,
  CommerceExternalRefundDetail,
  CommerceSupplierStatement,
  CommerceAlertsResponse,
  CommerceAdminWithdrawal,
  CommerceAdminPermission,
  CommerceStaffRole,
} from "@synara/contracts/cloud";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { admin } = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  admin,
}));
import { AdminApiError, setToken } from "@/lib/api";
vi.mock("@/components/Shell", () => ({
  Shell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
import CommerceAdminPage from "./page";
import { parseAllocationCents } from "./ExternalRefundAllocation";

const product = {
  id: "product-1",
  supplierId: "supplier-1",
  sku: "TEST-SKU",
  name: "Test Product",
  description: "Test item",
  category: "Home",
  imageUrl: "https://cdn.example.invalid/item.png",
  priceCents: 3900,
  costCents: 1000,
  commissionBps: 1000,
  returnDays: 30,
  stock: 10,
  reserved: 0,
  status: "draft",
};
let root: Root;
let host: HTMLDivElement;
let orderRows: unknown[];
let withdrawalRows: unknown[];
let paginate = false;
const owner = { id: "owner", email: "owner@example.invalid", role: "admin", mfaVerified: true };
function scoped(
  commerceRole: CommerceStaffRole,
  ...commercePermissions: CommerceAdminPermission[]
) {
  return {
    id: "commerce-staff",
    email: "staff@example.invalid",
    role: "commerce",
    mfaVerified: true,
    commerceRole,
    commercePermissions,
  };
}
let profile: typeof owner | ReturnType<typeof scoped>;
let stripePayment: CommercePaymentStatus;
const paidStripe: CommercePaymentStatus = {
  enabled: true,
  mode: "test",
  provider: "stripe_test",
  paymentProvider: "stripe_test",
  orderId: "stripe-order-1",
  attemptId: "attempt-1",
  sessionId: "cs_test_UNIT123",
  status: "paid",
  checkoutUrl: null,
  expiresAt: null,
  refunds: [],
};

let externalDetail: CommerceExternalRefundDetail;
let externalRows: CommerceExternalRefund[];
let loseExternalResponse = 0;
let staleExternalResponse = false;
const externalRefund: CommerceExternalRefund = {
  id: "external-1",
  orderId: "stripe-order-1",
  attemptId: "attempt-1",
  providerRefundId: "re_TEST_EXTERNAL",
  sourceEventId: "evt_TEST_EXTERNAL",
  amountCents: 1200,
  currency: "CAD",
  providerStatus: "succeeded",
  allocationState: "unallocated",
  version: 3,
  allocatedAt: null,
  allocations: [],
};
const supplierStatement: CommerceSupplierStatement = {
  supplier: { id: "supplier-1", name: "Test Supplier", active: true },
  currency: "CAD",
  mode: "test",
  settlementAssessment: "not_assessed",
  generatedAt: "2026-10-26T12:00:00.123456Z",
  period: { from: null, to: "2026-10-26T12:00:00.123456Z" },
  summary: {
    openingCents: 0,
    accruedCents: 5000,
    reversedCents: 1500,
    unclassifiedCents: -100,
    closingCents: 3400,
    equationDifferenceCents: 0,
    reconciliationOk: false,
    unclassifiedEntries: 1,
    hasUnresolvedRefunds: true,
  },
  rows: [
    {
      eventKey: "refund:test-line",
      resourceId: "test-line",
      ledgerEntryIds: ["entry-refund"],
      createdAt: "2026-10-26T11:00:00Z",
      kind: "refund_reversal",
      amountCents: -1500,
      orderId: "test-order",
      orderItemId: "test-line",
      items: [
        {
          itemId: "test-line",
          sku: "HISTORICAL-SKU",
          name: "供货商品",
          quantity: 1,
          unitCostCents: 5000,
          totalCostCents: 5000,
        },
      ],
    },
  ],
  page: 0,
  pageSize: 100,
  hasMore: true,
  totalRows: 101,
};
const alertsResponse: CommerceAlertsResponse = {
  enabled: true,
  externalDelivery: {
    enabled: false,
    configuration: "disabled",
    mode: "mock",
    counts: { pending: 0, submitting: 0, accepted: 0, simulated: 0, needsReview: 0, skipped: 0 },
    lastAttemptAt: null,
  },
  monitor: {
    status: "healthy",
    lastSuccessfulScanAt: "2026-10-26T12:00:00.000001Z",
    intervalSeconds: 300,
    staleAfterSeconds: 900,
  },
  counts: { open: 1, pending: 0 },
  nextCursor: null,
  incidents: [
    {
      id: "historical-alert",
      kind: "payment_review",
      resourceType: "payment_attempt",
      resourceId: "historical-attempt",
      orderId: "historical-order",
      sourceStatus: "requires_review",
      state: "open",
      firstDetectedAt: "2026-10-26T11:00:00.000001Z",
      openedAt: "2026-10-26T11:05:00.000001Z",
      lastSeenAt: "2026-10-26T12:00:00.000001Z",
      resolvedAt: null,
      lastTransitionAt: "2026-10-26T11:05:00.000001Z",
      emailDelivery: null,
    },
  ],
};
const oldCaseRevision = "a".repeat(64);
const newCaseRevision = "b".repeat(64);
const reviewedCaseOrder = (caseRevision?: string, requestReason = "Original buyer case") => ({
  id: "reviewed-order",
  paymentProvider: "simulation",
  status: "paid",
  totalCents: 10000,
  refundedCents: 0,
  items: [
    {
      id: "reviewed-item",
      sku: "REVIEWED-SKU",
      name: "Reviewed item",
      quantity: 1,
      lineCents: 10000,
      refundedCents: 0,
      status: "delivered",
      trackingNumber: null,
      openCase: true,
      ...(caseRevision === undefined ? {} : { caseRevision }),
      returnRequest: { reason: requestReason, requestedAt: "2026-10-25T12:00:00Z" },
    },
  ],
});
const reviewedCasePath = "/commerce/items/reviewed-item/case";
const caseReasonField = (form: HTMLFormElement) =>
  form.elements.namedItem("caseReason") as HTMLInputElement;

function prepareExternalOrder() {
  stripePayment = { ...paidStripe, status: "requires_review" };
  externalDetail = { ...externalDetail, payment: stripePayment };
  orderRows = [
    {
      id: "stripe-order-1",
      paymentProvider: "stripe_test",
      status: "paid",
      totalCents: 12000,
      refundedCents: 0,
      items: [
        {
          id: "red-item",
          sku: "RED-SKU",
          name: "同名商品",
          quantity: 1,
          lineCents: 7000,
          refundedCents: 0,
          status: "delivered",
          trackingNumber: null,
          openCase: true,
          caseRevision: oldCaseRevision,
        },
        {
          id: "blue-item",
          sku: "BLUE-SKU",
          name: "同名商品",
          quantity: 1,
          lineCents: 5000,
          refundedCents: 0,
          status: "delivered",
          trackingNumber: null,
          openCase: true,
          caseRevision: oldCaseRevision,
        },
      ],
    },
  ];
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  admin.mockReset();
  orderRows = [];
  withdrawalRows = [];
  paginate = false;
  profile = owner;
  stripePayment = { ...paidStripe, refunds: [] };
  loseExternalResponse = 0;
  staleExternalResponse = false;
  externalRows = [{ ...externalRefund, allocations: [] }];
  externalDetail = {
    refund: externalRows[0]!,
    enabled: true,
    canAllocate: true,
    message: "渠道已确认成功，可登记商品归属，不会再次退款。",
    items: [
      { itemId: "red-item", name: "同名商品", sku: "RED-SKU", remainingCents: 7000 },
      { itemId: "blue-item", name: "同名商品", sku: "BLUE-SKU", remainingCents: 5000 },
    ],
    payment: stripePayment,
  };

  admin.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/me") return { admin: profile };
    if (
      path === "/commerce/orders/stripe-order-1/payment" ||
      path === "/commerce/orders/stripe-order-1/payment/reconcile"
    )
      return { payment: stripePayment };
    if (path === "/commerce/items/stripe-item-1/provider-refunds") {
      const refund = {
        id: "provider-refund-1",
        itemId: "stripe-item-1",
        amountCents: 1200,
        refundTotalCents: 1200,
        status: "unknown" as const,
        createdAt: "2026-10-26T12:00:00Z",
      };
      stripePayment = { ...stripePayment, refunds: [refund] };
      return { refund };
    }
    if (path.startsWith("/commerce/orders/stripe-order-1/external-refunds"))
      return {
        refunds: externalRows,
        enabled: externalDetail.enabled,
        page: path.includes("?page=") ? 1 : 0,
        hasMore: paginate && !path.includes("?page="),
      };
    if (path === "/commerce/external-refunds/external-1") return externalDetail;
    if (path === "/commerce/external-refunds/observe") return externalDetail;
    if (path === "/commerce/external-refunds/external-1/allocate") {
      if (loseExternalResponse-- > 0) throw new TypeError("Offline response lost");
      if (staleExternalResponse) {
        staleExternalResponse = false;
        externalDetail = { ...externalDetail, refund: { ...externalDetail.refund, version: 4 } };
        throw new AdminApiError(
          409,
          "commerce_external_refund_stale",
          "Refund or review state changed",
        );
      }
      const refund: CommerceExternalRefund = {
        ...externalDetail.refund,
        allocationState: "allocated",
        version: 4,
        allocatedAt: "2026-10-26T10:00:00Z",
        allocations: [
          { itemId: "red-item", amountCents: 500, refundedBeforeCents: 0, refundedAfterCents: 500 },
          {
            itemId: "blue-item",
            amountCents: 700,
            refundedBeforeCents: 0,
            refundedAfterCents: 700,
          },
        ],
      };
      externalRows = [refund];
      externalDetail = {
        ...externalDetail,
        refund,
        canAllocate: false,
        items: [
          { ...externalDetail.items[0]!, remainingCents: 6500 },
          { ...externalDetail.items[1]!, remainingCents: 4300 },
        ],
      };
      return {
        refund,
        payment: stripePayment,
        applied: true,
        reviewCleared: false,
        message: "已原子登记；仍有其他异常待核实。",
      };
    }
    if (init?.method) return { ok: true };
    if (path.startsWith("/commerce/catalog"))
      return { products: [product], hasMore: paginate && !path.includes("?page=") };
    if (path === "/commerce/suppliers")
      return {
        suppliers: [
          { id: "supplier-1", name: "Test Supplier", returnAddress: "Canada", active: true },
        ],
      };
    if (path.startsWith("/commerce/orders"))
      return { orders: orderRows, hasMore: paginate && !path.includes("?page=") };
    if (path.startsWith("/commerce/withdrawals"))
      return { withdrawals: withdrawalRows, hasMore: paginate && !path.includes("?page=") };
    if (path.startsWith("/commerce/ledger"))
      return { entries: [], hasMore: paginate && !path.includes("?page=") };
    throw new Error(`Unexpected test request ${path}`);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setToken(null);
  vi.unstubAllGlobals();
});
const show = async () => {
  await act(async () => root.render(<CommerceAdminPage />));
};
const button = (text: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent === text,
  );
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
};
const click = async (text: string) => {
  await act(async () => button(text).click());
};
const submit = async (form: HTMLFormElement) => {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};
const select = async (label: string, value: string) => {
  const input = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  await act(async () => {
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
};
const fill = (form: HTMLFormElement, fields: Record<string, string>) => {
  for (const [name, value] of Object.entries(fields)) {
    const input = form.elements.namedItem(name) as HTMLInputElement | null;
    if (!input) throw new Error(`Missing input ${name}`);
    input.value = value;
  }
};

async function change(form: HTMLFormElement, name: string, value: string) {
  const input = form.elements.namedItem(name) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function openExternalDetail() {
  prepareExternalOrder();
  await show();
  await click("履约与售后");
  await click("查询外部退款记录");
  await click("查看退款归属详情");
  return host.querySelector<HTMLFormElement>('form[aria-label="核销已有渠道退款"]')!;
}
const manualWithdrawal = (
  status: CommerceAdminWithdrawal["status"] = "payment_pending",
): CommerceAdminWithdrawal => ({
  id: "confirm-manual",
  userId: "buyer-manual",
  approvedBy: status === "requested" ? null : "independent-test-approver",
  amountCents: 2500,
  status,
  reference: null,
  createdAt: "2026-10-01T12:00:00Z",
  paymentOperationId: "6b319a53-6dcb-47fe-b600-a4278dc5e189",
  paymentStartedBy: "payment-admin",
  paymentStartedAt: "2026-10-02T12:00:00Z",
  paymentUnknownAt: status === "payment_unknown" ? "2026-10-02T12:05:00Z" : null,
  paymentConfirmedAt: null,
  paymentConfirmedBy: null,
  paymentEvidenceReference: null,
  paymentConfirmationReason: null,
});
const manualSuccessFields = {
  reference: "  TEST-MANUAL-RESULT  ",
  evidenceReference: "  TEST-REVIEW-001  ",
  reason: "  Independently reviewed TEST evidence  ",
};
function fillManualSuccess(form: HTMLFormElement) {
  fill(form, manualSuccessFields);
  (form.elements.namedItem("acknowledge") as HTMLInputElement).checked = true;
}
describe("commerce admin forms with mocked transport, not a live administrator session", () => {
  it("loads catalog and monitoring but never requests finance data for operations staff", async () => {
    profile = scoped(
      "operations",
      "commerce.read",
      "commerce.catalog.write",
      "commerce.fulfillment.write",
      "commerce.monitor.read",
    );
    await show();
    expect(admin.mock.calls[0]?.[0]).toBe("/me");
    expect(host.textContent).toContain("Test Product");
    expect(button("创建草稿")).toBeTruthy();
    expect(button("异常监控")).toBeTruthy();
    expect(host.textContent).not.toContain("佣金与提现");
    expect(host.textContent).not.toContain("TEST 流水比对");
    expect(admin.mock.calls.some(([path]) => path.startsWith("/commerce/ledger"))).toBe(false);
    expect(admin.mock.calls.some(([path]) => path.startsWith("/commerce/withdrawals"))).toBe(false);
  });

  it("keeps the basic order case visible for support but does not render or fetch finance controls", async () => {
    profile = scoped("support", "commerce.read", "commerce.support.write");
    prepareExternalOrder();
    await show();
    expect(host.textContent).not.toContain("创建草稿");
    expect(host.textContent).not.toContain("异常监控");
    await click("履约与售后");
    expect(host.textContent).toContain("存在未结售后");
    expect(button("核实售后已解决并关闭")).toBeTruthy();
    expect(host.textContent).not.toContain("提交 Stripe 测试退款请求");
    expect(host.textContent).not.toContain("查询外部退款记录");
    expect(
      admin.mock.calls.some(([path]) => /ledger|withdrawals|payment|external-refunds/.test(path)),
    ).toBe(false);
  });

  it("renders withdrawal records and comparison for read-only staff without payment mutations", async () => {
    profile = scoped(
      "read_only",
      "commerce.read",
      "commerce.finance.read",
      "commerce.monitor.read",
    );
    withdrawalRows = [manualWithdrawal(), { ...manualWithdrawal("requested"), id: "review-1" }];
    await show();
    expect(host.textContent).not.toContain("创建草稿");
    await click("佣金与提现");
    expect(host.textContent).toContain("confirm-manual");
    expect(host.textContent).toContain("结果未确认，需人工核实");
    expect(host.textContent).not.toContain("检查并释放合格测试佣金");
    expect(host.textContent).not.toContain("登记已核验的 TEST 付款成功结果");
    expect(host.textContent).not.toContain("批准测试提现申请");
    expect(host.textContent).not.toContain("驳回并解冻");
    await click("TEST 流水比对");
    expect(host.querySelector('[aria-label="测试流水只读比对"]')).not.toBeNull();
    expect(admin.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("hands an approved payout to a different administrator rather than offering a doomed write", async () => {
    const base = manualWithdrawal("approved");
    withdrawalRows = [
      {
        ...base,
        id: "approved-by-current",
        approvedBy: owner.id,
        paymentOperationId: null,
        paymentStartedBy: null,
        paymentStartedAt: null,
      },
      {
        ...manualWithdrawal("payment_unknown"),
        id: "unknown-approved-by-current",
        approvedBy: owner.id,
      },
    ];
    await show();
    await click("佣金与提现");
    expect(host.textContent).toContain("本笔由你审批");
    expect(host.textContent).toContain("unknown-approved-by-current");
    expect(host.textContent).not.toContain("登记开始人工测试付款");
    expect(host.textContent).not.toContain("记录已核实测试付款");
    expect(host.textContent).not.toContain("登记已核验的 TEST 付款成功结果");
    expect(admin.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("does not offer a payment write for an approved row missing its approver", async () => {
    withdrawalRows = [
      { ...manualWithdrawal("approved"), approvedBy: null, paymentOperationId: null },
    ];
    await show();
    await click("佣金与提现");
    expect(host.textContent).toContain("缺少可核对的审批人");
    expect(host.textContent).not.toContain("登记开始人工测试付款");
    expect(host.textContent).not.toContain("记录已核实测试付款");
  });

  it.each(["registration", "readback"] as const)(
    "does not accept a %s with a different frozen amount",
    async (mismatch) => {
      const row = {
        ...manualWithdrawal("approved"),
        approvedBy: "independent-test-approver",
        paymentOperationId: null,
        paymentStartedAt: null,
        paymentStartedBy: null,
      };
      withdrawalRows = [row];
      const base = admin.getMockImplementation()!;
      let operationId: string;
      let corrected = false;
      admin.mockImplementation(async (path, init) => {
        if (path.endsWith("/start-payment")) {
          operationId = init.json.operationId;
          return {
            withdrawal: {
              ...row,
              paymentOperationId: operationId,
              amountCents: mismatch === "registration" ? 4999 : row.amountCents,
              status: "payment_pending",
            },
          };
        }
        if (path === `/commerce/withdrawals/${row.id}`) {
          return {
            withdrawal: {
              ...row,
              paymentOperationId: operationId,
              amountCents: corrected ? row.amountCents : 4999,
              status: "payment_pending",
            },
          };
        }
        return base(path, init);
      });
      await show();
      await click("佣金与提现");
      const form = button("登记开始人工测试付款").closest("form")!;
      fill(form, { reason: "Independently approved TEST instruction" });
      await submit(form);
      expect(host.textContent).not.toContain("CAD 49.99");
      expect(host.textContent).toContain("CAD 25.00");
      await click("查询原提现操作");
      expect(host.textContent).not.toContain("CAD 49.99");
      expect(button("查询原提现操作")).toBeTruthy();
      corrected = true;
      await click("查询原提现操作");
      expect(host.textContent).toContain("原操作记录已核对");
      expect(host.textContent).not.toContain("查询原提现操作");
      expect(admin.mock.calls.filter(([path]) => path.endsWith("/start-payment"))).toHaveLength(1);
    },
  );

  it("separates shipment confirmation from support and finance write controls", async () => {
    profile = scoped("operations", "commerce.read", "commerce.fulfillment.write");
    orderRows = [
      {
        id: "shipped-order",
        status: "paid",
        paymentProvider: "simulation",
        totalCents: 3900,
        refundedCents: 0,
        items: [
          {
            id: "shipped-line",
            name: "Shipped item",
            quantity: 1,
            lineCents: 3900,
            refundedCents: 0,
            status: "shipped",
            trackingNumber: "TEST-PARCEL",
            openCase: false,
          },
        ],
      },
    ];
    await show();
    await click("履约与售后");
    expect(host.textContent).toContain("运单 TEST-PARCEL");
    expect(host.textContent).not.toContain("标记售后处理中");
    expect(host.textContent).not.toContain("提交测试退款");
    const form = button("核实已签收").closest("form")!;
    fill(form, { reason: "Reviewed synthetic delivery scan" });
    await submit(form);
    expect(admin).toHaveBeenCalledWith("/commerce/items/shipped-line/deliver", {
      method: "POST",
      json: { reason: "Reviewed synthetic delivery scan" },
    });
  });

  it("lets finance work without showing catalog, fulfillment, or support actions", async () => {
    profile = scoped("finance", "commerce.read", "commerce.finance.read", "commerce.finance.write");
    prepareExternalOrder();
    withdrawalRows = [manualWithdrawal()];
    await show();
    expect(host.textContent).not.toContain("创建草稿");
    expect(host.textContent).not.toContain("授予供应商权限");
    await click("履约与售后");
    expect(host.textContent).toContain("存在未结售后");
    expect(host.textContent).not.toContain("核实售后已解决并关闭");
    expect(host.textContent).toContain("提交 Stripe 测试退款请求");
    await click("佣金与提现");
    expect(button("登记已核验的 TEST 付款成功结果")).toBeTruthy();
    expect(button("检查并释放合格测试佣金")).toBeTruthy();
  });

  it("does not fetch any commerce records when an account has no current grant", async () => {
    profile = scoped("none");
    await show();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("当前账号没有商城管理权限");
    expect(admin.mock.calls.map(([path]) => path)).toEqual(["/me"]);
    expect(host.querySelector("form")).toBeNull();
  });

  it("does not publish or follow up an old supplier creation in a new staff session", async () => {
    setToken("original-test-admin");
    const base = admin.getMockImplementation()!;
    let finish!: (result: unknown) => void;
    admin.mockImplementation((path, init) => {
      if (path === "/commerce/suppliers" && init?.method === "POST")
        return new Promise((resolve) => {
          finish = resolve;
        });
      return base(path, init);
    });
    await show();
    const form = host.querySelector<HTMLFormElement>('form[aria-label="创建供应商"]')!;
    fill(form, {
      name: "Prior session supplier",
      returnAddress: "Synthetic address",
      reason: "QA",
    });
    await submit(form);
    expect(finish).toBeTypeOf("function");
    profile = scoped("support", "commerce.read", "commerce.support.write");
    await act(async () => setToken("different-test-admin"));
    const requests = admin.mock.calls.length;
    await act(async () =>
      finish({ supplier: { id: "prior-supplier", name: "Prior session supplier" } }),
    );
    expect(admin.mock.calls).toHaveLength(requests);
    expect(host.textContent).not.toContain("Prior session supplier");
    expect(host.querySelector('form[aria-label="创建供应商"]')).toBeNull();
  });

  it("cannot start business reads when an older profile response arrives after sign-in changes", async () => {
    setToken("original-test-admin");
    let finish!: (result: unknown) => void;
    admin.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await show();
    expect(admin.mock.calls.map(([path]) => path)).toEqual(["/me"]);
    profile = scoped("none");
    await act(async () => setToken("different-test-admin"));
    await act(async () => finish({ admin: owner }));
    expect(admin.mock.calls.map(([path]) => path)).toEqual(["/me", "/me"]);
    expect(host.querySelector("form")).toBeNull();
    expect(host.textContent).toContain("当前账号没有商城管理权限");
  });

  it("shows a permission notice instead of unusable commerce controls after a read denial", async () => {
    admin.mockRejectedValue(
      new AdminApiError(403, "forbidden", "Your admin role cannot commerce.read."),
    );
    await show();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("当前账号没有商城管理权限");
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector('[aria-label="商城管理导航"]')).toBeNull();
    expect(host.querySelector('a[href="/"]')?.textContent).toBe("返回管理首页");
  });

  it("does not mistake a connection failure for a permission denial", async () => {
    admin.mockRejectedValue(new TypeError("Failed to fetch"));
    await show();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "暂时无法连接商城管理服务，请稍后重试。",
    );
    expect(button("刷新").disabled).toBe(false);
    expect(host.textContent).not.toContain("当前账号没有商城管理权限");
  });

  it("opens TEST statement comparison separately without submitting a file or changing money", async () => {
    await show();
    await click("TEST 流水比对");
    expect(host.querySelector('[aria-label="测试流水只读比对"]')).not.toBeNull();
    expect(host.textContent).toContain("人工文件来源未核验");
    expect(
      admin.mock.calls.some(
        ([path, init]) => path === "/commerce/reconciliation/compare" || init?.method === "POST",
      ),
    ).toBe(false);
  });
  it.each([undefined, "malformed", "A".repeat(64)])(
    "does not post a reviewed case close without a usable revision (%s)",
    async (revision) => {
      orderRows = [reviewedCaseOrder(revision)];
      await show();
      await click("履约与售后");
      const close = button("核实售后已解决并关闭");
      const form = close.closest("form")!;
      fill(form, { caseReason: "Attempted old close reason" });
      await submit(form);
      expect(admin.mock.calls.filter(([path]) => path === reviewedCasePath)).toHaveLength(0);
      expect(close.disabled).toBe(true);
      expect(button("刷新售后记录").disabled).toBe(false);
    },
  );

  it.each(["commerce_case_review_stale", "commerce_case_review_required"])(
    "requires a reviewed manual refresh and a fresh reason after a %s close conflict",
    async (code) => {
      const older = reviewedCaseOrder(oldCaseRevision);
      const newer = reviewedCaseOrder(newCaseRevision, "New buyer request needs review");
      orderRows = [older];
      const previous = admin.getMockImplementation()!;
      let writes = 0;
      let details = 0;
      admin.mockImplementation(async (path: string, init?: { method?: string }) => {
        if (path === reviewedCasePath) {
          if (++writes === 1) throw new AdminApiError(409, code, "Fixture case changed");
          return { ok: true };
        }
        if (path === "/commerce/orders/reviewed-order") {
          if (++details === 1) return { order: older };
          orderRows = [newer];
          return { order: newer };
        }
        return previous(path, init);
      });
      await show();
      await click("履约与售后");
      const original = button("核实售后已解决并关闭").closest("form")!;
      fill(original, { caseReason: "  Review before concurrent activity  " });
      await submit(original);
      expect(host.textContent).toContain("请先刷新售后记录");
      expect(admin.mock.calls.filter(([path]) => path === reviewedCasePath)).toEqual([
        [
          reviewedCasePath,
          {
            method: "POST",
            json: {
              reviewedClose: {
                reason: "Review before concurrent activity",
                revision: oldCaseRevision,
              },
            },
          },
        ],
      ]);
      expect(details).toBe(0);
      const blocked = button("核实售后已解决并关闭");
      expect(blocked.disabled).toBe(true);
      expect(caseReasonField(blocked.closest("form")!).value).toBe("");
      await submit(blocked.closest("form")!);
      expect(writes).toBe(1);

      await click("刷新售后记录");
      expect(details).toBe(1);
      expect(button("核实售后已解决并关闭").disabled).toBe(true);
      expect(writes).toBe(1);
      await click("刷新售后记录");
      expect(details).toBe(2);
      expect(host.textContent).toContain("New buyer request needs review");
      const fresh = button("核实售后已解决并关闭");
      expect(fresh.disabled).toBe(false);
      const freshForm = fresh.closest("form")!;
      expect(caseReasonField(freshForm).value).toBe("");
      await submit(freshForm);
      expect(writes).toBe(1);
      fill(freshForm, { caseReason: "  Checked the new buyer request  " });
      await submit(freshForm);
      expect(admin.mock.calls.findLast(([path]) => path === reviewedCasePath)).toEqual([
        reviewedCasePath,
        {
          method: "POST",
          json: {
            reviewedClose: { reason: "Checked the new buyer request", revision: newCaseRevision },
          },
        },
      ]);
      expect(writes).toBe(2);
    },
  );

  it("replaces an alert-selected case with its current detail after a stale close", async () => {
    const older = reviewedCaseOrder(oldCaseRevision);
    const newer = reviewedCaseOrder(
      newCaseRevision,
      "Current buyer reason shown in selected detail",
    );
    const previous = admin.getMockImplementation()!;
    let detailReads = 0;
    admin.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/commerce/alerts")
        return {
          ...alertsResponse,
          incidents: alertsResponse.incidents.map((incident) => ({
            ...incident,
            orderId: older.id,
          })),
        };
      if (path === "/commerce/orders/reviewed-order")
        return { order: ++detailReads === 1 ? older : newer };
      if (path === reviewedCasePath)
        throw new AdminApiError(409, "commerce_case_review_stale", "Fixture case changed");
      return previous(path, init);
    });
    await show();
    await click("异常监控");
    await click("定位订单 reviewed-order");
    expect(host.textContent).toContain("已按告警直接定位订单 reviewed-order");
    const original = button("核实售后已解决并关闭").closest("form")!;
    fill(original, { caseReason: "Old selected reason" });
    await submit(original);
    expect(detailReads).toBe(1);
    await click("刷新售后记录");
    expect(detailReads).toBe(2);
    expect(host.textContent).toContain("Current buyer reason shown in selected detail");
    expect(host.textContent).toContain("已按告警直接定位订单 reviewed-order");
    const fresh = button("核实售后已解决并关闭");
    expect(fresh.disabled).toBe(false);
    expect(caseReasonField(fresh.closest("form")!).value).toBe("");
    expect(admin.mock.calls.filter(([path]) => path === reviewedCasePath)).toHaveLength(1);
  });

  it("never carries an old close reason onto a newer case revision loaded by the normal refresh", async () => {
    orderRows = [reviewedCaseOrder(oldCaseRevision)];
    await show();
    await click("履约与售后");
    const oldForm = button("核实售后已解决并关闭").closest("form")!;
    fill(oldForm, { caseReason: "Reason reviewed against the old data" });
    const refundForm = button("提交测试退款").closest("form")!;
    fill(refundForm, { reason: "Unrelated refund draft is retained" });
    orderRows = [reviewedCaseOrder(newCaseRevision, "Concurrent supplier or buyer update")];
    await click("刷新");
    expect(host.textContent).toContain("Concurrent supplier or buyer update");
    expect((refundForm.elements.namedItem("reason") as HTMLInputElement).value).toBe(
      "Unrelated refund draft is retained",
    );
    const freshForm = button("核实售后已解决并关闭").closest("form")!;
    expect(caseReasonField(freshForm).value).toBe("");
    await submit(freshForm);
    expect(admin.mock.calls.filter(([path]) => path === reviewedCasePath)).toHaveLength(0);
  });

  it("shows the supplier's most recent issue beside the existing reviewed case control without moving funds", async () => {
    orderRows = [
      {
        id: "issue-order",
        status: "paid",
        paymentProvider: "simulation",
        totalCents: 1000,
        refundedCents: 0,
        items: [
          {
            id: "issue-item",
            sku: "STOCK-SKU",
            name: "Supply item",
            quantity: 1,
            lineCents: 1000,
            refundedCents: 0,
            status: "pending",
            openCase: true,
            caseRevision: oldCaseRevision,
            supplierIssue: {
              kind: "out_of_stock",
              reason: "Canadian warehouse unavailable",
              reportedAt: "2026-10-26T00:00:00Z",
            },
          },
        ],
      },
    ];
    await show();
    await click("履约与售后");
    expect(host.textContent).toContain("最近供应商报告（缺货）：Canadian warehouse unavailable");
    expect(host.textContent).toContain("不自动认定已解决，也不会自动退款");
    expect(button("核实售后已解决并关闭")).toBeTruthy();
    expect(admin.mock.calls.some(([, init]) => init?.method)).toBe(false);
    const caseForm = button("核实售后已解决并关闭").closest("form")!;
    fill(caseForm, { caseReason: "Reviewed historical support resolution" });
    await submit(caseForm);
    expect(admin).toHaveBeenCalledWith("/commerce/items/issue-item/case", {
      method: "POST",
      json: {
        reviewedClose: {
          revision: oldCaseRevision,
          reason: "Reviewed historical support resolution",
        },
      },
    });
    expect(admin.mock.calls.some(([path]) => String(path).endsWith("/refund"))).toBe(false);
  });
  it("does not pull the administrator back when a delayed alert lookup completes after tab navigation", async () => {
    const previous = admin.getMockImplementation()!;
    let finish!: (result: unknown) => void;
    const lookup = new Promise((resolve) => {
      finish = resolve;
    });
    admin.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/commerce/alerts") return alertsResponse;
      if (path === "/commerce/orders/historical-order") return lookup;
      return previous(path, init);
    });
    await show();
    await click("异常监控");
    await click("定位订单 historical-order");
    await click("商品与供应商");
    await act(async () => {
      finish({ order: { id: "historical-order", items: [] } });
    });
    expect(button("商品与供应商").getAttribute("aria-current")).toBe("page");
    expect(button("履约与售后").getAttribute("aria-current")).toBeNull();
    expect(host.textContent).not.toContain("已按告警直接定位订单");
    expect(admin.mock.calls.some(([, init]) => init?.method)).toBe(false);
  });
  it("hides a stale selected withdrawal after a successful approval whose detail refresh fails, until re-read", async () => {
    const previous = admin.getMockImplementation()!;
    let status = "requested",
      reads = 0;
    admin.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/commerce/alerts")
        return {
          ...alertsResponse,
          incidents: [
            {
              ...alertsResponse.incidents[0]!,
              kind: "withdrawal_requested",
              resourceType: "withdrawal",
              resourceId: "historical-withdrawal",
              orderId: null,
            },
          ],
        };
      if (path === "/commerce/withdrawals/historical-withdrawal") {
        if (++reads === 2) throw new TypeError("Read failed after the approval response");
        return {
          withdrawal: {
            id: "historical-withdrawal",
            userId: "historical-user",
            approvedBy: status === "approved" ? owner.id : null,
            amountCents: 2000,
            status,
            reference: null,
            createdAt: "2026-10-01T12:00:00Z",
          },
        };
      }
      if (path === "/commerce/withdrawals/historical-withdrawal/approve") {
        status = "approved";
        return { ok: true };
      }
      return previous(path, init);
    });
    await show();
    await click("异常监控");
    await click("定位提现 historical-withdrawal");
    await click("批准测试提现申请");
    expect(host.textContent).toContain("已定位提现刷新失败");
    expect(
      [...host.querySelectorAll("button")].some((node) => node.textContent === "批准测试提现申请"),
    ).toBe(false);
    expect(
      [...host.querySelectorAll("button")].some(
        (node) => node.textContent === "记录已核实测试付款",
      ),
    ).toBe(false);
    await click("刷新");
    expect(reads).toBe(3);
    expect(host.textContent).toContain("本笔由你审批");
    expect(host.textContent).not.toContain("记录已核实测试付款");
    expect(
      admin.mock.calls.filter(
        ([path, init]) =>
          path === "/commerce/withdrawals/historical-withdrawal/approve" && init?.method === "POST",
      ),
    ).toHaveLength(1);
  });
  it("renders historical buyer support and handling context while requiring an explicit new case reason", async () => {
    orderRows = [
      {
        id: "support-order",
        status: "paid",
        paymentProvider: "simulation",
        totalCents: 10000,
        refundedCents: 0,
        attentionReasons: [],
        items: [
          {
            id: "support-item",
            sku: "SUPPORT-SKU",
            name: "Support item",
            lineCents: 10000,
            quantity: 1,
            refundedCents: 0,
            status: "delivered",
            openCase: false,
            returnRequest: {
              reason: "Buyer packaging request",
              requestedAt: "2026-10-25T12:00:00Z",
            },
            caseHandling: {
              open: false,
              reason: null,
              handledBy: "historical-admin",
              handledAt: "2026-10-26T12:00:00Z",
            },
          },
        ],
      },
    ];
    await show();
    await click("履约与售后");
    expect(host.textContent).toContain("Buyer packaging request");
    expect(host.textContent).toContain("历史记录，不代表当前未结案");
    expect(host.textContent).toContain("历史处理未记录说明");
    expect(host.textContent).toContain("historical-admin");
    expect(host.textContent).toContain("无未结售后");
    const form = button("标记售后处理中").closest("form")!;
    expect(form).not.toBeNull();
    for (const reason of ["   ", "x".repeat(501)]) {
      fill(form, { caseReason: reason });
      await submit(form);
      expect(admin.mock.calls.some(([path]) => path === "/commerce/items/support-item/case")).toBe(
        false,
      );
    }
    fill(form, { caseReason: "  Reviewed new support follow-up  " });
    await submit(form);
    expect(admin).toHaveBeenCalledWith("/commerce/items/support-item/case", {
      method: "POST",
      json: { open: true, reason: "Reviewed new support follow-up" },
    });
  });

  it("locates an order absent from the paginated list and re-reads the selected order after the original support action", async () => {
    const previous = admin.getMockImplementation()!;
    let openCase = true;
    admin.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/commerce/alerts") return alertsResponse;
      if (path === "/commerce/orders/historical-order")
        return {
          order: {
            id: "historical-order",
            paymentProvider: "simulation",
            status: "paid",
            totalCents: 10000,
            refundedCents: 0,
            attentionReasons: openCase ? ["open_case"] : [],
            items: [
              {
                id: "historical-item",
                sku: "HISTORICAL-SKU",
                name: "Historical item",
                quantity: 1,
                lineCents: 10000,
                refundedCents: 0,
                status: "delivered",
                trackingNumber: null,
                openCase,
                caseRevision: oldCaseRevision,
              },
            ],
          },
        };
      if (path === "/commerce/items/historical-item/case") {
        openCase = false;
        return { ok: true };
      }
      return previous(path, init);
    });
    await show();
    await click("异常监控");
    await click("定位订单 historical-order");
    expect(admin).toHaveBeenCalledWith("/commerce/orders/historical-order");
    expect(host.textContent).toContain("已按告警直接定位订单 historical-order");
    expect(host.textContent).toContain("HISTORICAL-SKU");
    expect(host.textContent).toContain("部分或全额退款不等于退货或售后结案");
    expect(orderRows).toEqual([]);
    const caseForm = button("核实售后已解决并关闭").closest("form")!;
    fill(caseForm, { caseReason: "Reviewed historical order resolution" });
    await submit(caseForm);
    expect(
      admin.mock.calls.filter(([path]) => path === "/commerce/orders/historical-order"),
    ).toHaveLength(2);
    expect(host.textContent).toContain("无未结售后");
    expect(host.textContent).not.toContain("存在未结售后，佣金释放已阻止");
    await click("返回订单列表");
    expect(host.textContent).toContain("暂无测试订单。");
    expect(host.textContent).not.toContain("HISTORICAL-SKU");
  });
  it("locates a historical withdrawal separately from pagination and refreshes its original approval panel", async () => {
    const previous = admin.getMockImplementation()!;
    let status = "requested";
    admin.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/commerce/alerts")
        return {
          ...alertsResponse,
          incidents: [
            {
              ...alertsResponse.incidents[0]!,
              kind: "withdrawal_requested",
              resourceType: "withdrawal",
              resourceId: "historical-withdrawal",
              orderId: null,
            },
          ],
        };
      if (path === "/commerce/withdrawals/historical-withdrawal")
        return {
          withdrawal: {
            id: "historical-withdrawal",
            userId: "historical-user",
            approvedBy: status === "approved" ? owner.id : null,
            amountCents: 2000,
            status,
            reference: null,
            createdAt: "2026-10-01T12:00:00Z",
          },
        };
      if (path === "/commerce/withdrawals/historical-withdrawal/approve") {
        status = "approved";
        return { ok: true };
      }
      return previous(path, init);
    });
    await show();
    await click("异常监控");
    await click("定位提现 historical-withdrawal");
    expect(host.textContent).toContain("已按告警直接定位提现 historical-withdrawal");
    expect(withdrawalRows).toEqual([]);
    await click("批准测试提现申请");
    expect(
      admin.mock.calls.filter(([path]) => path === "/commerce/withdrawals/historical-withdrawal"),
    ).toHaveLength(2);
    expect(host.textContent).toContain("本笔由你审批");
    expect(host.textContent).not.toContain("记录已核实测试付款");
    expect(
      [...host.querySelectorAll("button")].some((node) => node.textContent === "批准测试提现申请"),
    ).toBe(false);
    await click("返回提现列表");
    expect(host.textContent).toContain("暂无提现申请。");
  });
  it("reads the same supplier test statement, preserves its microsecond boundary and does not create a settlement action", async () => {
    const previous = admin.getMockImplementation()!;
    admin.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.startsWith("/commerce/suppliers/supplier-1/statement")) {
        const query = new URL(path, "http://test").searchParams;
        return {
          ...supplierStatement,
          page: Number(query.get("page") ?? 0),
          hasMore: !query.get("page"),
        };
      }
      return previous(path, init);
    });
    await show();
    await click("佣金与提现");
    expect(host.textContent).toContain("尚未读取应付金额");
    await click("查询供货应付对账单");
    expect(admin).toHaveBeenCalledWith("/commerce/suppliers/supplier-1/statement");
    expect(host.textContent).toContain("期末应付 CAD 34.00");
    expect(host.textContent).toContain("退款应付冲回");
    expect(host.textContent).toContain("CAD -15.00");
    expect(host.textContent).toContain("HISTORICAL-SKU");
    expect(host.textContent).toContain("不是到期可付款金额");
    expect(host.textContent).toContain("仍有退款结果或商品归属待核实");
    await click("下一页对账单");
    const url = new URL(String(admin.mock.calls.at(-1)![0]), "http://test");
    expect(url.searchParams.get("to")).toBe(supplierStatement.period.to);
    expect(url.searchParams.get("page")).toBe("1");
    expect(host.textContent).toContain("第 2 页 · 共 101 条分录");
    expect(admin.mock.calls.some(([, init]) => init?.method)).toBe(false);
  });
  it("does not present zero or previous supplier amounts when a statement query fails", async () => {
    const previous = admin.getMockImplementation()!;
    let requested = 0;
    admin.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.startsWith("/commerce/suppliers/supplier-1/statement")) {
        if (requested++) throw new TypeError("Offline");
        return supplierStatement;
      }
      return previous(path, init);
    });
    await show();
    await click("佣金与提现");
    await click("查询供货应付对账单");
    await click("下一页对账单");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("不能据此判断应付为零");
    expect(host.textContent).not.toContain("期末应付 CAD 34.00");
    expect(host.textContent).not.toContain("当前查询范围没有应付流水。");
  });
  it("queries all attention reasons on the server and retains original processing forms and independent pages", async () => {
    prepareExternalOrder();
    paginate = true;
    const previous = admin.getMockImplementation()!;
    admin.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/commerce/orders?attention=needs_attention")
        return {
          orders: orderRows.map((order) =>
            Object.assign({}, order, {
              attentionReasons: [
                "open_case",
                "payment_unresolved",
                "payment_review",
                "refund_unresolved",
                "external_refund_unresolved",
              ],
            }),
          ),
          hasMore: true,
        };
      return previous(path, init);
    });
    await show();
    await click("履约与售后");
    await click("下一页订单");
    await click("佣金与提现");
    await click("下一页提现");
    await click("下一页流水");
    await click("履约与售后");
    await select("订单待处理筛选", "needs_attention");
    expect(admin).toHaveBeenCalledWith("/commerce/orders?attention=needs_attention");
    expect(admin).toHaveBeenLastCalledWith("/commerce/ledger?page=1");
    expect(admin.mock.calls.at(-2)?.[0]).toBe("/commerce/withdrawals?page=1");
    expect(host.textContent).toContain("付款创建中或结果待确认");
    expect(host.textContent).toContain("付款异常，需人工核实");
    expect(host.textContent).toContain("外部退款归属或渠道结果待核实");
    expect(button("上一页订单").disabled).toBe(true);
    expect(button("核实售后已解决并关闭").disabled).toBe(false);
    await click("查询渠道测试状态");
    expect(admin).toHaveBeenCalledWith("/commerce/orders/stripe-order-1/payment");
    await click("下一页订单");
    expect(admin).toHaveBeenCalledWith("/commerce/orders?page=1&attention=needs_attention");
  });
  it("filters requested and approved withdrawals on the server and reuses approval and record forms", async () => {
    paginate = true;
    const previous = admin.getMockImplementation()!;
    admin.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.includes("/commerce/withdrawals?") && path.includes("status="))
        return {
          withdrawals: [
            {
              id: path.includes("status=requested")
                ? "filtered-payout"
                : "independent-filtered-payout",
              userId: "user-1",
              approvedBy: path.includes("status=requested") ? null : "independent-test-approver",
              amountCents: 2500,
              status: path.includes("status=requested") ? "requested" : "approved",
              reference: null,
              createdAt: "2026-10-26T00:00:00Z",
            },
          ],
          hasMore: true,
        };
      return previous(path, init);
    });
    await show();
    await click("佣金与提现");
    await click("下一页提现");
    await select("提现待处理筛选", "requested");
    expect(admin).toHaveBeenCalledWith("/commerce/withdrawals?status=requested");
    expect(button("上一页提现").disabled).toBe(true);
    await click("批准测试提现申请");
    expect(admin).toHaveBeenCalledWith("/commerce/withdrawals/filtered-payout/approve", {
      method: "POST",
      json: {},
    });
    await click("下一页提现");
    expect(admin).toHaveBeenCalledWith("/commerce/withdrawals?page=1&status=requested");
    await select("提现待处理筛选", "approved");
    expect(admin).toHaveBeenCalledWith("/commerce/withdrawals?status=approved");
    expect(button("上一页提现").disabled).toBe(true);
    const form = button("记录已核实测试付款").closest("form")!;
    fill(form, { reference: "TEST-ONLY-REF", reason: "Verified test record" });
    await submit(form);
    expect(admin).toHaveBeenCalledWith("/commerce/withdrawals/independent-filtered-payout/record", {
      method: "POST",
      json: { reference: "TEST-ONLY-REF", reason: "Verified test record" },
    });
  });
  it("does not claim an empty attention queue when its server query fails", async () => {
    const previous = admin.getMockImplementation()!;
    admin.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.includes("attention=needs_attention") || path.includes("status=requested"))
        throw new TypeError("Offline");
      return previous(path, init);
    });
    await show();
    await click("履约与售后");
    await select("订单待处理筛选", "needs_attention");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("暂时无法连接");
    expect(host.textContent).not.toContain("当前筛选没有待处理订单。");
    expect(host.textContent).not.toContain("暂无测试订单。");
    expect(
      host.querySelector<HTMLSelectElement>('select[aria-label="订单待处理筛选"]')!.value,
    ).toBe("all");
    await click("佣金与提现");
    await select("提现待处理筛选", "requested");
    expect(host.textContent).not.toContain("当前筛选没有提现记录。");
    expect(host.textContent).not.toContain("暂无提现申请。");
  });
  it("parses allocation CAD exactly and rejects ambiguous numeric formats", () => {
    expect(parseAllocationCents("0.29")).toBe(29);
    expect(parseAllocationCents("12.00")).toBe(1200);
    expect(parseAllocationCents("")).toBe(0);
    for (const raw of ["0.005", "1e2", "-1", "Infinity", "01.00"])
      expect(parseAllocationCents(raw)).toBeNull();
  });
  it("shows external refund amounts and same-name SKUs, and only posts a full balanced allocation without another refund", async () => {
    const form = await openExternalDetail();
    expect(host.textContent).toContain("re_TEST_EXTERNAL");
    expect(host.textContent).toContain("CAD 12.00");
    expect(form.textContent).toContain("RED-SKU");
    expect(form.textContent).toContain("BLUE-SKU");
    await change(form, "red-item", "5.00");
    await change(form, "blue-item", "6.00");
    await change(form, "reason", "Verified test statement and both item lines");
    await act(async () => form.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(button("确认登记已有退款归属（不再次退款）").disabled).toBe(true);
    expect(form.textContent).toContain("还差 CAD 1.00");
    await change(form, "blue-item", "7.00");
    expect(button("确认登记已有退款归属（不再次退款）").disabled).toBe(false);
    await submit(form);
    expect(admin).toHaveBeenCalledWith("/commerce/external-refunds/external-1/allocate", {
      method: "POST",
      json: {
        expectedVersion: 3,
        allocations: [
          { itemId: "red-item", amountCents: 500 },
          { itemId: "blue-item", amountCents: 700 },
        ],
        reason: "Verified test statement and both item lines",
        idempotencyKey: expect.any(String),
      },
    });
    expect(host.textContent).toContain("已有渠道退款的商品归属已登记，未再次发起退款。");
    expect(host.textContent).toContain("仍有其他待核实事项");
    expect(host.textContent).toContain("售后仍需按原流程另行核实关闭");
    expect(
      admin.mock.calls.some(
        ([path]) =>
          String(path).endsWith("/provider-refunds") ||
          String(path).endsWith("/refund") ||
          String(path).endsWith("/case"),
      ),
    ).toBe(false);
  });
  it("reuses the exact allocation key after an unknown response and keeps the draft locked", async () => {
    const form = await openExternalDetail();
    loseExternalResponse = 1;
    await change(form, "red-item", "5.00");
    await change(form, "blue-item", "7.00");
    await change(form, "reason", "Same verified allocation");
    await act(async () => form.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await submit(form);
    expect(host.textContent).toContain("核销请求结果暂未确认");
    expect((form.elements.namedItem("red-item") as HTMLInputElement).disabled).toBe(true);
    await submit(form);
    const calls = admin.mock.calls.filter(
      ([path]) => path === "/commerce/external-refunds/external-1/allocate",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[1].json).toEqual(calls[1]?.[1].json);
  });
  it("requires a fresh detail review after a version conflict instead of silently resubmitting", async () => {
    const form = await openExternalDetail();
    staleExternalResponse = true;
    await change(form, "red-item", "5.00");
    await change(form, "blue-item", "7.00");
    await change(form, "reason", "Review current snapshot");
    await act(async () => form.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await submit(form);
    expect(host.textContent).toContain("退款或异常记录在核实时发生变化");
    await click("刷新退款归属详情");
    expect(host.textContent).toContain("记录版本 4");
    expect(button("确认登记已有退款归属（不再次退款）").disabled).toBe(true);
    expect(admin.mock.calls.filter(([path]) => String(path).endsWith("/allocate"))).toHaveLength(1);
  });
  it("keeps unknown or disabled external refunds read-only and can page through server records", async () => {
    paginate = true;
    externalDetail = {
      ...externalDetail,
      enabled: false,
      canAllocate: false,
      refund: { ...externalDetail.refund, providerStatus: "unknown" },
    };
    externalRows = [externalDetail.refund];
    const form = await openExternalDetail();
    expect(button("确认登记已有退款归属（不再次退款）").disabled).toBe(true);
    expect((form.elements.namedItem("red-item") as HTMLInputElement).disabled).toBe(true);
    expect(host.textContent).toContain("渠道结果未知");
    await click("下一页外部退款");
    expect(admin).toHaveBeenCalledWith("/commerce/orders/stripe-order-1/external-refunds?page=1");
    expect(admin.mock.calls.some(([path]) => String(path).endsWith("/allocate"))).toBe(false);
  });
  it("observes only a previously verified event reference and never accepts a manually entered refund amount", async () => {
    prepareExternalOrder();
    await show();
    await click("履约与售后");
    await click("查询外部退款记录");
    host.querySelector("details")!.open = true;
    const form = button("从渠道核实并登记已有事件").closest("form")!;
    fill(form, {
      sourceEventId: "evt_VERIFIED_EXISTING",
      reason: "Review an already verified historical event",
    });
    await submit(form);
    expect(admin).toHaveBeenCalledWith("/commerce/external-refunds/observe", {
      method: "POST",
      json: {
        sourceEventId: "evt_VERIFIED_EXISTING",
        reason: "Review an already verified historical event",
      },
    });
    expect(form.elements.namedItem("amountCents")).toBeNull();
    expect(form.elements.namedItem("providerRefundId")).toBeNull();
  });

  it("keeps historical channel status readable but disables refund and reconcile without server capability", async () => {
    stripePayment = { ...paidStripe, enabled: false };
    orderRows = [
      {
        id: "stripe-order-1",
        paymentProvider: "stripe_test",
        status: "paid",
        totalCents: 3900,
        refundedCents: 0,
        items: [
          {
            id: "stripe-item-1",
            name: "Stripe Test Product",
            quantity: 1,
            lineCents: 3900,
            refundedCents: 0,
            status: "delivered",
            trackingNumber: null,
            openCase: true,
          },
        ],
      },
    ];
    await show();
    await click("履约与售后");
    await click("查询渠道测试状态");
    expect(button("提交 Stripe 测试退款请求").disabled).toBe(true);
    expect(button("核实并同步渠道测试结果").disabled).toBe(true);
    expect(button("查询渠道测试状态").disabled).toBe(false);
    expect(host.textContent).toContain("渠道测试配置未启用，只读历史状态");
    expect(
      admin.mock.calls.some(
        ([path]) =>
          String(path).endsWith("/provider-refunds") || String(path).endsWith("/reconcile"),
      ),
    ).toBe(false);
  });
  it("routes Stripe test refunds separately and blocks repeats while the channel outcome is unknown", async () => {
    orderRows = [
      {
        id: "stripe-order-1",
        paymentProvider: "stripe_test",
        userId: "buyer-1",
        status: "paid",
        totalCents: 3900,
        refundedCents: 0,
        items: [
          {
            id: "stripe-item-1",
            name: "Stripe Test Product",
            quantity: 1,
            lineCents: 3900,
            refundedCents: 0,
            status: "delivered",
            trackingNumber: "TEST-TRACK",
            openCase: true,
          },
        ],
      },
    ];
    await show();
    await click("履约与售后");
    expect(button("提交 Stripe 测试退款请求").disabled).toBe(true);
    await click("查询渠道测试状态");
    expect(button("提交 Stripe 测试退款请求").disabled).toBe(false);
    const form = button("提交 Stripe 测试退款请求").closest("form")!;
    fill(form, { refundTotalCents: "1200", reason: "Test provider partial refund" });
    await submit(form);
    expect(admin).toHaveBeenCalledWith("/commerce/items/stripe-item-1/provider-refunds", {
      method: "POST",
      json: {
        refundTotalCents: 1200,
        reason: "Test provider partial refund",
        idempotencyKey: expect.any(String),
      },
    });
    expect(admin.mock.calls.some(([path]) => path === "/commerce/items/stripe-item-1/refund")).toBe(
      false,
    );
    expect(button("提交 Stripe 测试退款请求").disabled).toBe(true);
    expect(host.textContent).toContain("结果未知，禁止直接重付");
    expect(host.textContent).toContain("处理中或未知不代表退款成功");
    stripePayment = {
      ...stripePayment,
      refunds: stripePayment.refunds.map((refund) =>
        Object.assign({}, refund, { status: "succeeded" as const }),
      ),
    };
    const reconcile = button("核实并同步渠道测试结果").closest("form")!;
    fill(reconcile, { reason: "Verified Stripe TEST result" });
    await submit(reconcile);
    expect(admin).toHaveBeenCalledWith("/commerce/orders/stripe-order-1/payment/reconcile", {
      method: "POST",
      json: { reason: "Verified Stripe TEST result" },
    });
    expect(host.textContent).toContain("渠道测试退款已确认");
  });
  it("can page through catalog, historical orders, withdrawals and ledger without silently truncating", async () => {
    paginate = true;
    await show();
    await click("下一页商品");
    expect(admin).toHaveBeenCalledWith("/commerce/catalog?page=1");
    await click("履约与售后");
    await click("下一页订单");
    expect(admin).toHaveBeenCalledWith("/commerce/orders?page=1");
    await click("佣金与提现");
    await click("下一页提现");
    expect(admin).toHaveBeenCalledWith("/commerce/withdrawals?page=1");
    await click("下一页流水");
    expect(admin).toHaveBeenCalledWith("/commerce/ledger?page=1");
    expect(button("下一页流水").disabled).toBe(true);
    expect(button("上一页流水").disabled).toBe(false);
  });
  it("sends draft product prices in integer cents and leaves publication for a separate audit action", async () => {
    await show();
    const form = button("创建草稿").closest("form")!;
    fill(form, {
      supplierId: "supplier-1",
      sku: "NEW-SKU",
      name: "New Product",
      category: "Home",
      imageUrl: "https://cdn.example.invalid/new.png",
      description: "New test item",
      priceCents: "2900",
      costCents: "900",
      commissionBps: "1000",
      returnDays: "30",
      stock: "15",
      reason: "Test draft review",
    });
    await submit(form);
    expect(admin).toHaveBeenCalledWith("/commerce/catalog", {
      method: "POST",
      json: expect.objectContaining({
        supplierId: "supplier-1",
        priceCents: 2900,
        costCents: 900,
        commissionBps: 1000,
        returnDays: 30,
        stock: 15,
        reason: "Test draft review",
      }),
    });
    expect(host.textContent).toContain("商品草稿已创建，审核上架前不会出现在买家商城。");
    expect(admin.mock.calls.some(([path]) => String(path).includes("test-pay"))).toBe(false);
  });
  it("locks the creation intent and warns against losing its key while the first response is pending", async () => {
    const base = admin.getMockImplementation()!;
    admin.mockImplementation((path: string, init?: { method?: string }) =>
      path === "/commerce/suppliers" && init?.method === "POST"
        ? new Promise(() => {})
        : base(path, init),
    );
    await show();
    const form = button("创建供应商").closest("form")!;
    fill(form, {
      name: "Pending Supplier",
      returnAddress: "Canada",
      reason: "Approved pending vendor",
    });
    await submit(form);
    expect(form.querySelector<HTMLInputElement>('input[name="name"]')!.disabled).toBe(true);
    expect(host.textContent).toContain("离开/刷新会丢失当前重试凭据");
    await submit(form);
    expect(
      admin.mock.calls.filter(
        ([path, init]) => path === "/commerce/suppliers" && init?.method === "POST",
      ),
    ).toHaveLength(1);
  });
  it("keeps a successful supplier creation read-only after its confirmation refresh fails", async () => {
    const base = admin.getMockImplementation()!;
    const created = {
      id: "new-supplier-1",
      name: "New Supplier",
      returnAddress: "Canada Road",
      active: true,
    };
    let posted = false,
      loseRead = true;
    admin.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/commerce/suppliers" && init?.method === "POST") {
        posted = true;
        return { supplier: created };
      }
      if (path === "/commerce/suppliers" && posted) {
        if (loseRead) {
          loseRead = false;
          throw new TypeError("Confirmation response lost");
        }
        return { suppliers: [created] };
      }
      return base(path, init);
    });
    await show();
    const form = button("创建供应商").closest("form")!;
    fill(form, {
      name: "  New Supplier ",
      returnAddress: " Canada Road  ",
      reason: "  Reviewed new vendor ",
    });
    await submit(form);
    expect(host.textContent).toContain("创建请求已确认，最新供应商列表尚未完成只读核对");
    expect(button("创建供应商").disabled).toBe(true);
    fill(form, { name: "Changed name" });
    await submit(form);
    expect(
      admin.mock.calls.filter(
        ([path, init]) => path === "/commerce/suppliers" && init?.method === "POST",
      ),
    ).toHaveLength(1);
    await click("核对已创建供应商");
    expect(host.textContent).toContain("供应商创建及只读核对已完成");
    expect(
      admin.mock.calls.filter(
        ([path, init]) => path === "/commerce/suppliers" && init?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(button("开始下一次创建").disabled).toBe(false);
  });
  it("retries a lost supplier creation response with the original key and payload despite form changes", async () => {
    const base = admin.getMockImplementation()!;
    const created = {
      id: "new-supplier-2",
      name: "Original Supplier",
      returnAddress: "Canada Road",
      active: true,
    };
    const commands: unknown[] = [];
    let loseResponse = true;
    admin.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
      if (path === "/commerce/suppliers" && init?.method === "POST") {
        commands.push(init.json);
        if (loseResponse) {
          loseResponse = false;
          throw new TypeError("POST result unknown");
        }
        return { supplier: created };
      }
      if (path === "/commerce/suppliers" && commands.length) return { suppliers: [created] };
      return base(path, init);
    });
    await show();
    const form = button("创建供应商").closest("form")!;
    fill(form, {
      name: " Original Supplier ",
      returnAddress: " Canada Road ",
      reason: " Reviewed original vendor ",
    });
    await submit(form);
    expect(host.textContent).toContain("创建结果尚未确认");
    expect(host.textContent).toContain("离开/刷新会丢失当前重试凭据");
    fill(form, {
      name: "Changed Supplier",
      returnAddress: "Changed Address",
      reason: "Changed reason",
    });
    await submit(form);
    expect(commands).toHaveLength(1);
    await click("重试同一次创建");
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual(commands[0]);
    expect(commands[0]).toEqual({
      name: "Original Supplier",
      returnAddress: "Canada Road",
      reason: "Reviewed original vendor",
      idempotencyKey: expect.any(String),
    });
    expect(host.textContent).toContain("供应商创建及只读核对已完成");
  });
  it("starts another supplier creation only after an explicit new intention following server confirmation", async () => {
    const base = admin.getMockImplementation()!;
    const rows: { id: string; name: string; returnAddress: string; active: boolean }[] = [];
    const keys: string[] = [];
    admin.mockImplementation(
      async (path: string, init?: { method?: string; json?: Record<string, string> }) => {
        if (path === "/commerce/suppliers" && init?.method === "POST") {
          keys.push(init.json!.idempotencyKey!);
          const supplier = {
            id: `created-${rows.length}`,
            name: init.json!.name!,
            returnAddress: init.json!.returnAddress!,
            active: true,
          };
          rows.push(supplier);
          return { supplier };
        }
        if (path === "/commerce/suppliers" && rows.length) return { suppliers: rows };
        return base(path, init);
      },
    );
    await show();
    let form = button("创建供应商").closest("form")!;
    fill(form, { name: "Supplier One", returnAddress: "Canada", reason: "First approved vendor" });
    await submit(form);
    await submit(form);
    expect(rows).toHaveLength(1);
    await click("开始下一次创建");
    form = button("创建供应商").closest("form")!;
    expect(form.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe("");
    fill(form, { name: "Supplier Two", returnAddress: "Canada", reason: "Second approved vendor" });
    await submit(form);
    expect(rows).toHaveLength(2);
    expect(keys[1]).not.toBe(keys[0]);
  });
  it("does not unlock a new creation until the confirmed supplier ID is found by a read-only query", async () => {
    const base = admin.getMockImplementation()!;
    admin.mockImplementation(async (path: string, init?: { method?: string }) =>
      path === "/commerce/suppliers" && init?.method === "POST"
        ? {
            supplier: {
              id: "not-yet-visible",
              name: "New Supplier",
              returnAddress: "Canada",
              active: false,
            },
          }
        : base(path, init),
    );
    await show();
    const form = button("创建供应商").closest("form")!;
    fill(form, { name: "New Supplier", returnAddress: "Canada", reason: "Verified new vendor" });
    await submit(form);
    expect(host.textContent).toContain("当前列表尚未查到已确认的供应商 ID");
    expect(host.textContent).not.toContain("开始下一次创建");
    await click("核对已创建供应商");
    expect(
      admin.mock.calls.filter(
        ([path, init]) => path === "/commerce/suppliers" && init?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(button("创建供应商").disabled).toBe(true);
  });
  it("keeps catalog approval explicit and sends the operator reason", async () => {
    await show();
    const form = button("保存").closest("form")!;
    fill(form, { status: "published", reason: "Image, cost and stock reviewed" });
    await submit(form);
    expect(admin).toHaveBeenCalledWith("/commerce/catalog/product-1", {
      method: "PATCH",
      json: { status: "published", reason: "Image, cost and stock reviewed" },
    });
  });
  it("uses cumulative partial-refund amounts with a stable retry key and can resolve aftersales", async () => {
    orderRows = [
      {
        id: "order-1",
        userId: "buyer-1",
        status: "paid",
        totalCents: 3900,
        refundedCents: 0,
        items: [
          {
            id: "item-1",
            name: "Test Product",
            quantity: 1,
            lineCents: 3900,
            refundedCents: 0,
            status: "shipped",
            trackingNumber: "TEST-TRACK",
            openCase: true,
            caseRevision: oldCaseRevision,
          },
        ],
      },
    ];
    await show();
    await click("履约与售后");
    const form = button("提交测试退款").closest("form")!;
    fill(form, { refundTotalCents: "1200", reason: "Test partial return" });
    await submit(form);
    await submit(form);
    const calls = admin.mock.calls.filter(([path]) => path === "/commerce/items/item-1/refund");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[1]).toMatchObject({
      method: "POST",
      json: {
        refundTotalCents: 1200,
        reason: "Test partial return",
        idempotencyKey: expect.any(String),
      },
    });
    expect(calls[0]?.[1].json.idempotencyKey).toBe(calls[1]?.[1].json.idempotencyKey);
    const caseForm = button("核实售后已解决并关闭").closest("form")!;
    fill(caseForm, { caseReason: "Reviewed support after the financial refund" });
    await submit(caseForm);
    expect(admin).toHaveBeenCalledWith("/commerce/items/item-1/case", {
      method: "POST",
      json: {
        reviewedClose: {
          revision: oldCaseRevision,
          reason: "Reviewed support after the financial refund",
        },
      },
    });
  });
  it("offers a TEST payment-start registration only after approval", async () => {
    withdrawalRows = [
      {
        id: "approved-start",
        userId: "buyer-start",
        approvedBy: "independent-test-approver",
        amountCents: 2500,
        status: "approved",
        reference: null,
        createdAt: "2026-10-01T12:00:00Z",
        paymentOperationId: null,
        paymentStartedBy: null,
        paymentStartedAt: null,
        paymentUnknownAt: null,
      },
    ];
    await show();
    await click("佣金与提现");
    expect(button("登记开始人工测试付款")).toBeTruthy();
    expect(host.textContent).toContain("仅登记人工操作，不连接银行或发送真实付款请求");
    expect(admin.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it.each(["payment_pending", "payment_unknown"] as const)(
    "registers independently reviewed TEST success for the original %s operation only",
    async (status) => {
      let row = manualWithdrawal(status);
      withdrawalRows = [row];
      const base = admin.getMockImplementation()!;
      admin.mockImplementation(async (path, init) => {
        if (path === "/commerce/withdrawals/confirm-manual/confirm-payment-success") {
          row = {
            ...row,
            status: "paid_test",
            reference: init.json.reference,
            paymentEvidenceReference: init.json.evidenceReference,
            paymentConfirmationReason: init.json.reason,
            paymentConfirmedAt: "2026-10-03T12:00:00Z",
            paymentConfirmedBy: "independent-reviewer",
          };
          return { withdrawal: row };
        }
        if (path === "/commerce/withdrawals/confirm-manual") return { withdrawal: row };
        return base(path, init);
      });
      await show();
      await click("佣金与提现");
      const form = button("登记已核验的 TEST 付款成功结果").closest("form")!;
      expect(form.textContent).toContain(row.paymentOperationId);
      expect(form.textContent).toContain("CAD 25.00");
      expect(form.textContent).toContain("不发起转账、不自动核验银行、不代表真实到账");
      fillManualSuccess(form);
      await submit(form);
      expect(admin).toHaveBeenCalledWith(
        "/commerce/withdrawals/confirm-manual/confirm-payment-success",
        {
          method: "POST",
          json: {
            operationId: row.paymentOperationId,
            amountCents: 2500,
            currency: "CAD",
            reference: "TEST-MANUAL-RESULT",
            evidenceReference: "TEST-REVIEW-001",
            reason: "Independently reviewed TEST evidence",
          },
        },
      );
      expect(host.textContent).toContain("paid_test");
      expect(host.textContent).toContain("independent-reviewer");
      expect(host.textContent).toContain("TEST-REVIEW-001");
      expect(host.textContent).not.toContain("登记已核验的 TEST 付款成功结果");
      expect(host.textContent).not.toContain("标记测试付款结果未知");
      expect(host.textContent).not.toContain("驳回并解冻");
    },
  );
  it.each(["approved", "paid_test", "rejected", "requested"] as const)(
    "does not offer success registration for %s or an absent original operation",
    async (status) => {
      withdrawalRows = [
        manualWithdrawal(status),
        { ...manualWithdrawal(), id: "no-operation", paymentOperationId: null },
      ];
      await show();
      await click("佣金与提现");
      expect(host.textContent).not.toContain("登记已核验的 TEST 付款成功结果");
    },
  );
  it("requires explicit acknowledgement and nonblank bounded TEST result evidence before posting", async () => {
    withdrawalRows = [manualWithdrawal()];
    await show();
    await click("佣金与提现");
    const form = button("登记已核验的 TEST 付款成功结果").closest("form")!;
    fill(form, manualSuccessFields);
    await submit(form);
    expect(host.textContent).toContain("请确认已独立核验 TEST 结果");
    for (const [name, value] of [
      ["reference", "   "],
      ["reference", "x".repeat(151)],
      ["evidenceReference", "   "],
      ["evidenceReference", "x".repeat(501)],
      ["reason", "   "],
      ["reason", "x".repeat(501)],
    ]) {
      fillManualSuccess(form);
      fill(form, { [name!]: value! });
      await submit(form);
    }
    expect(admin.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it.each([false, true])(
    "retains the exact success payload after a lost response and queries first (already committed: %s)",
    async (committed) => {
      let row = manualWithdrawal("payment_unknown");
      withdrawalRows = [row];
      const base = admin.getMockImplementation()!;
      let posts = 0;
      admin.mockImplementation(async (path, init) => {
        if (path === "/commerce/withdrawals/confirm-manual/confirm-payment-success") {
          posts++;
          if (committed || posts > 1)
            row = {
              ...row,
              status: "paid_test",
              reference: init.json.reference,
              paymentEvidenceReference: init.json.evidenceReference,
              paymentConfirmationReason: init.json.reason,
              paymentConfirmedAt: "2026-10-03T12:00:00Z",
              paymentConfirmedBy: "independent-reviewer",
            };
          if (posts === 1) throw new TypeError("Lost TEST registration response");
          return { withdrawal: row };
        }
        if (path === "/commerce/withdrawals/confirm-manual") return { withdrawal: row };
        return base(path, init);
      });
      await show();
      await click("佣金与提现");
      const form = button("登记已核验的 TEST 付款成功结果").closest("form")!;
      fillManualSuccess(form);
      await submit(form);
      expect(host.textContent).toContain("成功结果登记尚未确认");
      expect(host.querySelector('input[name="evidenceReference"]')).toBeNull();
      expect(host.textContent).not.toContain("标记测试付款结果未知");
      await click("只读查询原 TEST 付款结果");
      if (!committed) await click("按原完整请求重试 TEST 成功登记");
      const calls = admin.mock.calls.filter(([path]) => path.endsWith("/confirm-payment-success"));
      expect(calls).toHaveLength(committed ? 1 : 2);
      if (!committed) expect(calls[1]![1].json).toEqual(calls[0]![1].json);
      expect(calls[0]![1].json.operationId).toBe(row.paymentOperationId);
      expect(host.textContent).toContain("paid_test");
      expect(host.textContent).not.toContain("按原完整请求重试 TEST 成功登记");
      expect(
        admin.mock.calls.some(([path]) =>
          /\/(record|reject|start-payment|mark-payment-unknown)$/.test(path),
        ),
      ).toBe(false);
    },
  );
  it("never resubmits confirmed TEST success when the follow-up read failed", async () => {
    let row = manualWithdrawal();
    withdrawalRows = [row];
    const base = admin.getMockImplementation()!;
    let readFailed = true;
    admin.mockImplementation(async (path, init) => {
      if (path === "/commerce/withdrawals/confirm-manual/confirm-payment-success") {
        row = {
          ...row,
          status: "paid_test",
          reference: init.json.reference,
          paymentEvidenceReference: init.json.evidenceReference,
          paymentConfirmationReason: init.json.reason,
          paymentConfirmedAt: "2026-10-03T12:00:00Z",
          paymentConfirmedBy: "independent-reviewer",
        };
        return { withdrawal: row };
      }
      if (path === "/commerce/withdrawals/confirm-manual") {
        if (readFailed) throw new TypeError("Read unavailable");
        return { withdrawal: row };
      }
      return base(path, init);
    });
    await show();
    await click("佣金与提现");
    const form = button("登记已核验的 TEST 付款成功结果").closest("form")!;
    fillManualSuccess(form);
    await submit(form);
    expect(host.textContent).toContain("成功登记已由服务器确认，但只读核对失败");
    expect(host.textContent).toContain("paid_test");
    expect(host.textContent).not.toContain("按原完整请求重试 TEST 成功登记");
    readFailed = false;
    await click("只读查询原 TEST 付款结果");
    expect(
      admin.mock.calls.filter(([path]) => path.endsWith("/confirm-payment-success")),
    ).toHaveLength(1);
  });
  it("discards the prior account's ambiguous payout intent and finance records on session change", async () => {
    setToken("original-test-admin");
    const row = manualWithdrawal();
    withdrawalRows = [row];
    const base = admin.getMockImplementation()!;
    admin.mockImplementation(async (path, init) => {
      if (path.endsWith("/confirm-payment-success")) throw new TypeError("Lost response");
      if (path === "/commerce/withdrawals/confirm-manual") return { withdrawal: row };
      return base(path, init);
    });
    await show();
    await click("佣金与提现");
    const form = button("登记已核验的 TEST 付款成功结果").closest("form")!;
    fillManualSuccess(form);
    await submit(form);
    expect(button("按原完整请求重试 TEST 成功登记")).toBeTruthy();
    expect(host.textContent).toContain("TEST-MANUAL-RESULT");
    profile = scoped("support", "commerce.read", "commerce.support.write");
    const previousRequests = admin.mock.calls.length;
    await act(async () => setToken("different-test-admin"));
    expect(host.textContent).not.toContain("TEST-MANUAL-RESULT");
    expect(host.textContent).not.toContain("confirm-manual");
    expect(host.textContent).not.toContain("佣金与提现");
    const requests = admin.mock.calls.slice(previousRequests).map(([path]) => path);
    expect(requests[0]).toBe("/me");
    expect(requests.some((path) => /withdrawals|ledger/.test(path))).toBe(false);
    expect(
      admin.mock.calls.filter(([path]) => path.endsWith("/confirm-payment-success")),
    ).toHaveLength(1);
    expect(host.textContent).not.toContain("original-test-admin");
    expect(host.textContent).not.toContain("different-test-admin");
  });
  it("does not accept a success POST whose canonical confirmation reason differs", async () => {
    const row = manualWithdrawal();
    withdrawalRows = [row];
    const base = admin.getMockImplementation()!;
    admin.mockImplementation(async (path, init) => {
      if (
        path.endsWith("/confirm-payment-success") ||
        path === "/commerce/withdrawals/confirm-manual"
      )
        return {
          withdrawal: {
            ...row,
            status: "paid_test",
            reference: "TEST-MANUAL-RESULT",
            paymentEvidenceReference: "TEST-REVIEW-001",
            paymentConfirmationReason: "OTHER-TEST-REASON",
            paymentConfirmedAt: "2026-10-03T12:00:00Z",
            paymentConfirmedBy: "independent-reviewer",
          },
        };
      return base(path, init);
    });
    await show();
    await click("佣金与提现");
    const form = button("登记已核验的 TEST 付款成功结果").closest("form")!;
    fillManualSuccess(form);
    await submit(form);
    expect(host.textContent).toContain("成功结果登记尚未确认");
    await click("只读查询原 TEST 付款结果");
    expect(host.textContent).not.toContain("paid_test");
    expect(host.textContent).not.toContain("OTHER-TEST-REASON");
    expect(host.textContent).not.toContain("independent-reviewer");
    expect(
      admin.mock.calls.filter(([path]) => path.endsWith("/confirm-payment-success")),
    ).toHaveLength(1);
  });
  it.each([
    "status",
    "operation",
    "amount",
    "reference",
    "evidence",
    "reason",
    "confirmation",
  ] as const)(
    "keeps confirmed TEST success read-only when the subsequent %s does not match",
    async (mismatch) => {
      let row = manualWithdrawal();
      withdrawalRows = [row];
      const base = admin.getMockImplementation()!;
      admin.mockImplementation(async (path, init) => {
        if (path.endsWith("/confirm-payment-success")) {
          row = {
            ...row,
            status: "paid_test",
            reference: init.json.reference,
            paymentEvidenceReference: init.json.evidenceReference,
            paymentConfirmationReason: init.json.reason,
            paymentConfirmedAt: "2026-10-03T12:00:00Z",
            paymentConfirmedBy: "independent-reviewer",
          };
          return { withdrawal: row };
        }
        if (path === "/commerce/withdrawals/confirm-manual")
          return {
            withdrawal: {
              ...row,
              ...(mismatch === "status" ? { status: "payment_pending" } : {}),
              ...(mismatch === "operation"
                ? { paymentOperationId: "11111111-1111-4111-8111-111111111111" }
                : {}),
              ...(mismatch === "amount" ? { amountCents: 2600 } : {}),
              ...(mismatch === "reference" ? { reference: "OTHER-TEST-RESULT" } : {}),
              ...(mismatch === "evidence"
                ? { paymentEvidenceReference: "OTHER-TEST-EVIDENCE" }
                : {}),
              ...(mismatch === "reason" ? { paymentConfirmationReason: "OTHER-TEST-REASON" } : {}),
              ...(mismatch === "confirmation" ? { paymentConfirmedBy: null } : {}),
            },
          };
        return base(path, init);
      });
      await show();
      await click("佣金与提现");
      const form = button("登记已核验的 TEST 付款成功结果").closest("form")!;
      fillManualSuccess(form);
      await submit(form);
      await click("只读查询原 TEST 付款结果");
      expect(host.textContent).toContain("paid_test");
      expect(host.textContent).toContain("TEST-REVIEW-001");
      expect(host.textContent).not.toContain("OTHER-TEST");
      expect(host.textContent).not.toContain("按原完整请求重试 TEST 成功登记");
      expect(
        admin.mock.calls.filter(([path]) => path.endsWith("/confirm-payment-success")),
      ).toHaveLength(1);
    },
  );
  it.each(["start-payment", "mark-payment-unknown"] as const)(
    "resolves a stale %s intent by read-only verified paid_test without overwriting it",
    async (operation) => {
      let row = manualWithdrawal(operation === "start-payment" ? "approved" : "payment_pending");
      if (operation === "start-payment") row = { ...row, paymentOperationId: null };
      withdrawalRows = [row];
      const base = admin.getMockImplementation()!;
      admin.mockImplementation(async (path, init) => {
        if (path === `/commerce/withdrawals/confirm-manual/${operation}`) {
          row = {
            ...row,
            status: "paid_test",
            paymentOperationId: init.json.operationId,
            reference: "TEST-EXISTING-SUCCESS",
            paymentEvidenceReference: "TEST-EXISTING-EVIDENCE",
            paymentConfirmationReason: "Independently reviewed existing TEST evidence",
            paymentConfirmedAt: "2026-10-03T12:00:00Z",
            paymentConfirmedBy: "independent-reviewer",
          };
          throw new TypeError("Old registration response lost");
        }
        if (path === "/commerce/withdrawals/confirm-manual") return { withdrawal: row };
        return base(path, init);
      });
      await show();
      await click("佣金与提现");
      const form = button(
        operation === "start-payment" ? "登记开始人工测试付款" : "标记测试付款结果未知",
      ).closest("form")!;
      fill(form, { reason: "Original TEST operation" });
      await submit(form);
      await click("查询原提现操作");
      expect(host.textContent).toContain("paid_test");
      expect(host.textContent).toContain("TEST-EXISTING-EVIDENCE");
      expect(host.textContent).not.toContain("查询原提现操作");
      expect(host.textContent).not.toContain("按原操作编号重试登记");
      expect(admin.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    },
  );
  it.each(["session", "unmount"] as const)(
    "ignores late TEST success after %s and blocks overlapping submits",
    async (ending) => {
      setToken("original-test-admin");
      const row = manualWithdrawal();
      withdrawalRows = [row];
      const base = admin.getMockImplementation()!;
      let finish!: (value: unknown) => void;
      admin.mockImplementation(async (path, init) => {
        if (path.endsWith("/confirm-payment-success"))
          return new Promise((resolve) => {
            finish = resolve;
          });
        return base(path, init);
      });
      await show();
      await click("佣金与提现");
      const form = button("登记已核验的 TEST 付款成功结果").closest("form")!;
      fillManualSuccess(form);
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      if (ending === "session") await act(async () => setToken("different-test-admin"));
      else await act(async () => root.render(null));
      await act(async () =>
        finish({
          withdrawal: {
            ...row,
            status: "paid_test",
            reference: "TEST-MANUAL-RESULT",
            paymentEvidenceReference: "TEST-REVIEW-001",
            paymentConfirmationReason: "Independently reviewed TEST evidence",
            paymentConfirmedAt: "2026-10-03T12:00:00Z",
            paymentConfirmedBy: "independent-reviewer",
          },
        }),
      );
      expect(
        admin.mock.calls.filter(([path]) => path.endsWith("/confirm-payment-success")),
      ).toHaveLength(1);
      expect(
        admin.mock.calls.some(([path]) => path === "/commerce/withdrawals/confirm-manual"),
      ).toBe(false);
      expect(host.textContent).not.toContain("independent-reviewer");
      await act(async () => setToken(null));
    },
  );
  it.each(["payment_pending", "payment_unknown"] as const)(
    "does not expose rejection, another start or paid recording for %s",
    async (status) => {
      withdrawalRows = [
        {
          id: "unconfirmed-payout",
          userId: "buyer-start",
          approvedBy: "independent-test-approver",
          amountCents: 2500,
          status,
          reference: null,
          createdAt: "2026-10-01T12:00:00Z",
          paymentOperationId: "6b319a53-6dcb-47fe-b600-a4278dc5e189",
          paymentStartedBy: "payment-admin",
          paymentStartedAt: "2026-10-02T12:00:00Z",
          paymentUnknownAt: status === "payment_unknown" ? "2026-10-02T12:05:00Z" : null,
        },
      ];
      await show();
      await click("佣金与提现");
      expect(host.textContent).toContain("结果未确认，需人工核实；金额仍冻结");
      expect(host.textContent).not.toContain("登记开始人工测试付款");
      expect(host.textContent).not.toContain("记录已核实测试付款");
      expect(host.textContent).not.toContain("驳回并解冻");
      if (status === "payment_pending") expect(button("标记测试付款结果未知")).toBeTruthy();
      else expect(host.textContent).not.toContain("标记测试付款结果未知");
    },
  );
  it("retains the original operation and reason after a lost start response", async () => {
    let row = {
      id: "retry-start",
      userId: "buyer-start",
      approvedBy: "independent-test-approver",
      amountCents: 2500,
      status: "approved",
      reference: null,
      createdAt: "2026-10-01T12:00:00Z",
      paymentOperationId: null as string | null,
      paymentStartedBy: null as string | null,
      paymentStartedAt: null as string | null,
      paymentUnknownAt: null as string | null,
    };
    withdrawalRows = [row];
    const base = admin.getMockImplementation()!;
    let posts = 0;
    admin.mockImplementation(async (path, init) => {
      if (path === "/commerce/withdrawals/retry-start/start-payment") {
        posts++;
        row = {
          ...row,
          status: "payment_pending",
          paymentOperationId: init.json.operationId,
          paymentStartedBy: "payment-admin",
          paymentStartedAt: "2026-10-02T12:00:00Z",
        };
        if (posts === 1) throw new TypeError("Lost response after server committed");
        return { withdrawal: row };
      }
      if (path === "/commerce/withdrawals/retry-start") return { withdrawal: row };
      return base(path, init);
    });
    await show();
    await click("佣金与提现");
    const form = button("登记开始人工测试付款").closest("form")!;
    fill(form, { reason: "  Controlled TEST operation  " });
    await submit(form);
    expect(host.textContent).toContain("登记结果未确认");
    expect(host.textContent).not.toContain("记录已核实测试付款");
    expect(host.textContent).not.toContain("驳回并解冻");
    expect(host.textContent).not.toContain("登记开始人工测试付款");
    expect(host.textContent).toContain("离开或刷新本页会丢失当前重试凭据");
    await click("按原操作编号重试登记");
    const calls = admin.mock.calls.filter(([path]) => path.endsWith("/start-payment"));
    expect(calls).toHaveLength(2);
    expect(calls[0]![1].json).toEqual({
      operationId: expect.stringMatching(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i),
      reason: "Controlled TEST operation",
    });
    expect(calls[1]![1].json).toEqual(calls[0]![1].json);
    expect(button("标记测试付款结果未知")).toBeTruthy();
    expect(admin.mock.calls.some(([path]) => /\/(record|reject)$/.test(path))).toBe(false);
  });
  it("rejects blank or oversized registration reasons without posting", async () => {
    withdrawalRows = [
      {
        id: "reason-validation",
        userId: "buyer-start",
        approvedBy: "independent-test-approver",
        amountCents: 2500,
        status: "approved",
        reference: null,
        createdAt: "2026-10-01T12:00:00Z",
        paymentOperationId: null,
        paymentStartedBy: null,
        paymentStartedAt: null,
        paymentUnknownAt: null,
      },
    ];
    await show();
    await click("佣金与提现");
    const form = button("登记开始人工测试付款").closest("form")!;
    for (const reason of ["   ", "x".repeat(501)]) {
      fill(form, { reason });
      await submit(form);
      expect(host.textContent).toContain("请填写 1–500 字的人工测试操作原因。");
    }
    expect(admin.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("never resubmits a confirmed start when the follow-up read failed", async () => {
    const row = {
      id: "confirmed-start",
      userId: "buyer-start",
      approvedBy: "independent-test-approver",
      amountCents: 2500,
      status: "approved",
      reference: null,
      createdAt: "2026-10-01T12:00:00Z",
      paymentOperationId: null,
      paymentStartedBy: null,
      paymentStartedAt: null,
      paymentUnknownAt: null,
    };
    withdrawalRows = [row];
    const base = admin.getMockImplementation()!;
    let readFailed = true;
    let confirmed = { ...row, status: "payment_pending", paymentOperationId: "" };
    admin.mockImplementation(async (path, init) => {
      if (path === "/commerce/withdrawals/confirmed-start/start-payment") {
        confirmed = { ...confirmed, paymentOperationId: init.json.operationId };
        return { withdrawal: confirmed };
      }
      if (path === "/commerce/withdrawals/confirmed-start") {
        if (readFailed) throw new TypeError("Read unavailable");
        return { withdrawal: confirmed };
      }
      return base(path, init);
    });
    await show();
    await click("佣金与提现");
    const form = button("登记开始人工测试付款").closest("form")!;
    fill(form, { reason: "Controlled TEST operation" });
    await submit(form);
    expect(host.textContent).toContain("登记已由服务器确认，但列表刷新失败");
    expect(host.textContent).not.toContain("按原操作编号重试登记");
    expect(host.textContent).not.toContain("记录已核实测试付款");
    readFailed = false;
    await click("查询原提现操作");
    expect(button("标记测试付款结果未知")).toBeTruthy();
    expect(admin.mock.calls.filter(([path]) => path.endsWith("/start-payment"))).toHaveLength(1);
  });
  it("marks an existing pending operation unknown without new payment or unlock actions", async () => {
    let row = {
      id: "mark-unknown",
      userId: "buyer-start",
      approvedBy: "independent-test-approver",
      amountCents: 2500,
      status: "payment_pending",
      reference: null,
      createdAt: "2026-10-01T12:00:00Z",
      paymentOperationId: "6b319a53-6dcb-47fe-b600-a4278dc5e189",
      paymentStartedBy: "payment-admin",
      paymentStartedAt: "2026-10-02T12:00:00Z",
      paymentUnknownAt: null as string | null,
    };
    withdrawalRows = [row];
    const base = admin.getMockImplementation()!;
    let posts = 0;
    admin.mockImplementation(async (path, init) => {
      if (path === "/commerce/withdrawals/mark-unknown/mark-payment-unknown") {
        posts++;
        row = { ...row, status: "payment_unknown", paymentUnknownAt: "2026-10-02T12:05:00Z" };
        if (posts === 1) throw new TypeError("Lost unknown-registration response");
        return { withdrawal: row };
      }
      if (path === "/commerce/withdrawals/mark-unknown") return { withdrawal: row };
      return base(path, init);
    });
    await show();
    await click("佣金与提现");
    const form = button("标记测试付款结果未知").closest("form")!;
    fill(form, { reason: "  Manual TEST outcome cannot be confirmed  " });
    await submit(form);
    await click("按原操作编号重试登记");
    const calls = admin.mock.calls.filter(([path]) => path.endsWith("/mark-payment-unknown"));
    expect(calls).toHaveLength(2);
    expect(calls[0]![1].json).toEqual(calls[1]![1].json);
    expect(admin).toHaveBeenCalledWith("/commerce/withdrawals/mark-unknown/mark-payment-unknown", {
      method: "POST",
      json: {
        operationId: row.paymentOperationId,
        reason: "Manual TEST outcome cannot be confirmed",
      },
    });
    expect(host.textContent).toContain("标记未知时间");
    expect(host.textContent).not.toContain("标记测试付款结果未知");
    expect(host.textContent).not.toContain("记录已核实测试付款");
    expect(host.textContent).not.toContain("驳回并解冻");
  });
  it.each([
    [
      "marked unknown cannot regress",
      "mark-payment-unknown",
      "payment_unknown",
      "payment_pending",
      "same",
    ],
    [
      "start returned unknown cannot regress",
      "start-payment",
      "payment_unknown",
      "payment_pending",
      "same",
    ],
    [
      "confirmed pending may advance",
      "start-payment",
      "payment_pending",
      "payment_unknown",
      "same",
    ],
    [
      "different operation is not confirmation",
      "mark-payment-unknown",
      "payment_unknown",
      "payment_unknown",
      "other",
    ],
    [
      "missing operation is not confirmation",
      "mark-payment-unknown",
      "payment_unknown",
      "payment_unknown",
      "null",
    ],
    [
      "approval is not a replacement",
      "mark-payment-unknown",
      "payment_unknown",
      "approved",
      "same",
    ],
    [
      "paid test without success evidence is not a replacement",
      "mark-payment-unknown",
      "payment_unknown",
      "paid_test",
      "same",
    ],
  ] as const)(
    "preserves manual payment confirmation: %s",
    async (_label, action, postStatus, readStatus, readOperation) => {
      const initial: CommerceAdminWithdrawal = {
        id: "monotonic-payout",
        userId: "buyer-start",
        approvedBy: "independent-test-approver",
        amountCents: 2500,
        status: action === "start-payment" ? "approved" : "payment_pending",
        reference: null,
        createdAt: "2026-10-01T12:00:00Z",
        paymentOperationId:
          action === "start-payment" ? null : "6b319a53-6dcb-47fe-b600-a4278dc5e189",
        paymentStartedBy: null,
        paymentStartedAt: null,
        paymentUnknownAt: null,
        paymentConfirmedAt: null,
        paymentConfirmedBy: null,
        paymentEvidenceReference: null,
        paymentConfirmationReason: null,
      };
      withdrawalRows = [initial];
      let confirmed = initial;
      let fresh = false;
      const base = admin.getMockImplementation()!;
      admin.mockImplementation(async (path, init) => {
        if (path === `/commerce/withdrawals/monotonic-payout/${action}`) {
          confirmed = {
            ...initial,
            status: postStatus,
            paymentOperationId: init.json.operationId,
            paymentStartedBy: "payment-admin",
            paymentStartedAt: "2026-10-02T12:00:00Z",
            paymentUnknownAt: postStatus === "payment_unknown" ? "2026-10-02T12:05:00Z" : null,
          };
          return { withdrawal: confirmed };
        }
        if (path === "/commerce/withdrawals/monotonic-payout") {
          return {
            withdrawal: {
              ...confirmed,
              status: fresh ? "payment_unknown" : readStatus,
              paymentOperationId:
                fresh || readOperation === "same"
                  ? confirmed.paymentOperationId
                  : readOperation === "null"
                    ? null
                    : "11111111-1111-4111-8111-111111111111",
              paymentUnknownAt:
                fresh || readStatus === "payment_unknown" ? "2026-10-02T12:05:00Z" : null,
            },
          };
        }
        return base(path, init);
      });
      await show();
      await click("佣金与提现");
      const form = button(
        action === "start-payment" ? "登记开始人工测试付款" : "标记测试付款结果未知",
      ).closest("form")!;
      fill(form, { reason: "Controlled monotonic TEST confirmation" });
      await submit(form);
      const assertConfirmedUnknown = () => {
        const section = [...host.querySelectorAll("small")]
          .find((node) => node.textContent === initial.id)!
          .closest("section")!;
        expect(section.querySelector("strong")!.textContent).toContain("payment_unknown");
        expect(section.textContent).toContain(confirmed.paymentOperationId);
        expect(section.textContent).toContain("标记未知时间");
        for (const text of [
          "登记开始人工测试付款",
          "标记测试付款结果未知",
          "记录已核实测试付款",
          "驳回并解冻",
          "按原操作编号重试登记",
        ])
          expect(section.textContent).not.toContain(text);
      };
      assertConfirmedUnknown();
      if (postStatus === "payment_pending") {
        expect(host.textContent).not.toContain("查询原提现操作");
      } else {
        expect(button("查询原提现操作")).toBeTruthy();
        await click("查询原提现操作");
        assertConfirmedUnknown();
        expect(button("查询原提现操作")).toBeTruthy();
        fresh = true;
        await click("查询原提现操作");
        assertConfirmedUnknown();
        expect(host.textContent).not.toContain("查询原提现操作");
      }
      expect(
        admin.mock.calls.filter(
          ([path, init]) => path.includes("monotonic-payout/") && init?.method === "POST",
        ),
      ).toHaveLength(1);
    },
  );
  it.each(["payment_pending", "payment_unknown"] as const)(
    "queries the server's %s withdrawal filter from page zero",
    async (status) => {
      await show();
      await click("佣金与提现");
      await select("提现待处理筛选", status);
      expect(admin).toHaveBeenCalledWith(`/commerce/withdrawals?status=${status}`);
      expect(button("上一页提现").disabled).toBe(true);
    },
  );
  it("shows separate manual approval and verified test-payout recording, never transfers funds", async () => {
    withdrawalRows = [
      {
        id: "pending-1",
        userId: "buyer-1",
        amountCents: 2500,
        status: "requested",
        reference: null,
        createdAt: "2026-10-01T12:00:00Z",
      },
      {
        id: "approved-1",
        userId: "buyer-2",
        approvedBy: "independent-test-approver",
        amountCents: 3000,
        status: "approved",
        reference: null,
        createdAt: "2026-10-01T12:00:00Z",
      },
    ];
    await show();
    await click("佣金与提现");
    await click("批准测试提现申请");
    expect(admin).toHaveBeenCalledWith("/commerce/withdrawals/pending-1/approve", {
      method: "POST",
      json: {},
    });
    const form = button("记录已核实测试付款").closest("form")!;
    fill(form, { reference: "TEST-BANK-REFERENCE", reason: "Verified test statement" });
    await submit(form);
    expect(admin).toHaveBeenCalledWith("/commerce/withdrawals/approved-1/record", {
      method: "POST",
      json: { reference: "TEST-BANK-REFERENCE", reason: "Verified test statement" },
    });
    expect(host.textContent).toContain("记录测试凭证不会产生真实银行转账");
    expect(host.textContent).toContain("不代表支付渠道或银行已实际对账");
  });
});
