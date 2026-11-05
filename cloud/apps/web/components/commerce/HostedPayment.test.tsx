import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommerceOrder, CommercePaymentStatus } from "@synara/contracts/cloud";

const { commerce, openCommerceCheckout } = vi.hoisted(() => ({
  commerce: { checkout: vi.fn(), payment: vi.fn(), cancelCheckout: vi.fn() },
  openCommerceCheckout: vi.fn(),
}));
vi.mock("@/lib/commerce", async (original) => ({
  ...(await original<typeof import("@/lib/commerce")>()),
  commerce,
}));
vi.mock("@/lib/commerce-checkout", async (original) => ({
  ...(await original<typeof import("@/lib/commerce-checkout")>()),
  openCommerceCheckout,
}));
import { HostedPayment } from "./HostedPayment";

const url = "https://checkout.stripe.com/c/pay/cs_test_UNIT123#test";
const payment: CommercePaymentStatus = {
  enabled: true,
  mode: "test",
  provider: "stripe_test",
  paymentProvider: "stripe_test",
  orderId: "order-1",
  attemptId: "attempt-1",
  sessionId: "cs_test_UNIT123",
  status: "open",
  checkoutUrl: url,
  expiresAt: "2026-10-26T12:00:00Z",
  refunds: [],
};
const order = {
  id: "order-1",
  status: "awaiting_payment",
  paymentProvider: "stripe_test",
} as CommerceOrder;
beforeEach(() => {
  for (const method of Object.values(commerce)) method.mockReset();
  openCommerceCheckout.mockReset();
  openCommerceCheckout.mockResolvedValue(undefined);
  commerce.payment.mockResolvedValue({
    payment: { ...payment, status: "not_started", checkoutUrl: null },
  });
  window.history.replaceState({}, "", "/shop");
});

describe("optional hosted TEST checkout, never real money or success-query settlement", () => {
  it("requires a successful capability read before presenting checkout as available", async () => {
    let finish!: (value: { payment: CommercePaymentStatus }) => void;
    commerce.payment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <HostedPayment
        order={order}
        disabled={false}
        enabled={true}
        onOrderChanged={async () => {}}
      />,
    );
    const prepare = screen.getByRole("button", { name: "准备 Stripe 测试付款" });
    expect(prepare).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "查询服务器支付状态" }));
    expect(prepare).toBeDisabled();
    finish({ payment: { ...payment, status: "not_started", checkoutUrl: null } });
    await waitFor(() => expect(prepare).toBeEnabled());
    expect(commerce.checkout).not.toHaveBeenCalled();
  });
  it("requires a new capability read after a status query fails instead of trusting the old enabled flag", async () => {
    render(
      <HostedPayment
        order={order}
        disabled={false}
        enabled={true}
        onOrderChanged={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查询服务器支付状态" }));
    const prepare = screen.getByRole("button", { name: "准备 Stripe 测试付款" });
    await waitFor(() => expect(prepare).toBeEnabled());
    commerce.payment.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(screen.getByRole("button", { name: "查询服务器支付状态" }));
    await screen.findByText("暂时无法连接商城服务，请稍后重试。");
    expect(prepare).toBeDisabled();
    expect(commerce.checkout).not.toHaveBeenCalled();
  });
  it("cancels a server-proven unstarted order without a configured gateway and refreshes the actual order", async () => {
    const untouched = {
      ...payment,
      enabled: false,
      status: "not_started" as const,
      attemptId: null,
      sessionId: null,
      checkoutUrl: null,
    };
    const changed = vi.fn(async () => {});
    commerce.payment.mockResolvedValue({ payment: untouched });
    commerce.cancelCheckout.mockResolvedValue({ payment: untouched });
    render(
      <HostedPayment order={order} disabled={false} enabled={true} onOrderChanged={changed} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查询服务器支付状态" }));
    await screen.findByText("尚未创建测试收银台");
    expect(screen.getByRole("button", { name: "申请关闭测试收银台" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "申请关闭测试收银台" }));
    await screen.findByText("订单取消结果已刷新，请以服务器订单状态为准。");
    expect(commerce.cancelCheckout).toHaveBeenCalledWith(order.id, expect.any(String));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(commerce.checkout).not.toHaveBeenCalled();
    expect(openCommerceCheckout).not.toHaveBeenCalled();
    expect(
      screen.queryByText("已提交关闭请求，结果尚需核实；不代表订单已取消或库存已释放。"),
    ).not.toBeInTheDocument();
  });
  it("does not bypass the gateway requirement for an existing unknown payment attempt", async () => {
    commerce.payment.mockResolvedValue({
      payment: { ...payment, enabled: false, status: "unknown", checkoutUrl: null },
    });
    render(
      <HostedPayment
        order={order}
        disabled={false}
        enabled={true}
        onOrderChanged={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "申请关闭测试收银台" }));
    await screen.findByText("付款结果待核实");
    await screen.findByText("渠道测试配置尚未启用，只能查询已有付款状态，请联系平台处理。");
    expect(screen.getByRole("button", { name: "申请关闭测试收银台" })).toBeDisabled();
    expect(commerce.cancelCheckout).not.toHaveBeenCalled();
  });
  it("checks actual server capability before checkout and never falls back when keys are missing", async () => {
    commerce.payment.mockResolvedValue({
      payment: { ...payment, enabled: false, status: "not_started", checkoutUrl: null },
    });
    render(
      <HostedPayment
        order={order}
        disabled={false}
        enabled={true}
        onOrderChanged={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查询服务器支付状态" }));
    await screen.findByText("渠道测试付款暂未启用或已暂停，仍可查询服务器历史状态。");
    expect(commerce.checkout).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "准备 Stripe 测试付款" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "查询服务器支付状态" })).toBeEnabled();
  });
  it("keeps historical status reads available when commerce test operations are disabled", async () => {
    commerce.payment.mockResolvedValue({
      payment: { ...payment, enabled: false, status: "unknown", checkoutUrl: null },
    });
    render(
      <HostedPayment
        order={order}
        disabled={false}
        enabled={false}
        onOrderChanged={async () => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "准备 Stripe 测试付款" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "申请关闭测试收银台" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "查询服务器支付状态" }));
    await screen.findByText("付款结果待核实");
    expect(commerce.checkout).not.toHaveBeenCalled();
  });
  it("reuses the checkout retry key and opens separately only after a second explicit click", async () => {
    const changed = vi.fn(async () => {});
    commerce.checkout
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ payment, checkoutUrl: url });
    render(
      <HostedPayment order={order} disabled={false} enabled={true} onOrderChanged={changed} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查询服务器支付状态" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "准备 Stripe 测试付款" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "准备 Stripe 测试付款" }));
    await screen.findByText("暂时无法连接商城服务，请稍后重试。");
    fireEvent.click(screen.getByRole("button", { name: "准备 Stripe 测试付款" }));
    const open = await screen.findByRole("button", { name: "打开 Stripe 测试收银台 ↗" });
    expect(commerce.checkout.mock.calls[0]?.[1]).toBe(commerce.checkout.mock.calls[1]?.[1]);
    expect(openCommerceCheckout).not.toHaveBeenCalled();
    fireEvent.click(open);
    await waitFor(() =>
      expect(openCommerceCheckout).toHaveBeenCalledWith({
        orderId: order.id,
        attemptId: payment.attemptId,
        sessionId: payment.sessionId,
        checkoutUrl: url,
      }),
    );
    expect(screen.queryByText("服务器已确认测试付款")).not.toBeInTheDocument();
  });
  it("does not trust a return success URL or turn unknown payment/refund outcomes into success", async () => {
    window.history.replaceState({}, "", "/shop?payment=success&session_id=cs_test_UNIT123");
    commerce.payment.mockResolvedValue({
      payment: {
        ...payment,
        status: "unknown",
        checkoutUrl: null,
        refunds: [
          {
            id: "refund-1",
            itemId: "item-1",
            amountCents: 1200,
            refundTotalCents: 1200,
            status: "unknown",
            createdAt: "2026-10-26T10:00:00Z",
          },
        ],
      },
    });
    render(
      <HostedPayment
        order={order}
        disabled={false}
        enabled={true}
        onOrderChanged={async () => {}}
      />,
    );
    expect(commerce.payment).not.toHaveBeenCalled();
    expect(screen.queryByText("服务器已确认测试付款")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查询服务器支付状态" }));
    await screen.findByText("付款结果待核实");
    expect(screen.getByText(/CAD 12.00 · 退款结果待核实/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "打开 Stripe 测试收银台 ↗" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "准备 Stripe 测试付款" })).not.toBeInTheDocument();
    expect(openCommerceCheckout).not.toHaveBeenCalled();
  });
  it("shows cancellation as pending until the server proves the session was unpaid", async () => {
    commerce.payment.mockResolvedValue({ payment });
    commerce.cancelCheckout.mockResolvedValue({
      payment: { ...payment, status: "cancel_requested", checkoutUrl: null },
    });
    render(
      <HostedPayment
        order={order}
        disabled={false}
        enabled={true}
        onOrderChanged={async () => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查询服务器支付状态" }));
    await screen.findByText("测试收银台待付款");
    fireEvent.click(screen.getByRole("button", { name: "申请关闭测试收银台" }));
    await screen.findByText("已提交关闭请求，结果尚需核实；不代表订单已取消或库存已释放。");
    expect(screen.getByRole("button", { name: "申请关闭测试收银台" })).toBeDisabled();
  });
  it("queries the server after returning focus and confirms paid only from that snapshot", async () => {
    const changed = vi.fn(async () => {});
    commerce.checkout.mockResolvedValue({ payment, checkoutUrl: url });
    commerce.payment
      .mockResolvedValueOnce({ payment: { ...payment, status: "not_started", checkoutUrl: null } })
      .mockResolvedValueOnce({ payment: { ...payment, status: "not_started", checkoutUrl: null } })
      .mockResolvedValue({ payment: { ...payment, status: "paid", checkoutUrl: null } });
    render(
      <HostedPayment order={order} disabled={false} enabled={true} onOrderChanged={changed} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查询服务器支付状态" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "准备 Stripe 测试付款" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "准备 Stripe 测试付款" }));
    fireEvent.click(await screen.findByRole("button", { name: "打开 Stripe 测试收银台 ↗" }));
    await screen.findByText(/正在限时查询服务器状态/);
    fireEvent(window, new Event("focus"));
    await screen.findByText("服务器已确认测试付款");
    expect(commerce.payment).toHaveBeenCalledWith(order.id);
    expect(changed).toHaveBeenCalled();
    expect(screen.queryByText(/正在限时查询服务器状态/)).not.toBeInTheDocument();
  });
});
