import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  CommerceExternalRefundAllocationResult,
  CommerceExternalRefundDetail,
  CommercePaymentStatus,
} from "@synara/contracts/cloud";

const { admin } = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  admin,
}));
import { setToken } from "@/lib/api";
import { ProviderPaymentAdmin } from "./ProviderPaymentAdmin";

const orderId = "stripe-order-1";
const orderPath = `/commerce/orders/${orderId}`;
const payment: CommercePaymentStatus = {
  enabled: true,
  mode: "test",
  provider: "stripe_test",
  paymentProvider: "stripe_test",
  orderId,
  attemptId: "attempt-1",
  sessionId: "cs_test_RO",
  status: "requires_review",
  checkoutUrl: null,
  expiresAt: null,
  refunds: [],
};
const detail: CommerceExternalRefundDetail = {
  refund: {
    id: "external-1",
    orderId,
    attemptId: "attempt-1",
    providerRefundId: "re_TEST_RO",
    sourceEventId: "evt_TEST_RO",
    amountCents: 1200,
    currency: "CAD",
    providerStatus: "succeeded",
    allocationState: "unallocated",
    version: 3,
    allocatedAt: null,
    allocations: [],
  },
  enabled: true,
  canAllocate: true,
  message: "渠道已确认成功，可登记商品归属，不会再次退款。",
  items: [{ itemId: "line-1", name: "Synthetic item", sku: "TEST-SKU", remainingCents: 5000 }],
  payment,
};

let host: HTMLDivElement;
let root: Root;
const onPayment = vi.fn();
const onOrderChanged = vi.fn<() => Promise<void>>();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  admin.mockReset();
  admin.mockImplementation(async (path) => {
    if (path === `${orderPath}/payment`) return { payment };
    if (path === "/commerce/external-refunds/external-1") return detail;
    if (path === `${orderPath}/external-refunds?page=1`)
      return { refunds: [], enabled: true, page: 1, hasMore: false };
    if (path === `${orderPath}/external-refunds`)
      return { refunds: [detail.refund], enabled: true, page: 0, hasMore: true };
    throw Error(`Unexpected request ${path}`);
  });
  onPayment.mockReset();
  onOrderChanged.mockReset();
  onOrderChanged.mockResolvedValue(undefined);
  setToken("synthetic-finance-session");
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
const show = async (canWrite = true) => {
  await act(async () =>
    root.render(
      <ProviderPaymentAdmin
        orderId={orderId}
        payment={payment}
        onPayment={onPayment}
        onOrderChanged={onOrderChanged}
        disabled={false}
        canWrite={canWrite}
      />,
    ),
  );
};
const click = async (label: string) => {
  const button = [...host.querySelectorAll("button")].find((node) => node.textContent === label);
  if (!button) throw Error("Missing " + label);
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
};
const submit = async (form: HTMLFormElement) => {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

it("keeps TEST payment and refund list, detail, refresh and pagination available without finance writes", async () => {
  await show(false);
  await click("查询渠道测试状态");
  await click("查询外部退款记录");
  await click("查看退款归属详情");
  await click("刷新退款归属详情");
  expect(host.textContent).toContain("re_TEST_RO");
  expect(host.textContent).toContain("TEST-SKU");
  expect(host.textContent).toContain("CAD 12.00");
  expect(host.querySelector("form, input")).toBeNull();
  expect(host.textContent).not.toContain("核实并同步渠道测试结果");
  expect(host.textContent).not.toContain("登记已有验签退款事件");
  expect(host.textContent).not.toContain("确认登记已有退款归属");
  await click("下一页外部退款");
  await click("上一页外部退款");
  expect(admin.mock.calls).toEqual([
    [`${orderPath}/payment`],
    [`${orderPath}/external-refunds`],
    ["/commerce/external-refunds/external-1"],
    ["/commerce/external-refunds/external-1"],
    [`${orderPath}/external-refunds?page=1`],
    [`${orderPath}/external-refunds`],
  ]);
});

it.each(["session change", "unmount"])(
  "does not update the order or refresh it when a payment read resolves after %s",
  async (invalidate) => {
    let finish!: (result: { payment: CommercePaymentStatus }) => void;
    admin.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await show();
    await click("查询渠道测试状态");
    if (invalidate === "unmount") await act(async () => root.render(null));
    else await act(async () => setToken("synthetic-support-session"));
    await act(async () => finish({ payment }));
    expect(admin.mock.calls).toEqual([[`${orderPath}/payment`]]);
    expect(onPayment).not.toHaveBeenCalled();
    expect(onOrderChanged).not.toHaveBeenCalled();
  },
);

it("does not read the prior order's refund list if the observe POST returns after session change", async () => {
  await show();
  await click("查询外部退款记录");
  let finish!: (result: CommerceExternalRefundDetail) => void;
  admin.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const form = host.querySelector<HTMLFormElement>("details form")!;
  (form.elements.namedItem("sourceEventId") as HTMLInputElement).value = "evt_TEST_RO";
  (form.elements.namedItem("reason") as HTMLInputElement).value = "Synthetic verified event";
  await submit(form);
  expect(admin.mock.calls[1]?.[0]).toBe("/commerce/external-refunds/observe");
  expect(admin.mock.calls[1]?.[1]?.method).toBe("POST");
  await act(async () => setToken("synthetic-support-session"));
  await act(async () => finish(detail));
  expect(onPayment).not.toHaveBeenCalled();
  expect(admin.mock.calls).toHaveLength(2);
});

it("does not continue an allocation readback under a new session during the order refresh", async () => {
  await show();
  await click("查询外部退款记录");
  await click("查看退款归属详情");
  const form = host.querySelector<HTMLFormElement>('form[aria-label="核销已有渠道退款"]')!;
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    for (const [name, value] of Object.entries({
      "line-1": "12.00",
      reason: "Synthetic verified allocation",
    })) {
      const input = form.elements.namedItem(name) as HTMLInputElement;
      setValue.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    form.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  });
  const result: CommerceExternalRefundAllocationResult = {
    refund: { ...detail.refund, allocationState: "allocated" },
    payment,
    applied: true,
    reviewCleared: false,
    message: "Synthetic allocation saved",
  };
  admin.mockResolvedValueOnce(result);
  let finish!: () => void;
  onOrderChanged.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await submit(form);
  expect(admin.mock.calls[2]?.[0]).toBe("/commerce/external-refunds/external-1/allocate");
  expect(admin.mock.calls[2]?.[1]?.method).toBe("POST");
  expect(onOrderChanged).toHaveBeenCalledTimes(1);
  await act(async () => setToken("synthetic-support-session"));
  await act(async () => finish());
  expect(admin.mock.calls).toHaveLength(3);
});
