import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommerceOrder, CommerceProfile, CommerceProduct } from "@synara/contracts/cloud";

const { commerce, uploadCommerceImage, centerCropImage, auth, push } = vi.hoisted(() => ({
  auth: {
    useSession: vi.fn(),
    signOut: vi.fn(),
    refetch: vi.fn(),
    $store: { atoms: { session: { get: vi.fn() } } },
  },
  push: vi.fn(),
  uploadCommerceImage: vi.fn(),
  centerCropImage: vi.fn(),
  commerce: {
    catalog: vi.fn(),
    favorites: vi.fn(),
    setFavorite: vi.fn(),
    ledger: vi.fn(),
    me: vi.fn(),
    referralSummary: vi.fn(),
    orders: vi.fn(),
    withdrawals: vi.fn(),
    createOrder: vi.fn(),
    recoverOrder: vi.fn(),
    testPay: vi.fn(),
    cancel: vi.fn(),
    bind: vi.fn(),
    withdraw: vi.fn(),
    requestReturn: vi.fn(),
    searchImage: vi.fn(),
  },
}));
vi.mock("@/lib/auth-client", () => ({ authClient: auth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./CanadianAddressLookup", () => ({
  CanadianAddressLookup: () => <div data-testid="optional-address-lookup" />,
}));
vi.mock("@/lib/commerce", async (original) => ({
  ...(await original<typeof import("@/lib/commerce")>()),
  commerce,
  uploadCommerceImage,
  centerCropImage,
}));
import { ApiError } from "@/lib/api";
import { ShopClient } from "./ShopClient";

const product: CommerceProduct = {
  id: "product-1",
  sku: "TOTE-WHITE-1",
  name: "米白帆布包",
  description: "日常轻便的帆布包",
  category: "包袋",
  imageUrl: "",
  priceCents: 3900,
  stock: 10,
  commissionBps: 1000,
  returnDays: 30,
};
const zeroReferralSummary = {
  mode: "test",
  currency: "CAD",
  directBuyers: 0,
  ordersWithCommission: 0,
  netCommissionCents: 0,
} as const;
const initialProfile: CommerceProfile = {
  referralCode: "FRIEND-1",
  referrerId: null,
  firstPaidAt: null,
  wallet: { pendingCents: 0, availableCents: 0, frozenCents: 0, paidCents: 0, recoveryCents: 0 },
  suppliers: [],
};
const order: CommerceOrder = {
  id: "order-1",
  paymentProvider: "simulation",
  status: "awaiting_payment",
  mode: "test",
  currency: "CAD",
  createdAt: "2026-10-01T12:00:00Z",
  expiresAt: "2026-10-01T12:30:00Z",
  paidAt: null,
  totalCents: 3900,
  refundedCents: 0,
  address: {
    name: "Test Buyer",
    line1: "1 Test Road",
    city: "Toronto",
    province: "ON",
    postalCode: "M5V 2T6",
    country: "CA",
  },
  items: [
    {
      id: "item-1",
      productId: product.id,
      sku: product.sku,
      name: product.name,
      quantity: 1,
      priceCents: 3900,
      lineCents: 3900,
      refundedCents: 0,
      status: "pending",
      carrier: null,
      trackingNumber: null,
      deliveredAt: null,
      openCase: false,
      returnDays: 30,
    },
  ],
};
const navigate = (name: string) => fireEvent.click(screen.getAllByRole("button", { name })[0]!);
let authState: {
  data: {
    session: { id: string; token: string };
    user: { id: string; name: string; email: string; emailVerified: boolean };
  } | null;
  isPending: boolean;
  error: unknown;
};

beforeEach(() => {
  auth.useSession.mockReset();
  auth.signOut.mockReset();
  auth.refetch.mockReset();
  auth.refetch.mockResolvedValue(undefined);
  push.mockReset();
  authState = {
    data: {
      session: { id: "buyer-session", token: "DO-NOT-RENDER-SESSION-TOKEN" },
      user: { id: "buyer-1", name: "Buyer One", email: "buyer1@test.invalid", emailVerified: true },
    },
    isPending: false,
    error: null,
  };
  auth.useSession.mockImplementation(() => ({ ...authState, refetch: auth.refetch }));
  auth.$store.atoms.session.get.mockReset();
  auth.$store.atoms.session.get.mockImplementation(() => ({
    ...authState,
    isRefetching: false,
    refetch: auth.refetch,
  }));
  auth.signOut.mockResolvedValue({ data: { success: true }, error: null });
  Reflect.deleteProperty(window, "djlCommerce");
  for (const method of Object.values(commerce)) method.mockReset();
  commerce.catalog.mockResolvedValue({ products: [product], currency: "CAD", mode: "test" });
  commerce.favorites.mockResolvedValue({ userId: "buyer-1", productIds: [] });
  commerce.setFavorite.mockImplementation(
    async (_userId: string, productId: string, saved: boolean) => ({
      userId: "buyer-1",
      productId,
      saved,
    }),
  );
  commerce.me.mockResolvedValue(initialProfile);
  commerce.referralSummary.mockResolvedValue(zeroReferralSummary);
  commerce.orders.mockResolvedValue({ orders: [] });
  commerce.withdrawals.mockResolvedValue({ withdrawals: [] });
  commerce.ledger.mockResolvedValue({ entries: [] });
  uploadCommerceImage.mockReset();
  uploadCommerceImage.mockResolvedValue("uploaded-image-1");
  centerCropImage.mockReset();
  centerCropImage.mockImplementation(async (file: File) => file);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:fixture-image",
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: () => {} });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  window.history.replaceState({}, "", "/shop");
});

const fillTestAddress = (dialog: HTMLElement, line1 = "1 Test Road", province = "ON") => {
  for (const [label, value] of [
    ["收件人", "Test Buyer"],
    ["地址", line1],
    ["城市", "Toronto"],
    ["邮编", "M5V 2T6"],
  ])
    fireEvent.change(within(dialog).getByLabelText(label!), { target: { value } });
  if (province)
    fireEvent.change(within(dialog).getByLabelText("省／地区"), { target: { value: province } });
};
async function openTestCheckout(quantity = 1, province = "ON") {
  sessionStorage.setItem("djl-commerce-cart-v1", JSON.stringify({ [product.id]: quantity }));
  render(<ShopClient />);
  await screen.findByText(product.name);
  await waitFor(() => expect(commerce.withdrawals).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: `购物车，${quantity}件商品` }));
  const dialog = screen.getByRole("dialog", { name: "购物车与测试结账" });
  fillTestAddress(dialog, undefined, province);
  return dialog;
}
const submitTestOrder = (dialog: HTMLElement) =>
  fireEvent.submit(within(dialog).getByRole("button", { name: "创建测试订单" }).closest("form")!);

describe("independent cloud shop interaction", () => {
  it("starts Province/Territory blank and explains the missing choice on native validation", async () => {
    const dialog = await openTestCheckout(1, "");
    expect(within(dialog).queryByTestId("optional-address-lookup")).not.toBeInTheDocument();
    const province = within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "省／地区" });
    expect(province).toHaveValue("");
    expect(province).toBeRequired();
    act(() => expect(province.reportValidity()).toBe(false));
    expect(province).toHaveFocus();
    expect(province).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("请选择收货地址的省／地区。");
    expect(province).toHaveAccessibleDescription("请选择收货地址的省／地区。");
    expect(commerce.createOrder).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "关闭购物车与测试结账" }));
    fireEvent.click(screen.getByRole("button", { name: "购物车，1件商品" }));
    const reopened = screen.getByRole("dialog", { name: "购物车与测试结账" });
    expect(within(reopened).getByRole("combobox", { name: "省／地区" })).toHaveValue("");
    expect(within(reopened).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks a programmatic checkout submit until the buyer explicitly chooses a province", async () => {
    const destination = {
      name: "Test Buyer",
      line1: "1 Test Road",
      city: "Vancouver",
      province: "BC",
      postalCode: "V6B 1A1",
      country: "CA",
    };
    const awaiting = { ...order, address: destination };
    commerce.createOrder.mockResolvedValue({ order: awaiting });
    commerce.orders.mockResolvedValueOnce({ orders: [] }).mockResolvedValue({ orders: [awaiting] });
    const dialog = await openTestCheckout(1, "");
    const fields = within(dialog);
    const province = fields.getByRole("combobox", { name: "省／地区" });
    fireEvent.change(fields.getByLabelText("城市"), { target: { value: destination.city } });
    fireEvent.change(fields.getByLabelText("邮编"), { target: { value: destination.postalCode } });

    submitTestOrder(dialog);
    expect(commerce.createOrder).not.toHaveBeenCalled();
    expect(province).toHaveFocus();
    expect(fields.getByRole("alert")).toHaveTextContent("请选择收货地址的省／地区。");
    expect(fields.getByLabelText("收件人")).toHaveValue(destination.name);
    expect(fields.getByLabelText("地址")).toHaveValue(destination.line1);
    expect(fields.getByLabelText("城市")).toHaveValue(destination.city);
    expect(fields.getByLabelText("邮编")).toHaveValue(destination.postalCode);
    expect(JSON.parse(sessionStorage.getItem("djl-commerce-cart-v1")!)).toEqual({
      [product.id]: 1,
    });

    fireEvent.change(province, { target: { value: destination.province } });
    expect(fields.queryByRole("alert")).not.toBeInTheDocument();
    expect(province).not.toHaveAttribute("aria-invalid");
    submitTestOrder(dialog);
    await screen.findByRole("button", { name: "确认测试付款" });
    expect(commerce.createOrder).toHaveBeenCalledExactlyOnceWith(
      [{ productId: product.id, quantity: 1 }],
      destination,
      expect.any(String),
      "buyer-1",
    );
    expect(commerce.testPay).not.toHaveBeenCalled();
  });

  it("persists only the canonical owner-scoped UUID before sending the first order request", async () => {
    commerce.orders.mockResolvedValueOnce({ orders: [] }).mockResolvedValue({ orders: [order] });
    const dialog = await openTestCheckout();
    const marker = "djl-commerce-order-attempt-v1:web:buyer-1";
    let saved: string | null = null;
    commerce.createOrder.mockImplementation(async () => {
      saved = sessionStorage.getItem(marker);
      return { order };
    });
    submitTestOrder(dialog);
    const [, address, key, expectedUserId] = commerce.createOrder.mock.calls[0]!;
    expect(saved).toBe(key);
    expect(key).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(expectedUserId).toBe("buyer-1");
    expect(saved).not.toContain(address.line1);
    await screen.findByRole("button", { name: "确认测试付款" });
    expect(commerce.createOrder).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(marker)).toBeNull();
    expect(commerce.recoverOrder).not.toHaveBeenCalled();
  });

  it.each(["found", "closed"] as const)(
    "locks a reloaded checkout and requires explicit recovery of a %s result",
    async (status) => {
      const marker = "djl-commerce-order-attempt-v1:web:buyer-1";
      const initial = await openTestCheckout();
      commerce.createOrder.mockRejectedValueOnce(new TypeError("original response lost"));
      submitTestOrder(initial);
      const original = await within(initial).findByRole("button", { name: "重试原订单请求" });
      await waitFor(() => expect(original).toBeEnabled());
      const key = commerce.createOrder.mock.calls[0]![2];
      expect(sessionStorage.getItem(marker)).toBe(key);

      cleanup();
      render(<ShopClient />);
      await screen.findByText(product.name);
      await screen.findByRole("button", { name: "核实原下单请求" });
      expect(commerce.recoverOrder).not.toHaveBeenCalled();
      expect(commerce.createOrder).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: "购物车，1件商品" }));
      const reopened = screen.getByRole("dialog", { name: "购物车与测试结账" });
      expect(within(reopened).getByRole("button", { name: "创建测试订单" })).toBeDisabled();
      expect(within(reopened).getByLabelText("地址")).toHaveValue("");
      submitTestOrder(reopened);
      expect(commerce.createOrder).toHaveBeenCalledOnce();

      commerce.recoverOrder.mockResolvedValue(status === "found" ? { status, order } : { status });
      fireEvent.click(within(reopened).getByRole("button", { name: "核实原下单请求" }));
      await waitFor(() => expect(sessionStorage.getItem(marker)).toBeNull());
      expect(commerce.recoverOrder).toHaveBeenCalledExactlyOnceWith("buyer-1", key);
      expect(commerce.createOrder).toHaveBeenCalledOnce();
      expect(commerce.testPay).not.toHaveBeenCalled();
      expect(commerce.cancel).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "购物车，1件商品" })).toBeInTheDocument();
      if (status === "found") {
        const pay = await screen.findByRole("button", { name: "确认测试付款" });
        expect(screen.getByText(/服务器确认原订单已存在/)).toBeInTheDocument();
        commerce.testPay.mockResolvedValueOnce({ order: { ...order, status: "paid" } });
        commerce.orders.mockRejectedValueOnce(new TypeError("History refresh lost"));
        fireEvent.click(pay);
        await screen.findByText(/订单历史刷新失败/);
        expect(commerce.testPay).toHaveBeenCalledOnce();
        expect(screen.queryByRole("button", { name: "确认测试付款" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "取消订单" })).not.toBeInTheDocument();
      } else {
        expect(await within(reopened).findByText(/服务器确认原下单请求已关闭/)).toBeInTheDocument();
        expect(within(reopened).getByRole("button", { name: "创建测试订单" })).toBeEnabled();
      }
    },
  );

  it("shows an older recovered receipt without replacing order history or pagination", async () => {
    const marker = "djl-commerce-order-attempt-v1:web:buyer-1";
    const key = crypto.randomUUID();
    sessionStorage.setItem(marker, key);
    const older: CommerceOrder = { ...order, id: "restored-order" };
    const recent: CommerceOrder = { ...order, id: "recent-order", status: "paid" };
    const another: CommerceOrder = { ...recent, id: "another-order" };
    commerce.orders.mockImplementation(async (page = 0) => ({
      orders: page === 0 ? [recent, another] : [older],
      page,
      hasMore: page === 0,
    }));
    commerce.recoverOrder.mockResolvedValue({ status: "found", order: older });
    render(<ShopClient />);
    navigate("订单");
    await screen.findByText("订单 recent-o");
    const verify = screen.getByRole("button", { name: "核实原下单请求" });
    fireEvent.click(verify);
    await screen.findByText("订单 restored");
    expect(screen.getByText("订单 recent-o")).toBeInTheDocument();
    expect(screen.getByText("订单 another-")).toBeInTheDocument();
    expect(screen.getByText("刚核实的原订单（不计入当前分页）")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认测试付款" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "取消订单" })).toBeEnabled();
    expect(sessionStorage.getItem(marker)).toBeNull();

    const next = screen.getByRole("button", { name: "下一页订单" });
    expect(next).toBeEnabled();
    fireEvent.click(next);
    await screen.findByText("第 2 页");
    expect(screen.getAllByText("订单 restored")).toHaveLength(1);
    expect(screen.queryByText("刚核实的原订单（不计入当前分页）")).not.toBeInTheDocument();
    expect(screen.queryByText("订单 recent-o")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一页订单" })).toBeEnabled();
    expect(next).toBeDisabled();
    expect(commerce.orders.mock.calls).toEqual([[0], [1]]);
    expect(commerce.recoverOrder).toHaveBeenCalledExactlyOnceWith("buyer-1", key);
    expect(commerce.createOrder).not.toHaveBeenCalled();
    expect(commerce.testPay).not.toHaveBeenCalled();
    expect(commerce.cancel).not.toHaveBeenCalled();
  });

  it("uses the recovered status for a matching history row without duplicating it", async () => {
    sessionStorage.setItem("djl-commerce-order-attempt-v1:web:buyer-1", crypto.randomUUID());
    const other: CommerceOrder = { ...order, id: "other-history-order", status: "paid" };
    commerce.orders.mockResolvedValue({ orders: [other, order], page: 0, hasMore: true });
    commerce.recoverOrder.mockResolvedValue({
      status: "found",
      order: { ...order, status: "paid" },
    });
    render(<ShopClient />);
    navigate("订单");
    await screen.findByRole("button", { name: "确认测试付款" });
    fireEvent.click(screen.getByRole("button", { name: "核实原下单请求" }));
    await screen.findByText(/服务器确认原订单已存在/);
    expect(screen.getAllByText("订单 order-1")).toHaveLength(1);
    expect(screen.getByText("订单 other-hi")).toBeInTheDocument();
    expect(screen.queryByText("刚核实的原订单（不计入当前分页）")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认测试付款" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消订单" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一页订单" })).toBeEnabled();
  });

  it("ignores a late recovered receipt after switching to another buyer", async () => {
    const marker = "djl-commerce-order-attempt-v1:web:buyer-1";
    const key = crypto.randomUUID();
    sessionStorage.setItem(marker, key);
    let finish!: (value: { status: "found"; order: CommerceOrder }) => void;
    commerce.recoverOrder.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const page = render(<ShopClient />);
    fireEvent.click(await screen.findByRole("button", { name: "核实原下单请求" }));
    expect(commerce.recoverOrder).toHaveBeenCalledExactlyOnceWith("buyer-1", key);

    authState.data = {
      session: { id: "different-buyer-session", token: "DO-NOT-RENDER-DIFFERENT-TOKEN" },
      user: { id: "buyer-2", name: "Buyer Two", email: "buyer2@test.invalid", emailVerified: true },
    };
    commerce.orders.mockResolvedValue({
      orders: [{ ...order, id: "other-buyer-order", status: "paid" }],
      page: 0,
      hasMore: false,
    });
    page.rerender(<ShopClient />);
    navigate("订单");
    await screen.findByText("订单 other-bu");
    await act(async () => finish({ status: "found", order }));
    expect(screen.getByText("订单 other-bu")).toBeInTheDocument();
    expect(screen.queryByText("订单 order-1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "核实原下单请求" })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(marker)).toBe(key);
  });

  it.each([
    ["malformed order", { order: { ...order, mode: "unexpected" } }],
    ["missing order", {}],
  ] as const)("retains the marker when the create reply has %s", async (_kind, reply) => {
    const marker = "djl-commerce-order-attempt-v1:web:buyer-1";
    commerce.createOrder.mockResolvedValueOnce(reply);
    const dialog = await openTestCheckout();
    submitTestOrder(dialog);
    const key = commerce.createOrder.mock.calls[0]![2];
    await waitFor(() => {
      expect(sessionStorage.getItem(marker)).toBe(key);
      expect(within(dialog).getByRole("button", { name: "核实原下单请求" })).toBeEnabled();
    });
    expect(within(dialog).getByRole("button", { name: "创建测试订单" })).toBeDisabled();
    expect(within(dialog).getByLabelText("地址")).toHaveValue("1 Test Road");
    expect(screen.getByRole("button", { name: "购物车，1件商品" })).toBeInTheDocument();
    expect(commerce.recoverOrder).not.toHaveBeenCalled();
    expect(commerce.testPay).not.toHaveBeenCalled();
  });

  it("fails closed without sending an order if the browser cannot save its recovery UUID", async () => {
    const dialog = await openTestCheckout();
    const original = Storage.prototype.setItem;
    const save = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key, value) {
        if (key.startsWith("djl-commerce-order-attempt-v1:")) throw new Error("Storage blocked");
        original.call(this, key, value);
      });
    try {
      submitTestOrder(dialog);
      expect(commerce.createOrder).not.toHaveBeenCalled();
      expect(commerce.recoverOrder).not.toHaveBeenCalled();
      expect(within(dialog).getByRole("alert")).toHaveTextContent(/本次未提交新订单/);
      expect(within(dialog).getByLabelText("地址")).toHaveValue("1 Test Road");
      expect(screen.getByRole("button", { name: "购物车，1件商品" })).toBeInTheDocument();
    } finally {
      save.mockRestore();
    }
  });

  it("isolates recovery markers by owner and realm and keeps them through sign-out", async () => {
    const own = "djl-commerce-order-attempt-v1:web:buyer-1";
    const other = "djl-commerce-order-attempt-v1:web:buyer-2";
    const scoped = "djl-commerce-order-attempt-v1:scoped:buyer-1";
    const first = crypto.randomUUID(),
      second = crypto.randomUUID(),
      third = crypto.randomUUID();
    sessionStorage.setItem(other, second);
    sessionStorage.setItem(scoped, third);
    const dialog = await openTestCheckout();
    expect(within(dialog).getByRole("button", { name: "创建测试订单" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "核实原下单请求" })).not.toBeInTheDocument();
    expect(commerce.recoverOrder).not.toHaveBeenCalled();

    cleanup();
    sessionStorage.setItem(own, first);
    render(<ShopClient />);
    await screen.findByRole("button", { name: "核实原下单请求" });
    navigate("我的");
    const logout = await screen.findByRole("button", { name: "退出商城账号" });
    await waitFor(() => expect(logout).toBeEnabled());
    fireEvent.click(logout);
    await screen.findByText(/商城账号已退出/);
    expect(screen.queryByRole("button", { name: "核实原下单请求" })).not.toBeInTheDocument();
    expect([own, other, scoped].map((key) => sessionStorage.getItem(key))).toEqual([
      first,
      second,
      third,
    ]);
    expect(commerce.recoverOrder).not.toHaveBeenCalled();
  });

  it("keeps the recovery lock on malformed or legacy responses and never clears a newer marker", async () => {
    const marker = "djl-commerce-order-attempt-v1:web:buyer-1";
    const first = crypto.randomUUID(),
      replacement = crypto.randomUUID();
    sessionStorage.setItem(marker, first);
    const dialog = await openTestCheckout(1, "");
    const verify = within(dialog).getByRole("button", { name: "核实原下单请求" });
    commerce.recoverOrder
      .mockResolvedValueOnce({ status: "found", order: { id: "not-a-complete-receipt" } })
      .mockRejectedValueOnce(new ApiError(404, "not_found", "Old backend", null));
    for (const count of [1, 2]) {
      fireEvent.click(verify);
      await within(dialog).findByText(/暂时无法核实原下单请求/);
      expect(commerce.recoverOrder).toHaveBeenCalledTimes(count);
      expect(sessionStorage.getItem(marker)).toBe(first);
      expect(within(dialog).getByRole("button", { name: "创建测试订单" })).toBeDisabled();
    }

    let finish!: (value: { status: "closed" }) => void;
    commerce.recoverOrder.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(verify);
    await waitFor(() => expect(commerce.recoverOrder).toHaveBeenCalledTimes(3));
    sessionStorage.setItem(marker, replacement);
    await act(async () => finish({ status: "closed" }));
    expect(sessionStorage.getItem(marker)).toBe(replacement);
    expect(within(dialog).getByRole("button", { name: "创建测试订单" })).toBeDisabled();
    expect(commerce.createOrder).not.toHaveBeenCalled();
  });

  it("only closes the matching marker after an authoritative checkout_attempt_closed retry", async () => {
    const marker = "djl-commerce-order-attempt-v1:web:buyer-1";
    commerce.createOrder
      .mockRejectedValueOnce(new TypeError("Original result unknown"))
      .mockRejectedValueOnce(new ApiError(409, "checkout_attempt_closed", "Original closed", null));
    const dialog = await openTestCheckout();
    submitTestOrder(dialog);
    const retry = await within(dialog).findByRole("button", { name: "重试原订单请求" });
    await waitFor(() => expect(retry).toBeEnabled());
    expect(sessionStorage.getItem(marker)).toBe(commerce.createOrder.mock.calls[0]![2]);
    fireEvent.click(retry);
    await within(dialog).findByText(/订单未创建，可以调整商品或地址后重新提交/);
    expect(sessionStorage.getItem(marker)).toBeNull();
    expect(commerce.createOrder.mock.calls[1]).toEqual(commerce.createOrder.mock.calls[0]);
    expect(commerce.recoverOrder).not.toHaveBeenCalled();
  });

  it("freezes an unknown order payload and key even if the first committed response was lost and form values change", async () => {
    const saved = new Map<string, CommerceOrder>();
    let loseResponse = true;
    commerce.createOrder.mockImplementation(async (items, address, key) => {
      if (!saved.has(key))
        saved.set(key, {
          ...order,
          address,
          totalCents: product.priceCents * items[0].quantity,
          items: [
            {
              ...order.items[0]!,
              quantity: items[0].quantity,
              lineCents: product.priceCents * items[0].quantity,
            },
          ],
        });
      if (loseResponse) {
        loseResponse = false;
        throw new TypeError("Response lost after commit");
      }
      return { order: saved.get(key) };
    });
    commerce.orders.mockImplementation(async () => ({ orders: [...saved.values()] }));
    const dialog = await openTestCheckout(2);
    submitTestOrder(dialog);
    await within(dialog).findByText(/订单创建结果尚未确认/);
    expect(within(dialog).getByLabelText("地址")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: `减少${product.name}` })).toBeDisabled();
    fillTestAddress(dialog, "Changed Road");
    submitTestOrder(dialog);
    expect(commerce.createOrder).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText(/刷新后不会保留收货地址/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "重试原订单请求" }));
    await screen.findByRole("button", { name: "确认测试付款" });
    expect(saved.size).toBe(1);
    expect(commerce.createOrder).toHaveBeenCalledTimes(2);
    expect(commerce.createOrder.mock.calls[1]).toEqual(commerce.createOrder.mock.calls[0]);
    expect(commerce.createOrder.mock.calls[1]![1].line1).toBe("1 Test Road");
    expect(commerce.testPay).not.toHaveBeenCalled();
  });
  it.each(["paid", "cancelled"] as const)(
    "shows the server's current %s order state after an unknown creation retry, not an unpaid claim",
    async (status) => {
      const currentOrder: CommerceOrder = {
        ...order,
        status,
        paidAt: status === "paid" ? "2026-10-01T12:10:00Z" : null,
      };
      commerce.createOrder
        .mockRejectedValueOnce(new TypeError("Response lost"))
        .mockResolvedValue({ order: currentOrder });
      commerce.orders
        .mockResolvedValueOnce({ orders: [] })
        .mockResolvedValue({ orders: [currentOrder] });
      const dialog = await openTestCheckout();
      submitTestOrder(dialog);
      await within(dialog).findByText(/订单创建结果尚未确认/);
      fireEvent.click(within(dialog).getByRole("button", { name: "重试原订单请求" }));
      await screen.findByText(/原订单已由服务器核实，请查看当前订单状态/);
      expect(
        screen.getByText(`${status === "paid" ? "测试付款成功" : "已取消"} · 测试订单`),
      ).toBeInTheDocument();
      expect(screen.queryByText(/订单已由服务器创建并预占库存；尚未付款/)).not.toBeInTheDocument();
      expect(commerce.createOrder).toHaveBeenCalledTimes(2);
      expect(commerce.createOrder.mock.calls[1]).toEqual(commerce.createOrder.mock.calls[0]);
      expect(commerce.testPay).not.toHaveBeenCalled();
      expect(commerce.cancel).not.toHaveBeenCalled();
    },
  );
  it.each([
    [503, "commerce_checkout_paused"],
    [403, "email_verification_required"],
    [400, "bad_request"],
    [409, "idempotency_conflict"],
  ])(
    "does not discard a previously unknown key after a pre-once %s/%s rejection",
    async (status, code) => {
      commerce.createOrder
        .mockRejectedValueOnce(new TypeError("Unknown response"))
        .mockRejectedValueOnce(
          new ApiError(Number(status), String(code), "Rejected before lookup", null),
        )
        .mockResolvedValue({ order });
      commerce.orders.mockResolvedValue({ orders: [order] });
      const dialog = await openTestCheckout();
      submitTestOrder(dialog);
      await within(dialog).findByText(/订单创建结果尚未确认/);
      fireEvent.click(within(dialog).getByRole("button", { name: "重试原订单请求" }));
      await waitFor(() => expect(commerce.createOrder).toHaveBeenCalledTimes(2));
      expect(within(dialog).getByLabelText("地址")).toBeDisabled();
      fillTestAddress(dialog, "Do not create another order");
      submitTestOrder(dialog);
      expect(commerce.createOrder).toHaveBeenCalledTimes(2);
      fireEvent.click(within(dialog).getByRole("button", { name: "重试原订单请求" }));
      await screen.findByRole("button", { name: "确认测试付款" });
      expect(commerce.createOrder.mock.calls[2]).toEqual(commerce.createOrder.mock.calls[0]);
    },
  );
  it.each([
    [400, "bad_request"],
    [409, "out_of_stock"],
    [429, "order_limit"],
  ])(
    "allows correction after a first definitive no-order %s/%s rejection",
    async (status, code) => {
      commerce.createOrder
        .mockRejectedValueOnce(new ApiError(Number(status), String(code), "Not created", null))
        .mockResolvedValue({ order });
      commerce.orders.mockResolvedValue({ orders: [order] });
      const dialog = await openTestCheckout(2);
      submitTestOrder(dialog);
      await within(dialog).findByText(/订单未创建，可以调整商品或地址后重新提交/);
      expect(within(dialog).getByLabelText("地址")).toBeEnabled();
      fireEvent.click(within(dialog).getByRole("button", { name: `减少${product.name}` }));
      fillTestAddress(dialog, "Corrected Road");
      submitTestOrder(dialog);
      await screen.findByRole("button", { name: "确认测试付款" });
      expect(commerce.createOrder.mock.calls[1]![2]).not.toBe(
        commerce.createOrder.mock.calls[0]![2],
      );
      expect(commerce.createOrder.mock.calls[1]![0]).toEqual([
        { productId: product.id, quantity: 1 },
      ]);
    },
  );
  it.each([
    [409, "out_of_stock"],
    [429, "order_limit"],
  ])(
    "keeps the unknown intention after a later %s/%s until atomic recovery closes it",
    async (status, code) => {
      const marker = "djl-commerce-order-attempt-v1:web:buyer-1";
      commerce.createOrder
        .mockRejectedValueOnce(new TypeError("Unknown response"))
        .mockRejectedValueOnce(
          new ApiError(Number(status), String(code), "No prior key; work rejected", null),
        )
        .mockResolvedValue({ order });
      commerce.orders.mockResolvedValue({ orders: [order] });
      const dialog = await openTestCheckout(2);
      submitTestOrder(dialog);
      await within(dialog).findByText(/订单创建结果尚未确认/);
      fireEvent.click(within(dialog).getByRole("button", { name: "重试原订单请求" }));
      await waitFor(() => expect(commerce.createOrder).toHaveBeenCalledTimes(2));
      const oldKey = commerce.createOrder.mock.calls[0]![2];
      expect(sessionStorage.getItem(marker)).toBe(oldKey);
      expect(within(dialog).getByLabelText("地址")).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "创建测试订单" })).toBeDisabled();
      submitTestOrder(dialog);
      expect(commerce.createOrder).toHaveBeenCalledTimes(2);
      commerce.recoverOrder.mockResolvedValue({ status: "closed" });
      const recover = within(dialog).getByRole("button", { name: "核实原下单请求" });
      await waitFor(() => expect(recover).toBeEnabled());
      fireEvent.click(recover);
      await within(dialog).findByText(/服务器确认原下单请求已关闭/);
      expect(commerce.recoverOrder).toHaveBeenCalledExactlyOnceWith("buyer-1", oldKey);
      expect(sessionStorage.getItem(marker)).toBeNull();
      fireEvent.click(within(dialog).getByRole("button", { name: `减少${product.name}` }));
      submitTestOrder(dialog);
      await screen.findByRole("button", { name: "确认测试付款" });
      expect(commerce.createOrder.mock.calls[1]).toEqual(commerce.createOrder.mock.calls[0]);
      expect(commerce.createOrder.mock.calls[2]![2]).not.toBe(
        commerce.createOrder.mock.calls[0]![2],
      );
    },
  );
  it("does not reinterpret a confirmed order as an unknown creation when its later history refresh fails", async () => {
    commerce.createOrder.mockResolvedValue({ order });
    commerce.orders
      .mockResolvedValueOnce({ orders: [] })
      .mockRejectedValueOnce(new TypeError("History offline"))
      .mockResolvedValue({ orders: [order] });
    const dialog = await openTestCheckout();
    submitTestOrder(dialog);
    await screen.findByText(/订单历史刷新失败/);
    expect(screen.getByText(/订单已由服务器创建并预占库存；尚未付款/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试原订单请求" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新订单" }));
    await waitFor(() => expect(commerce.orders).toHaveBeenCalledTimes(3));
    expect(commerce.createOrder).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "购物车，0件商品" })).toBeInTheDocument();
  });
  it("retains unavailable cart IDs and blocks partial checkout until the user explicitly removes them", async () => {
    sessionStorage.setItem(
      "djl-commerce-cart-v1",
      JSON.stringify({ [product.id]: 2, "missing-product": 1 }),
    );
    commerce.createOrder.mockResolvedValue({
      order: {
        ...order,
        totalCents: 7800,
        items: [{ ...order.items[0]!, quantity: 2, lineCents: 7800 }],
      },
    });
    render(<ShopClient />);
    await screen.findByText(product.name);
    await waitFor(() => expect(commerce.withdrawals).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "购物车，3件商品" }));
    const dialog = screen.getByRole("dialog", { name: "购物车与测试结账" });
    expect(within(dialog).getByText(/missing-product/)).toBeInTheDocument();
    expect(within(dialog).getByText("价格待核实")).toBeInTheDocument();
    expect(within(dialog).getByText(/可核价商品小计/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "创建测试订单" })).toBeDisabled();
    fillTestAddress(dialog);
    submitTestOrder(dialog);
    expect(commerce.createOrder).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "移除不可用商品 missing-product" }));
    expect(within(dialog).queryByText(/missing-product/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "创建测试订单" })).toBeEnabled();
    submitTestOrder(dialog);
    await waitFor(() => expect(commerce.createOrder).toHaveBeenCalledTimes(1));
    expect(commerce.createOrder.mock.calls[0]![0]).toEqual([
      { productId: product.id, quantity: 2 },
    ]);
  });
  it("does not describe cached choices as an empty cart while catalog information is unavailable", async () => {
    sessionStorage.setItem("djl-commerce-cart-v1", JSON.stringify({ [product.id]: 2 }));
    commerce.catalog.mockRejectedValue(new TypeError("Catalog offline"));
    render(<ShopClient />);
    await screen.findByText("商城服务暂时不可用");
    await waitFor(() => expect(commerce.withdrawals).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "购物车，2件商品" }));
    const dialog = screen.getByRole("dialog", { name: "购物车" });
    expect(within(dialog).getByText("价格待核实")).toBeInTheDocument();
    expect(within(dialog).queryByText(/购物车还是空的/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "创建测试订单" })).not.toBeInTheDocument();
    expect(dialog.querySelector("form")).toBeNull();
    expect(commerce.createOrder).not.toHaveBeenCalled();
  });
  it("preserves an overstock cart quantity and lets it safely decrease until it is orderable", async () => {
    commerce.catalog.mockResolvedValue({
      products: [{ ...product, stock: 2 }],
      currency: "CAD",
      mode: "test",
    });
    const dialog = await openTestCheckout(5);
    expect(within(dialog).getByRole("button", { name: "创建测试订单" })).toBeDisabled();
    submitTestOrder(dialog);
    expect(commerce.createOrder).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: `减少${product.name}` }));
    expect(screen.getByRole("button", { name: "购物车，4件商品" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "创建测试订单" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: `减少${product.name}` }));
    fireEvent.click(within(dialog).getByRole("button", { name: `减少${product.name}` }));
    expect(screen.getByRole("button", { name: "购物车，2件商品" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "创建测试订单" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: `增加${product.name}` })).toBeDisabled();
  });
  it("counts an unavailable SKU toward the 50-kind cap until it is explicitly removed", async () => {
    const catalog = Array.from({ length: 50 }, (_, index) => ({
      ...product,
      id: `sku-${index}`,
      name: `商品${index}`,
    }));
    commerce.catalog.mockResolvedValue({ products: catalog, currency: "CAD", mode: "test" });
    sessionStorage.setItem(
      "djl-commerce-cart-v1",
      JSON.stringify({
        ...Object.fromEntries(catalog.slice(0, 49).map((p) => [p.id, 1])),
        "missing-product": 1,
      }),
    );
    render(<ShopClient />);
    await screen.findByText("商品49");
    fireEvent.click(screen.getByRole("button", { name: "将商品49加入购物车" }));
    await screen.findByText("每单最多购买 50 种商品，请先移除一种再添加新商品。");
    fireEvent.click(screen.getByRole("button", { name: "购物车，50件商品" }));
    fireEvent.click(screen.getByRole("button", { name: "移除不可用商品 missing-product" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭购物车与测试结账" }));
    fireEvent.click(screen.getByRole("button", { name: "将商品49加入购物车" }));
    expect(screen.getByRole("button", { name: "购物车，50件商品" })).toBeInTheDocument();
  });
  it.each([
    ["paid", "shipped"],
    ["paid", "delivered"],
    ["refunded", "shipped"],
    ["refunded", "delivered"],
  ] as const)(
    "opens nonfinancial aftersales for a fully refunded %s/%s line without paying or refunding again",
    async (orderStatus, itemStatus) => {
      const line = {
        ...order.items[0]!,
        name: "已全退商品",
        refundedCents: 3900,
        status: itemStatus,
      };
      const sample: CommerceOrder = {
        ...order,
        status: orderStatus,
        totalCents: orderStatus === "paid" ? 7800 : 3900,
        refundedCents: 3900,
        items:
          orderStatus === "paid"
            ? [line, { ...order.items[0]!, id: "other-item", name: "其他未退款商品" }]
            : [line],
      };
      const opened = {
        ...sample,
        items: sample.items.map((item) =>
          item.id === line.id ? { ...item, openCase: true, afterSalesStatus: "open" } : item,
        ),
      };
      commerce.orders.mockResolvedValueOnce({ orders: [sample] }).mockResolvedValue({
        orders: [opened],
      });
      commerce.requestReturn.mockResolvedValue({ order: opened });
      render(<ShopClient />);
      await screen.findByText(product.name);
      navigate("订单");
      const target = (await screen.findByRole("heading", { name: "已全退商品" })).parentElement!;
      fireEvent.click(within(target).getByRole("button", { name: "申请售后" }));
      const dialog = screen.getByRole("dialog", { name: "申请售后" });
      fireEvent.change(within(dialog).getByLabelText("售后原因"), {
        target: { value: "  退款已处理，仍需安排实物退货  " },
      });
      fireEvent.submit(
        within(dialog).getByRole("button", { name: "提交售后申请" }).closest("form")!,
      );
      await screen.findByText(/售后申请已提交/);
      expect(commerce.requestReturn).toHaveBeenCalledWith(sample.id, {
        request: { itemId: line.id, reason: "退款已处理，仍需安排实物退货" },
        idempotencyKey: expect.any(String),
        expectedUserId: "buyer-1",
      });
      expect(commerce.testPay).not.toHaveBeenCalled();
      expect(commerce.createOrder).not.toHaveBeenCalled();
      expect(commerce.withdraw).not.toHaveBeenCalled();
      expect(commerce.cancel).not.toHaveBeenCalled();
    },
  );
  it("does not extend the fully refunded exception to unfulfilled or cancelled lines", async () => {
    commerce.orders.mockResolvedValue({
      orders: [
        {
          ...order,
          status: "refunded",
          totalCents: 11700,
          refundedCents: 11700,
          items: (["pending", "accepted", "cancelled"] as const).map((status) =>
            Object.assign({}, order.items[0]!, { id: status, refundedCents: 3900, status }),
          ),
        },
      ],
    });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("订单");
    await screen.findByRole("heading", { name: "我的订单" });
    expect(screen.queryByRole("button", { name: "申请售后" })).not.toBeInTheDocument();
    expect(commerce.requestReturn).not.toHaveBeenCalled();
  });
  it.each(["cancel", "account-refresh"] as const)(
    "keeps the new account checkout mounted when the old %s rejects with a late 401",
    async (operation) => {
      let fail!: (cause: Error) => void;
      const pending = new Promise<never>((_resolve, reject) => {
        fail = reject;
      });
      commerce.orders.mockResolvedValue({ orders: [order] });
      if (operation === "cancel") commerce.cancel.mockReturnValueOnce(pending);
      else
        commerce.me
          .mockResolvedValueOnce(initialProfile)
          .mockReturnValueOnce(pending)
          .mockResolvedValue(initialProfile);
      sessionStorage.setItem("djl-commerce-cart-v1", JSON.stringify({ [product.id]: 1 }));
      const view = render(<ShopClient />);
      await screen.findByText(product.name);
      await waitFor(() => expect(commerce.ledger).toHaveBeenCalledOnce());
      if (operation === "cancel") {
        navigate("订单");
        fireEvent.click(await screen.findByRole("button", { name: "取消订单" }));
        await waitFor(() => expect(commerce.cancel).toHaveBeenCalledOnce());
      } else {
        navigate("我的");
        await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
        fireEvent.click(screen.getByRole("button", { name: "刷新" }));
        await waitFor(() => expect(commerce.me).toHaveBeenCalledTimes(2));
      }
      commerce.orders.mockResolvedValue({ orders: [] });
      authState = {
        ...authState,
        data: {
          session: { id: "buyer-b-session", token: "synthetic-b-never-render" },
          user: {
            id: "buyer-2",
            name: "Buyer Two",
            email: "buyer2@test.invalid",
            emailVerified: true,
          },
        },
      };
      view.rerender(<ShopClient />);
      const expectedMeCalls = operation === "cancel" ? 2 : 3;
      await waitFor(() => expect(commerce.me).toHaveBeenCalledTimes(expectedMeCalls));
      navigate("我的");
      await screen.findByRole("region", { name: "商城账号身份" });
      expect(screen.getByRole("region", { name: "商城账号身份" })).toHaveTextContent(
        "buyer2@test.invalid",
      );
      fireEvent.click(screen.getByRole("button", { name: "购物车，1件商品" }));
      const dialog = screen.getByRole("dialog", { name: "购物车与测试结账" });
      fillTestAddress(dialog, "B synthetic address - keep without submission");
      await waitFor(() =>
        expect(within(dialog).getByRole("button", { name: "创建测试订单" })).toBeEnabled(),
      );
      const catalogReads = commerce.catalog.mock.calls.length;
      await act(async () => fail(new ApiError(401, "unauthorized", "Late old failure", null)));
      expect(dialog).toBeInTheDocument();
      expect(within(dialog).getByLabelText("地址")).toHaveValue(
        "B synthetic address - keep without submission",
      );
      expect(screen.getByRole("region", { name: "商城账号身份" })).toHaveTextContent(
        "buyer2@test.invalid",
      );
      expect(commerce.me).toHaveBeenCalledTimes(expectedMeCalls);
      expect(commerce.catalog).toHaveBeenCalledTimes(catalogReads);
      expect(commerce.cancel).toHaveBeenCalledTimes(operation === "cancel" ? 1 : 0);
      expect(commerce.testPay).not.toHaveBeenCalled();
      expect(commerce.createOrder).not.toHaveBeenCalled();
      expect(auth.signOut).not.toHaveBeenCalled();
    },
  );
  it("does not invalidate the new account when an old image upload rejects with a late 401", async () => {
    let fail!: (cause: Error) => void;
    uploadCommerceImage.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const view = render(<ShopClient />);
    await screen.findByText(product.name);
    await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
    navigate("图片找商品");
    fireEvent.change(screen.getByLabelText("上传找货图片"), {
      target: { files: [new File(["A"], "a.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
    await waitFor(() => expect(uploadCommerceImage).toHaveBeenCalledOnce());
    authState = {
      ...authState,
      data: {
        session: { id: "B-session", token: "B-never-render" },
        user: {
          id: "buyer-2",
          name: "Buyer Two",
          email: "buyer2@test.invalid",
          emailVerified: true,
        },
      },
    };
    view.rerender(<ShopClient />);
    await waitFor(() => expect(commerce.me).toHaveBeenCalledTimes(2));
    await act(async () => fail(new ApiError(401, "unauthorized", "Late old failure", null)));
    expect(commerce.me).toHaveBeenCalledTimes(2);
    expect(commerce.searchImage).not.toHaveBeenCalled();
  });
  it.each(["unmount", "other-account", "same-account-session", "ABA"] as const)(
    "does not start image search after a delayed upload loses its %s scope",
    async (change) => {
      let finish!: (id: string) => void;
      uploadCommerceImage.mockReturnValueOnce(
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
      );
      commerce.searchImage.mockResolvedValue({ products: [] });
      const original = authState;
      const view = render(<ShopClient />);
      await screen.findByText(product.name);
      await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
      navigate("图片找商品");
      fireEvent.change(screen.getByLabelText("上传找货图片"), {
        target: { files: [new File(["A"], "a.png", { type: "image/png" })] },
      });
      fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
      await waitFor(() => expect(uploadCommerceImage).toHaveBeenCalledOnce());
      const context = uploadCommerceImage.mock.calls[0]![1];
      if (change === "unmount") view.unmount();
      else {
        authState = {
          ...original,
          data: {
            session: { ...original.data!.session, id: "replacement-session" },
            user:
              change === "same-account-session"
                ? original.data!.user
                : { ...original.data!.user, id: "buyer-2" },
          },
        };
        view.rerender(<ShopClient />);
        await waitFor(() => expect(commerce.me).toHaveBeenCalledTimes(2));
        expect(screen.getByRole("heading", { name: "图片找商品" })).toBeInTheDocument();
        expect((screen.getByLabelText("上传找货图片") as HTMLInputElement).files).toHaveLength(0);
        if (change === "ABA") {
          authState = original;
          view.rerender(<ShopClient />);
          await waitFor(() => expect(commerce.me).toHaveBeenCalledTimes(3));
          expect((screen.getByLabelText("上传找货图片") as HTMLInputElement).files).toHaveLength(0);
        }
      }
      await act(async () => finish("old-account-file"));
      expect(commerce.searchImage).not.toHaveBeenCalled();
      expect(context).toMatchObject({ expectedUserId: "buyer-1" });
      expect(context.signal.aborted).toBe(true);
    },
  );
  it("does not begin an upload after a late crop finishes on an unmounted account", async () => {
    let finish!: (file: File) => void;
    centerCropImage.mockReturnValueOnce(
      new Promise<File>((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<ShopClient />);
    await screen.findByText(product.name);
    await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
    navigate("图片找商品");
    fireEvent.change(screen.getByLabelText("上传找货图片"), {
      target: { files: [new File(["A"], "a.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
    await waitFor(() => expect(centerCropImage).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => finish(new File(["cropped A"], "a-crop.png", { type: "image/png" })));
    expect(uploadCommerceImage).not.toHaveBeenCalled();
    expect(commerce.searchImage).not.toHaveBeenCalled();
    expect(centerCropImage.mock.calls[0]![1].aborted).toBe(true);
  });
  it("creates a fresh usable image scope after StrictMode effect replay and forwards one signal through all stages", async () => {
    commerce.searchImage.mockResolvedValue({ products: [] });
    render(
      <StrictMode>
        <ShopClient />
      </StrictMode>,
    );
    await screen.findByText(product.name);
    await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
    navigate("图片找商品");
    fireEvent.change(screen.getByLabelText("上传找货图片"), {
      target: { files: [new File(["A"], "a.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
    await waitFor(() => expect(commerce.searchImage).toHaveBeenCalledOnce());
    const context = uploadCommerceImage.mock.calls[0]![1];
    expect(context).toMatchObject({ expectedUserId: "buyer-1" });
    expect(context.signal.aborted).toBe(false);
    expect(centerCropImage.mock.calls[0]![1]).toBe(context.signal);
    expect(commerce.searchImage).toHaveBeenCalledWith("uploaded-image-1", "", context.signal);
  });
  it("sends the visible crop focus to encoding and resets focus for a new photo", async () => {
    commerce.searchImage.mockResolvedValue({ products: [] });
    render(<ShopClient />);
    await screen.findByText(product.name);
    await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
    navigate("图片找商品");
    const choose = (name: string) =>
      fireEvent.change(screen.getByLabelText("上传找货图片"), {
        target: { files: [new File(["image"], name, { type: "image/png" })] },
      });
    choose("first.png");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByRole("slider", { name: "裁剪水平位置" }), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "裁剪垂直位置" }), {
      target: { value: "0" },
    });
    expect(screen.getByAltText("将上传预览中的方形区域")).toHaveStyle({
      objectPosition: "100% 0%",
    });
    fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
    await waitFor(() => expect(commerce.searchImage).toHaveBeenCalledOnce());
    expect(centerCropImage.mock.calls[0]![2]).toEqual({ x: 1, y: 0 });
    choose("second.png");
    expect(screen.getByRole("slider", { name: "裁剪水平位置" })).toHaveValue("50");
    expect(screen.getByRole("slider", { name: "裁剪垂直位置" })).toHaveValue("50");
  });
  it.each(["description", "crop mode", "horizontal focus", "vertical focus", "photo"] as const)(
    "clears previous matches and their notice when the buyer changes %s",
    async (change) => {
      const found = { ...product, id: "find-old-match", name: "首次找货示例商品" };
      const resultNotice = "本次检索的候选仅供比较。";
      commerce.searchImage.mockResolvedValue({ products: [found], message: resultNotice });
      render(<ShopClient />);
      await screen.findByText(product.name);
      await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
      navigate("图片找商品");
      const choose = (name: string) =>
        fireEvent.change(screen.getByLabelText("上传找货图片"), {
          target: { files: [new File(["image"], name, { type: "image/png" })] },
        });
      choose("first.png");
      if (change.endsWith("focus")) fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
      await screen.findByText(found.name);
      expect(screen.getByText(resultNotice)).toBeInTheDocument();

      if (change === "description") {
        fireEvent.change(screen.getByRole("textbox", { name: "补充描述（可选）" }), {
          target: { value: "换一个描述" },
        });
      } else if (change === "crop mode") {
        fireEvent.click(screen.getByRole("checkbox"));
      } else if (change === "photo") {
        choose("replacement.png");
      } else {
        const name = change === "horizontal focus" ? "裁剪水平位置" : "裁剪垂直位置";
        fireEvent.change(screen.getByRole("slider", { name }), { target: { value: "75" } });
      }
      expect(screen.queryByText(found.name)).not.toBeInTheDocument();
      expect(screen.queryByText(resultNotice)).not.toBeInTheDocument();
      expect(screen.getByText(/还没有搜索结果/)).toBeInTheDocument();
      expect(screen.getByAltText(/你选择的找货图片|将上传预览中的方形区域/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "查找相似商品" })).toBeEnabled();
      expect(uploadCommerceImage).toHaveBeenCalledOnce();
      expect(commerce.searchImage).toHaveBeenCalledOnce();
    },
  );
  it("dismisses the failed crop alert when crop is disabled and lets the buyer retry the original photo", async () => {
    const alert = "浏览器不支持图片裁剪，可以取消裁剪后上传原图。";
    const original = new File(["image"], "original.png", { type: "image/png" });
    centerCropImage.mockRejectedValueOnce(new Error(alert));
    commerce.searchImage.mockResolvedValue({ products: [] });
    render(<ShopClient />);
    await screen.findByText(product.name);
    await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
    navigate("图片找商品");
    fireEvent.change(screen.getByLabelText("上传找货图片"), { target: { files: [original] } });
    const description = screen.getByRole("textbox", { name: "补充描述（可选）" });
    fireEvent.change(description, { target: { value: "保留描述" } });
    const crop = screen.getByRole("checkbox");
    fireEvent.click(crop);
    fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(alert);
    expect(uploadCommerceImage).not.toHaveBeenCalled();

    fireEvent.click(crop);
    expect(screen.queryByText(alert)).not.toBeInTheDocument();
    expect(screen.getByAltText("你选择的找货图片")).toBeInTheDocument();
    expect(description).toHaveValue("保留描述");
    fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
    await screen.findByText("暂时没有合适商品");
    expect(centerCropImage).toHaveBeenCalledOnce();
    expect(uploadCommerceImage).toHaveBeenCalledExactlyOnceWith(original, {
      expectedUserId: "buyer-1",
      signal: expect.any(AbortSignal),
    });
    expect(commerce.searchImage).toHaveBeenCalledWith(
      "uploaded-image-1",
      "保留描述",
      expect.any(AbortSignal),
    );
  });

  it.each(["description", "horizontal focus", "vertical focus"] as const)(
    "dismisses a previous lookup alert when the buyer changes %s",
    async (change) => {
      const alert = "旧图片检索失败";
      commerce.searchImage.mockRejectedValueOnce(new Error(alert));
      render(<ShopClient />);
      await screen.findByText(product.name);
      await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
      navigate("图片找商品");
      fireEvent.change(screen.getByLabelText("上传找货图片"), {
        target: { files: [new File(["image"], "photo.png", { type: "image/png" })] },
      });
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(alert);

      const input =
        change === "description"
          ? screen.getByRole("textbox", { name: "补充描述（可选）" })
          : screen.getByRole("slider", {
              name: change === "horizontal focus" ? "裁剪水平位置" : "裁剪垂直位置",
            });
      fireEvent.change(input, { target: { value: change === "description" ? "新的描述" : "75" } });
      expect(screen.queryByText(alert)).not.toBeInTheDocument();
      expect(screen.getByAltText("将上传预览中的方形区域")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "查找相似商品" })).toBeEnabled();
      expect(commerce.searchImage).toHaveBeenCalledOnce();
    },
  );

  it("reuses the completed photo for a changed description and a failed lookup", async () => {
    commerce.searchImage
      .mockRejectedValueOnce(new ApiError(502, "image_search_failed", "model unavailable", null))
      .mockResolvedValue({ products: [] });
    render(<ShopClient />);
    await screen.findByText(product.name);
    await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
    navigate("图片找商品");
    const photo = new File(["image"], "retry.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("上传找货图片"), { target: { files: [photo] } });
    const submit = screen.getByRole("button", { name: "查找相似商品" });
    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent("这次图片找货未能完成");
    const description = screen.getByRole("textbox", { name: "补充描述（可选）" });
    fireEvent.change(description, { target: { value: "更浅的帆布包" } });
    expect(commerce.searchImage).toHaveBeenCalledTimes(1);
    fireEvent.click(submit);
    await screen.findByText("暂时没有合适商品");
    expect(uploadCommerceImage).toHaveBeenCalledOnce();
    expect(commerce.searchImage.mock.calls.map(([id, text]) => [id, text])).toEqual([
      ["uploaded-image-1", ""],
      ["uploaded-image-1", "更浅的帆布包"],
    ]);
    expect(commerce.searchImage.mock.calls[1]?.[2]).not.toBe(
      commerce.searchImage.mock.calls[0]?.[2],
    );
  });

  it("requires a new explicit click after the server invalidates a previously uploaded photo", async () => {
    uploadCommerceImage.mockResolvedValueOnce("initial-ready").mockResolvedValueOnce("new-ready");
    commerce.searchImage
      .mockResolvedValueOnce({ products: [] })
      .mockRejectedValueOnce(new ApiError(404, "file_unavailable", "Image is unavailable.", null))
      .mockResolvedValueOnce({ products: [] });
    render(<ShopClient />);
    await screen.findByText(product.name);
    await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
    navigate("图片找商品");
    fireEvent.change(screen.getByLabelText("上传找货图片"), {
      target: { files: [new File(["image"], "expires.png", { type: "image/png" })] },
    });
    const submit = screen.getByRole("button", { name: "查找相似商品" });
    fireEvent.click(submit);
    await screen.findByText("暂时没有合适商品");
    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent("请再次点击查找以重新上传");
    expect(uploadCommerceImage).toHaveBeenCalledOnce();
    expect(commerce.searchImage).toHaveBeenCalledTimes(2);
    fireEvent.click(submit);
    await screen.findByText("暂时没有合适商品");
    expect(uploadCommerceImage).toHaveBeenCalledTimes(2);
    expect(commerce.searchImage.mock.calls.map(([id]) => id)).toEqual([
      "initial-ready",
      "initial-ready",
      "new-ready",
    ]);
  });

  it("never reuses a photo after its local freshness bound, a crop change, or a replacement", async () => {
    let now = 1_797_000_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      uploadCommerceImage.mockImplementation(
        async () => `photo-${uploadCommerceImage.mock.calls.length}`,
      );
      commerce.searchImage.mockResolvedValue({ products: [] });
      render(<ShopClient />);
      await screen.findByText(product.name);
      await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
      navigate("图片找商品");
      const picker = screen.getByLabelText("上传找货图片");
      const choose = () =>
        fireEvent.change(picker, {
          target: { files: [new File(["image"], "same.png", { type: "image/png" })] },
        });
      const submit = screen.getByRole("button", { name: "查找相似商品" });
      const search = async () => {
        fireEvent.click(submit);
        await screen.findByText("暂时没有合适商品");
      };
      choose();
      await search();
      now += 28 * 60_000;
      await search();
      now += 60_000;
      await search();
      fireEvent.click(screen.getByRole("checkbox"));
      await search();
      fireEvent.change(screen.getByRole("slider", { name: "裁剪水平位置" }), {
        target: { value: "75" },
      });
      await search();
      choose();
      await search();
      expect(commerce.searchImage.mock.calls.map(([id]) => id)).toEqual([
        "photo-1",
        "photo-1",
        "photo-2",
        "photo-3",
        "photo-4",
        "photo-5",
      ]);
    } finally {
      clock.mockRestore();
    }
  });

  it.each(["empty result", "disabled provider"] as const)(
    "lets a buyer carry their description into text search after %s",
    async (outcome) => {
      if (outcome === "empty result") commerce.searchImage.mockResolvedValue({ products: [] });
      else
        commerce.searchImage.mockRejectedValue(
          new ApiError(503, "image_search_unavailable", "Not configured", null),
        );
      render(<ShopClient />);
      await screen.findByText(product.name);
      await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
      navigate("图片找商品");
      fireEvent.change(screen.getByLabelText("上传找货图片"), {
        target: { files: [new File(["image"], "bag.png", { type: "image/png" })] },
      });
      fireEvent.change(screen.getByRole("textbox", { name: "补充描述（可选）" }), {
        target: { value: "  帆布包  " },
      });
      fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
      await userEvent.click(await screen.findByRole("button", { name: "改用文字搜索" }));
      const search = screen.getByRole("textbox", { name: "搜索商品" });
      expect(search).toHaveFocus();
      expect(search).toHaveValue("帆布包");
      expect(screen.getByText(product.name)).toBeInTheDocument();
      expect(uploadCommerceImage).toHaveBeenCalledOnce();
      expect(commerce.searchImage).toHaveBeenCalledOnce();
      expect(commerce.catalog).toHaveBeenCalledOnce();
    },
  );

  it("keeps the picker validation alert while no valid photo is selected", async () => {
    render(<ShopClient />);
    await screen.findByText(product.name);
    await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
    navigate("图片找商品");
    fireEvent.change(screen.getByLabelText("上传找货图片"), {
      target: { files: [new File(["invalid"], "bad.txt", { type: "text/plain" })] },
    });
    const validation = "请选择大于 0 且不超过 10 MB 的 JPEG、PNG 或 WebP 图片。";
    expect(screen.getByRole("alert")).toHaveTextContent(validation);
    fireEvent.change(screen.getByRole("textbox", { name: "补充描述（可选）" }), {
      target: { value: "仍需要换一张图片" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("alert")).toHaveTextContent(validation);
    expect(screen.getByRole("button", { name: "查找相似商品" })).toBeDisabled();
    expect(uploadCommerceImage).not.toHaveBeenCalled();
  });

  it("announces the selected photo after leaving and returning, and keeps it if replacement is canceled", async () => {
    const user = userEvent.setup();
    commerce.searchImage.mockResolvedValue({ products: [] });
    render(<ShopClient />);
    await screen.findByText(product.name);
    await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
    navigate("图片找商品");
    const choose = screen.getByRole("button", { name: "选择照片或截图" });
    const picker = screen.getByLabelText("上传找货图片") as HTMLInputElement;
    const open = vi.spyOn(picker, "click").mockImplementation(() => {});
    choose.focus();
    await user.keyboard("{Enter}");
    expect(open).toHaveBeenCalledOnce();
    open.mockRestore();

    const photo = new File(["image"], "outfit.png", { type: "image/png" });
    await user.upload(picker, photo);
    expect(screen.getByText("已选择：outfit.png")).toHaveAttribute("role", "status");
    const reselected = vi.fn();
    picker.addEventListener("change", reselected);
    const reopen = vi.spyOn(picker, "click").mockImplementation(() => {
      expect(picker.value).toBe("");
    });
    screen.getByRole("button", { name: "更换图片" }).focus();
    await user.keyboard("{Enter}");
    expect(reopen).toHaveBeenCalledOnce();
    reopen.mockRestore();
    await user.upload(picker, photo);
    expect(reselected).toHaveBeenCalledOnce();
    navigate("商城");
    navigate("图片找商品");
    const returnedPicker = screen.getByLabelText("上传找货图片") as HTMLInputElement;
    expect(returnedPicker).not.toBe(picker);
    expect(returnedPicker.files).toHaveLength(0);
    const replace = screen.getByRole("button", { name: "更换图片" });
    expect(replace).toHaveAccessibleDescription(/已选择：outfit\.png/);
    fireEvent.change(returnedPicker, { target: { files: [] } });
    expect(screen.getByText("已选择：outfit.png")).toHaveAttribute("role", "status");
    expect(screen.getByAltText("你选择的找货图片")).toBeInTheDocument();
    expect(screen.getByText("相似推荐，不保证同款")).toBeInTheDocument();
    expect(uploadCommerceImage).not.toHaveBeenCalled();
    expect(commerce.searchImage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
    await screen.findByRole("heading", { name: "暂时没有合适商品" });
    expect(uploadCommerceImage).toHaveBeenCalledOnce();
    expect(uploadCommerceImage.mock.calls[0]?.[0]).toBe(photo);
  });

  it.each(["result", "error"] as const)(
    "clears the selected photo and its old %s with the keyboard without losing text or cart",
    async (outcome) => {
      const user = userEvent.setup();
      const match = { ...product, id: "clear-photo-match", name: "可清除的找货结果" };
      if (outcome === "result")
        commerce.searchImage.mockResolvedValue({ products: [match], message: "仅供比较" });
      else commerce.searchImage.mockRejectedValue(new Error("旧图片检索失败"));
      render(<ShopClient />);
      await screen.findByText(product.name);
      await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
      fireEvent.click(screen.getByRole("button", { name: `将${product.name}加入购物车` }));
      navigate("图片找商品");
      const picker = screen.getByLabelText("上传找货图片") as HTMLInputElement;
      const photo = new File(["image"], "same.png", { type: "image/png" });
      const description = screen.getByRole("textbox", { name: "补充描述（可选）" });
      fireEvent.change(description, { target: { value: "保留这段描述" } });
      await user.upload(picker, photo);
      fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
      await screen.findByText(outcome === "result" ? match.name : "旧图片检索失败");

      const clear = screen.getByRole("button", { name: "清除图片" });
      clear.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("button", { name: "选择照片或截图" })).toHaveFocus();
      expect(picker.files).toHaveLength(0);
      expect(screen.queryByAltText("你选择的找货图片")).not.toBeInTheDocument();
      expect(screen.queryByText(match.name)).not.toBeInTheDocument();
      expect(screen.queryByText("仅供比较")).not.toBeInTheDocument();
      expect(screen.queryByText("旧图片检索失败")).not.toBeInTheDocument();
      expect(description).toHaveValue("保留这段描述");
      expect(screen.getByRole("button", { name: "购物车，1件商品" })).toBeInTheDocument();
      expect(screen.getByText("已加入购物车", { exact: true })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "查找相似商品" })).toBeDisabled();

      await user.upload(picker, photo);
      expect(screen.getByAltText("你选择的找货图片")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "查找相似商品" })).toBeEnabled();
      expect(commerce.searchImage).toHaveBeenCalledOnce();
    },
  );

  it.each(["result", "401"] as const)(
    "cancels an active image search and ignores its late %s while a replacement is busy",
    async (outcome) => {
      const oldMatch = { ...product, id: "old-cancelled-image", name: "已取消图片的迟到商品" };
      const newMatch = { ...product, id: "new-image", name: "新图片的结果" };
      type Match = { products: CommerceProduct[]; message: string };
      let finishOld!: (result: Match) => void;
      let failOld!: (error: Error) => void;
      let finishNew!: (result: Match) => void;
      commerce.searchImage
        .mockImplementationOnce(
          () =>
            new Promise<Match>((resolve, reject) => {
              finishOld = resolve;
              failOld = reject;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<Match>((resolve) => {
              finishNew = resolve;
            }),
        );
      render(<ShopClient />);
      await screen.findByText(product.name);
      await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
      navigate("图片找商品");
      const picker = screen.getByLabelText("上传找货图片");
      const choose = (name: string) =>
        fireEvent.change(picker, {
          target: { files: [new File(["image"], name, { type: "image/png" })] },
        });
      choose("old.png");
      fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
      await waitFor(() => expect(commerce.searchImage).toHaveBeenCalledOnce());
      const oldSignal = commerce.searchImage.mock.calls[0]![2] as AbortSignal;

      fireEvent.click(screen.getByRole("button", { name: "清除图片" }));
      expect(oldSignal.aborted).toBe(true);
      expect(picker).toBeEnabled();
      choose("new.png");
      fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
      await waitFor(() => expect(commerce.searchImage).toHaveBeenCalledTimes(2));

      await act(async () => {
        if (outcome === "result") finishOld({ products: [oldMatch], message: "旧请求提示" });
        else failOld(new ApiError(401, "unauthorized", "旧请求提示", null));
      });
      expect(screen.getByRole("button", { name: "正在查找…" })).toBeDisabled();
      expect(screen.queryByText("旧请求提示")).not.toBeInTheDocument();
      expect(screen.queryByText(oldMatch.name)).not.toBeInTheDocument();
      expect(commerce.me).toHaveBeenCalledOnce();
      expect(auth.signOut).not.toHaveBeenCalled();

      await act(async () => finishNew({ products: [newMatch], message: "新的提示" }));
      expect(await screen.findByText(newMatch.name)).toBeInTheDocument();
      navigate("商城");
      expect(screen.queryByText(oldMatch.name)).not.toBeInTheDocument();
    },
  );
  it("locks the description during lookup and keeps a later cart notice when the description is edited", async () => {
    const found = { ...product, id: "find-draft-match", name: "旧描述的示例商品" };
    let finish!: (result: { products: CommerceProduct[]; message: string }) => void;
    commerce.searchImage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<ShopClient />);
    await screen.findByText(product.name);
    await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
    navigate("图片找商品");
    fireEvent.change(screen.getByLabelText("上传找货图片"), {
      target: { files: [new File(["image"], "first.png", { type: "image/png" })] },
    });
    const description = screen.getByRole("textbox", { name: "补充描述（可选）" });
    fireEvent.change(description, { target: { value: "旧描述" } });
    fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
    await waitFor(() => expect(commerce.searchImage).toHaveBeenCalledOnce());
    expect(commerce.searchImage).toHaveBeenCalledWith(
      "uploaded-image-1",
      "旧描述",
      expect.any(AbortSignal),
    );
    expect(description).toBeDisabled();
    await act(async () => finish({ products: [found], message: "旧描述的相似线索" }));
    expect(description).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: `将${found.name}加入购物车` }));
    fireEvent.change(description, { target: { value: "新描述" } });
    expect(screen.getByText("已加入购物车", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "购物车，1件商品" })).toBeInTheDocument();
    expect(screen.queryByText(found.name)).not.toBeInTheDocument();
    expect(screen.queryByText("旧描述的相似线索")).not.toBeInTheDocument();
    expect(commerce.searchImage).toHaveBeenCalledOnce();
  });
  it.each([
    {
      method: "orders",
      view: "订单",
      label: "订单历史",
      empty: "还没有订单",
      result: { orders: [] },
    },
    {
      method: "withdrawals",
      view: "我的",
      label: "提现历史",
      empty: "暂无提现申请。所有记录以服务器为准。",
      result: { withdrawals: [] },
    },
    {
      method: "ledger",
      view: "我的",
      label: "收益流水",
      empty: "暂无收益流水。",
      result: { entries: [] },
    },
  ] as const)(
    "does not call failed $method reads empty and retries that history independently",
    async ({ method, view, label, empty, result }) => {
      commerce[method]
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValue(result);
      render(<ShopClient />);
      await screen.findByText(product.name);
      navigate(view);
      await screen.findByText(`${label}尚未读取成功，不能据此判断没有历史记录。`);
      expect(screen.queryByText(empty)).not.toBeInTheDocument();
      const others = (["orders", "withdrawals", "ledger"] as const).filter((key) => key !== method);
      const otherCalls = others.map((key) => commerce[key].mock.calls.length);
      fireEvent.click(screen.getByRole("button", { name: `重新读取${label}` }));
      await screen.findByText(empty);
      others.forEach((key, index) =>
        expect(commerce[key]).toHaveBeenCalledTimes(otherCalls[index]!),
      );
    },
  );
  it("does not claim history is empty before its first reads finish", async () => {
    for (const key of ["orders", "withdrawals", "ledger"] as const)
      commerce[key].mockImplementation(() => new Promise(() => {}));
    render(<ShopClient />);
    await waitFor(() => expect(commerce.orders).toHaveBeenCalled());
    navigate("订单");
    expect(screen.getByText("正在读取订单历史…")).toBeInTheDocument();
    expect(screen.queryByText("还没有订单")).not.toBeInTheDocument();
    navigate("我的");
    expect(screen.getByText("正在读取提现历史…")).toBeInTheDocument();
    expect(screen.getByText("正在读取收益流水…")).toBeInTheDocument();
    expect(screen.queryByText(/暂无提现申请|暂无收益流水/)).not.toBeInTheDocument();
  });
  it.each([
    {
      method: "orders",
      view: "订单",
      label: "订单历史",
      record: /订单 order-1/,
      refresh: "刷新订单",
    },
    {
      method: "withdrawals",
      view: "我的",
      label: "提现历史",
      record: /测试凭证 TEST-HISTORY/,
      refresh: "刷新",
    },
    {
      method: "ledger",
      view: "我的",
      label: "收益流水",
      record: /test-history-entry/,
      refresh: "刷新",
    },
  ] as const)(
    "keeps previously read $method records visibly stale after a refresh failure",
    async ({ method, view, label, record, refresh }) => {
      commerce.orders.mockResolvedValue({ orders: [order] });
      commerce.withdrawals.mockResolvedValue({
        withdrawals: [
          {
            id: "withdrawal-history",
            amountCents: 2500,
            status: "paid_test",
            reference: "TEST-HISTORY",
            createdAt: "2026-10-01T12:00:00Z",
          },
        ],
      });
      commerce.ledger.mockResolvedValue({
        entries: [
          {
            id: "entry-history",
            account: "paid",
            amountCents: 2500,
            eventKey: "test-history-entry",
            createdAt: "2026-10-01T12:00:00Z",
          },
        ],
      });
      render(<ShopClient />);
      await screen.findByText(product.name);
      navigate(view);
      await screen.findByText(record);
      commerce[method].mockRejectedValueOnce(new TypeError("Failed to fetch"));
      fireEvent.click(screen.getByRole("button", { name: refresh }));
      await screen.findByText(`${label}刷新失败，保留上次读取的记录，可能已过期；请重试核实。`);
      expect(screen.getByText(record)).toBeInTheDocument();
    },
  );
  it.each(["changed-user", "unauthorized"] as const)(
    "does not trust cached buyer A before the first fresh session confirms %s",
    async (outcome) => {
      const cached = authState;
      let finish!: () => void;
      auth.refetch.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = () => {
              authState =
                outcome === "changed-user"
                  ? {
                      data: {
                        session: { id: "fresh-b-session", token: "fresh-not-shown" },
                        user: {
                          id: "buyer-2",
                          name: "Fresh Buyer B",
                          email: "fresh-b@test.invalid",
                          emailVerified: true,
                        },
                      },
                      isPending: false,
                      error: null,
                    }
                  : { ...authState, error: { status: 401 } };
              auth.useSession.mockReturnValue({ ...cached, refetch: auth.refetch });
              resolve();
            };
          }),
      );
      commerce.me.mockResolvedValue({
        ...initialProfile,
        wallet: { ...initialProfile.wallet, availableCents: 6789 },
      });
      render(<ShopClient />);
      await screen.findByText(product.name);
      expect(auth.refetch).toHaveBeenCalledOnce();
      expect(auth.refetch).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
      expect(commerce.me).not.toHaveBeenCalled();
      expect(commerce.orders).not.toHaveBeenCalled();
      navigate("我的");
      expect(screen.queryByText(/buyer1@test.invalid/)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "申请测试提现" })).not.toBeInTheDocument();
      await act(async () => finish());
      navigate("我的");
      if (outcome === "changed-user") {
        await screen.findByText("CAD 67.89");
        expect(screen.getByRole("region", { name: "商城账号身份" })).toHaveTextContent(
          "fresh-b@test.invalid",
        );
      } else {
        await screen.findByText("暂时无法核实账号身份，请重新登录。");
        expect(commerce.me).not.toHaveBeenCalled();
        expect(screen.queryByRole("button", { name: "申请测试提现" })).not.toBeInTheDocument();
      }
      expect(screen.queryByText(/buyer1@test.invalid/)).not.toBeInTheDocument();
      expect(auth.refetch).toHaveBeenCalledOnce();
    },
  );
  it("rechecks a cached signed-out session after verification before loading authenticated commerce data", async () => {
    const signedIn = authState.data;
    authState.data = null;
    auth.refetch.mockImplementationOnce(async () => {
      authState.data = signedIn;
    });
    render(<ShopClient />);
    await screen.findByText(product.name);
    await waitFor(() => expect(commerce.me).toHaveBeenCalledOnce());
    navigate("我的");
    expect(screen.getByRole("region", { name: "商城账号身份" })).toHaveTextContent(
      "buyer1@test.invalid",
    );
    expect(auth.refetch).toHaveBeenCalledOnce();
  });
  it("does not expose cached private data when the original session cannot be confirmed", async () => {
    authState.data = null;
    auth.refetch.mockRejectedValueOnce(new TypeError("Offline"));
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    await screen.findByText("暂时无法核实账号身份，请重新登录。");
    expect(commerce.me).not.toHaveBeenCalled();
    expect(commerce.orders).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "申请测试提现" })).not.toBeInTheDocument();
  });
  it("keeps a rate-limited identity private and explicitly rechecks the published account without changing view", async () => {
    const cached = authState;
    authState = { ...cached, error: { status: 429 } };
    let finish!: () => void;
    auth.refetch.mockResolvedValueOnce(undefined).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    commerce.me.mockResolvedValue({
      ...initialProfile,
      wallet: { ...initialProfile.wallet, availableCents: 6789 },
    });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    await screen.findByText(/请求过于频繁，暂时无法核实商城账号/);
    expect(screen.getByRole("region", { name: "商城账号身份" })).not.toHaveTextContent(
      "buyer1@test.invalid",
    );
    expect(screen.queryByRole("link", { name: "登录 DJL 账号" })).not.toBeInTheDocument();
    expect(commerce.me).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新核实账号" }));
    await waitFor(() => expect(auth.refetch).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("heading", { name: "我的推荐与收益" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新核实账号" })).toBeDisabled();
    expect(commerce.me).not.toHaveBeenCalled();
    authState = {
      data: {
        session: { id: "retry-b-session", token: "never-render-retry-token" },
        user: {
          id: "buyer-b",
          name: "Buyer B",
          email: "retry-b@test.invalid",
          emailVerified: true,
        },
      },
      error: null,
      isPending: false,
    };
    auth.useSession.mockReturnValue({ ...cached, refetch: auth.refetch });
    commerce.favorites.mockResolvedValue({ userId: "buyer-b", productIds: [] });
    await act(async () => finish());
    await screen.findByText("CAD 67.89");
    expect(screen.getByRole("region", { name: "商城账号身份" })).toHaveTextContent(
      "retry-b@test.invalid",
    );
    expect(screen.getByRole("region", { name: "商城账号身份" })).not.toHaveTextContent(
      "buyer1@test.invalid",
    );
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
  it("does not automatically loop or sign out when an explicit identity retry is still rate limited", async () => {
    authState = { ...authState, error: { status: 429 } };
    sessionStorage.setItem("djl-ai-draft-sentinel", "keep-ai-draft");
    render(<ShopClient />);
    await screen.findByText(product.name);
    await screen.findByText(/请求过于频繁，暂时无法核实商城账号/);
    fireEvent.click(screen.getByRole("button", { name: "重新核实账号" }));
    await waitFor(() => expect(auth.refetch).toHaveBeenCalledTimes(2));
    await screen.findByText(/请求过于频繁，暂时无法核实商城账号/);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(auth.refetch).toHaveBeenCalledTimes(2);
    expect(commerce.me).not.toHaveBeenCalled();
    expect(commerce.createOrder).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("djl-ai-draft-sentinel")).toBe("keep-ai-draft");
    fireEvent.change(screen.getByRole("textbox", { name: "搜索商品" }), {
      target: { value: "米白" },
    });
    expect(screen.getByText(product.name)).toBeInTheDocument();
  });
  it("does not load private account data after an identity retry finishes following unmount", async () => {
    authState = { ...authState, error: { status: 429 } };
    let finish!: () => void;
    auth.refetch.mockResolvedValueOnce(undefined).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { unmount } = render(<ShopClient />);
    await screen.findByText(product.name);
    await screen.findByText(/请求过于频繁，暂时无法核实商城账号/);
    fireEvent.click(screen.getByRole("button", { name: "重新核实账号" }));
    await waitFor(() => expect(auth.refetch).toHaveBeenCalledTimes(2));
    unmount();
    authState.error = null;
    await act(async () => finish());
    expect(commerce.me).not.toHaveBeenCalled();
    expect(commerce.orders).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
  it.each([
    { signedIn: false, strict: false },
    { signedIn: true, strict: true },
  ])(
    "loads the public catalog once across a delayed session check ($signedIn, StrictMode $strict)",
    async ({ signedIn, strict }) => {
      const confirmed = authState.data;
      authState = { data: null, error: null, isPending: true };
      let finishIdentity!: () => void;
      auth.refetch.mockReturnValue(
        new Promise<void>((resolve) => {
          finishIdentity = resolve;
        }),
      );
      let finishCatalog!: () => void;
      commerce.catalog.mockReturnValue(
        new Promise((resolve) => {
          finishCatalog = () => resolve({ products: [product], currency: "CAD", mode: "test" });
        }),
      );
      const shop = <ShopClient />;
      const view = render(strict ? <StrictMode>{shop}</StrictMode> : shop);
      await waitFor(() => expect(commerce.catalog).toHaveBeenCalledOnce());
      expect(commerce.me).not.toHaveBeenCalled();
      expect(commerce.orders).not.toHaveBeenCalled();

      if (!signedIn) {
        await act(async () => finishCatalog());
        expect(await screen.findByText(product.name)).toBeInTheDocument();
      }
      authState = { data: signedIn ? confirmed : null, error: null, isPending: false };
      await act(async () => finishIdentity());
      if (signedIn) await act(async () => finishCatalog());
      expect(await screen.findByText(product.name)).toBeInTheDocument();
      expect(commerce.catalog).toHaveBeenCalledOnce();

      if (signedIn) {
        await waitFor(() => expect(commerce.orders).toHaveBeenCalled());
        authState = {
          ...authState,
          data: {
            session: { id: "buyer-two-session", token: "not-rendered" },
            user: {
              id: "buyer-2",
              name: "Buyer Two",
              email: "buyer2@test.invalid",
              emailVerified: true,
            },
          },
        };
        view.rerender(
          <StrictMode>
            <ShopClient />
          </StrictMode>,
        );
        await waitFor(() => expect(commerce.catalog).toHaveBeenCalledTimes(2));
      } else {
        expect(commerce.me).not.toHaveBeenCalled();
        expect(commerce.orders).not.toHaveBeenCalled();
      }
    },
  );

  it("offers the displayed hosted guest sign-in after identity is confirmed without losing the shop return", async () => {
    Object.defineProperty(window, "djlCommerce", {
      configurable: true,
      value: { kind: "desktop", openCheckout: vi.fn() },
    });
    window.history.replaceState({}, "", "/shop?ref=FRIEND-1");
    authState = { data: null, error: null, isPending: true };
    let complete!: () => void;
    auth.refetch.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    render(<ShopClient />);
    await screen.findByText(product.name);

    const navigation = screen.getByRole("navigation", { name: "商城导航" });
    fireEvent.click(within(navigation).getByRole("button", { name: /^我的$/ }));
    expect(screen.getByRole("heading", { name: "我的推荐与收益" })).toBeInTheDocument();
    const identity = screen.getByRole("region", { name: "商城账号身份" });
    expect(identity).toHaveTextContent("正在核实登录身份");
    expect(screen.queryByRole("link", { name: "登录 DJL 账号" })).not.toBeInTheDocument();

    authState = { ...authState, isPending: false };
    await act(async () => complete());
    expect(screen.getByRole("region", { name: "商城账号身份" })).toHaveTextContent(
      "尚未登录商城账号。",
    );
    const signIn = screen.getByRole<HTMLAnchorElement>("link", { name: "登录 DJL 账号" });
    expect(signIn).toHaveAttribute("href", "/sign-in?next=%2Fshop%3Fref%3DFRIEND-1");
    const destination = new URL(signIn.href);
    expect(destination.origin).toBe(window.location.origin);
    expect(destination.searchParams.get("next")).toBe("/shop?ref=FRIEND-1");
    expect(commerce.me).not.toHaveBeenCalled();
    expect(commerce.orders).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
  it("shows a confirmed guest only after a retry actually confirms an anonymous session", async () => {
    authState = { ...authState, error: { status: 429 } };
    auth.refetch.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
      authState = { data: null, error: null, isPending: false };
    });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    await screen.findByText(/请求过于频繁，暂时无法核实商城账号/);
    fireEvent.click(screen.getByRole("button", { name: "重新核实账号" }));
    await screen.findByText("尚未登录商城账号。");
    expect(screen.getByRole("link", { name: "登录 DJL 账号" })).toBeInTheDocument();
    expect(commerce.me).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
  it("guides referral binding toward confirming cancellation of an unpaid checkout, never toward first paying", async () => {
    commerce.bind.mockRejectedValue(
      new ApiError(409, "commerce_payment_unresolved", "Unresolved checkout", null),
    );
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    fireEvent.change(await screen.findByLabelText("推荐码"), { target: { value: "INVITER-CODE" } });
    fireEvent.click(screen.getByLabelText("我确认这是我的介绍人，理解绑定后不能自行更换。"));
    const button = screen.getByRole("button", { name: "确认长期绑定" });
    fireEvent.submit(button.closest("form")!);
    await screen.findByText(/先到订单页查询并确认取消尚未付款的收银台/);
    expect(screen.getByRole("alert")).toHaveTextContent("不要先付款，首单付款后不能补绑");
    expect(commerce.testPay).not.toHaveBeenCalled();
    expect(commerce.cancel).not.toHaveBeenCalled();
  });
  it("shows safe authenticated identity and describes the ordinary web shared-cookie logout boundary", async () => {
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    const panel = screen.getByRole("region", { name: "商城账号身份" });
    expect(panel).toHaveTextContent("Buyer One · buyer1@test.invalid");
    expect(panel).toHaveTextContent("账号 ID：buyer-1");
    expect(panel).not.toHaveTextContent("DO-NOT-RENDER-SESSION-TOKEN");
    expect(panel).toHaveTextContent("退出会同时结束该共享云端登录");
    await waitFor(() => expect(screen.getByRole("button", { name: "退出商城账号" })).toBeEnabled());
  });
  it("only ends the confirmed commerce account state and its own cache, preserving unrelated AI storage", async () => {
    Object.defineProperty(window, "djlCommerce", {
      configurable: true,
      value: { kind: "desktop", openCheckout: vi.fn() },
    });
    sessionStorage.setItem("djl-ai-draft-sentinel", "keep-ai-draft");
    localStorage.setItem("model-credential-sentinel", "keep-ai-config");
    commerce.orders.mockResolvedValue({ orders: [order] });
    commerce.me.mockResolvedValue({
      ...initialProfile,
      wallet: { ...initialProfile.wallet, availableCents: 2500 },
    });
    render(<ShopClient />);
    fireEvent.click(await screen.findByRole("button", { name: `将${product.name}加入购物车` }));
    navigate("我的");
    await waitFor(() => expect(screen.getByRole("button", { name: "退出商城账号" })).toBeEnabled());
    expect(screen.getByRole("region", { name: "商城账号身份" })).toHaveTextContent(
      "退出只影响此商城窗口",
    );
    fireEvent.click(screen.getByRole("button", { name: "退出商城账号" }));
    await screen.findByText(/商城账号已退出/);
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "申请测试提现" })).not.toBeInTheDocument();
    expect(screen.queryByText(/buyer1@test.invalid/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "购物车，0件商品" })).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem("djl-commerce-cart-v1") ?? "{}")).toEqual({});
    expect(sessionStorage.getItem("djl-ai-draft-sentinel")).toBe("keep-ai-draft");
    expect(localStorage.getItem("model-credential-sentinel")).toBe("keep-ai-config");
    navigate("订单");
    expect(screen.queryByRole("button", { name: "确认测试付款" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "登录 DJL 账号" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
  it("does not pretend a returned sign-out error or network failure has signed the user out", async () => {
    commerce.me.mockResolvedValue({
      ...initialProfile,
      wallet: { ...initialProfile.wallet, availableCents: 2500 },
    });
    auth.signOut
      .mockResolvedValueOnce({ data: null, error: { message: "Unknown" } })
      .mockRejectedValueOnce(new TypeError("Offline"));
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    await waitFor(() => expect(screen.getByRole("button", { name: "切换账号" })).toBeEnabled());
    for (let attempt = 0; attempt < 2; attempt++) {
      fireEvent.click(screen.getByRole("button", { name: "切换账号" }));
      await screen.findByText(/退出结果尚未确认/);
      expect(screen.getByRole("region", { name: "商城账号身份" })).toHaveTextContent(
        "buyer1@test.invalid",
      );
      expect(screen.getByRole("button", { name: "申请测试提现" })).toBeInTheDocument();
      expect(screen.queryByText(/商城账号已退出/)).not.toBeInTheDocument();
    }
    expect(push).not.toHaveBeenCalled();
  });
  it("switches accounts through the original sign-out before returning to commerce sign-in", async () => {
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    await waitFor(() => expect(screen.getByRole("button", { name: "切换账号" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "切换账号" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sign-in?next=%2Fshop"));
    expect(auth.signOut).toHaveBeenCalledOnce();
    expect(screen.queryByText(/buyer1@test.invalid/)).not.toBeInTheDocument();
  });
  it("shows only the public catalog while authentication is pending and drops private state after a commerce 401", async () => {
    authState = { data: null, isPending: true, error: null };
    const { unmount } = render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    expect(screen.getByText("正在核实登录身份，暂不读取订单或收益。")).toBeInTheDocument();
    expect(commerce.me).not.toHaveBeenCalled();
    expect(commerce.orders).not.toHaveBeenCalled();
    unmount();
    authState = {
      data: {
        session: { id: "active-session", token: "never-render" },
        user: {
          id: "buyer-1",
          name: "Buyer One",
          email: "buyer1@test.invalid",
          emailVerified: true,
        },
      },
      isPending: false,
      error: null,
    };
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    await waitFor(() => expect(screen.getByRole("button", { name: "退出商城账号" })).toBeEnabled());
    commerce.me.mockRejectedValueOnce(new ApiError(401, "unauthorized", "Sign-in required", null));
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByText(/商城登录状态已失效/);
    expect(screen.queryByRole("button", { name: "申请测试提现" })).not.toBeInTheDocument();
    expect(screen.queryByText(/buyer1@test.invalid/)).not.toBeInTheDocument();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
  it("never refills another user's wallet or orders from an old asynchronous refresh", async () => {
    let finish!: (profile: CommerceProfile) => void;
    commerce.me
      .mockResolvedValueOnce(initialProfile)
      .mockReturnValueOnce(
        new Promise<CommerceProfile>((resolve) => {
          finish = resolve;
        }),
      )
      .mockResolvedValue({
        ...initialProfile,
        referralCode: "BUYER-TWO",
        wallet: { ...initialProfile.wallet, availableCents: 3456 },
      });
    commerce.orders
      .mockResolvedValueOnce({ orders: [order] })
      .mockResolvedValueOnce({ orders: [order] })
      .mockResolvedValue({
        orders: [
          {
            ...order,
            id: "buyer-two-order",
            items: [{ ...order.items[0]!, name: "Buyer Two Product" }],
          },
        ],
      });
    const { rerender } = render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(commerce.me).toHaveBeenCalledTimes(2));
    authState = {
      data: {
        session: { id: "buyer-two-session", token: "never-render-new-token" },
        user: {
          id: "buyer-2",
          name: "Buyer Two",
          email: "buyer2@test.invalid",
          emailVerified: true,
        },
      },
      isPending: false,
      error: null,
    };
    rerender(<ShopClient />);
    await waitFor(() => expect(commerce.me).toHaveBeenCalledTimes(3));
    navigate("我的");
    await screen.findByText("CAD 34.56");
    await act(async () =>
      finish({ ...initialProfile, wallet: { ...initialProfile.wallet, availableCents: 9999999 } }),
    );
    expect(screen.getByRole("region", { name: "商城账号身份" })).toHaveTextContent(
      "buyer2@test.invalid",
    );
    expect(screen.queryByText("CAD 99999.99")).not.toBeInTheDocument();
    navigate("订单");
    expect(screen.getByText("Buyer Two Product")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `为${product.name}申请售后` }),
    ).not.toBeInTheDocument();
  });
  it("limits new selections to 50 distinct SKUs without dropping an older oversized cart or blocking existing quantities", async () => {
    const catalog = Array.from({ length: 52 }, (_, index) => ({
      ...product,
      id: `product-${index + 1}`,
      sku: `SKU-${index + 1}`,
      name: `商品${index + 1}`,
    }));
    commerce.catalog.mockResolvedValue({ products: catalog, currency: "CAD", mode: "test" });
    sessionStorage.setItem(
      "djl-commerce-cart-v1",
      JSON.stringify(Object.fromEntries(catalog.slice(0, 50).map((entry) => [entry.id, 1]))),
    );
    const first = render(<ShopClient />);
    await screen.findByText("商品52");
    fireEvent.click(screen.getByRole("button", { name: "将商品51加入购物车" }));
    await screen.findByText("每单最多购买 50 种商品，请先移除一种再添加新商品。");
    fireEvent.click(screen.getByRole("button", { name: "购物车，50件商品" }));
    fireEvent.click(screen.getByRole("button", { name: "增加商品1" }));
    expect(screen.getByRole("button", { name: "创建测试订单" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "移除商品2" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭购物车与测试结账" }));
    fireEvent.click(screen.getByRole("button", { name: "将商品51加入购物车" }));
    expect(screen.getByRole("button", { name: "购物车，51件商品" })).toBeInTheDocument();
    first.unmount();
    sessionStorage.setItem(
      "djl-commerce-cart-v1",
      JSON.stringify(Object.fromEntries(catalog.slice(0, 51).map((entry) => [entry.id, 1]))),
    );
    render(<ShopClient />);
    await screen.findByText("商品52");
    fireEvent.click(screen.getByRole("button", { name: "购物车，51件商品" }));
    const dialog = screen.getByRole("dialog", { name: "购物车与测试结账" });
    expect(within(dialog).getAllByRole("button", { name: /^移除商品/ })).toHaveLength(51);
    expect(Object.keys(JSON.parse(sessionStorage.getItem("djl-commerce-cart-v1")!))).toHaveLength(
      51,
    );
    expect(within(dialog).getByText(/全部选品已保留/)).toBeInTheDocument();
    const submit = within(dialog).getByRole("button", { name: "创建测试订单" });
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest("form")!);
    expect(commerce.createOrder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "移除商品51" }));
    expect(within(dialog).getByRole("button", { name: "创建测试订单" })).toBeEnabled();
  });
  it("shows distinct saved SKUs for same-name order lines and never backfills a legacy null SKU", async () => {
    commerce.orders.mockResolvedValue({
      orders: [
        {
          ...order,
          items: [
            { ...order.items[0]!, id: "red-line", name: "同名商品", sku: "ORDER-RED" },
            { ...order.items[0]!, id: "blue-line", name: "同名商品", sku: "ORDER-BLUE" },
            { ...order.items[0]!, id: "legacy-line", sku: null },
          ],
        },
      ],
    });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("订单");
    expect(await screen.findByText("SKU：ORDER-RED")).toBeInTheDocument();
    expect(screen.getByText("SKU：ORDER-BLUE")).toBeInTheDocument();
    expect(screen.getByText("历史订单未记录 SKU")).toBeInTheDocument();
    expect(screen.queryByText(`SKU：${product.sku}`)).not.toBeInTheDocument();
  });
  it("shows the saved order address, carrier and per-line refunds rather than current checkout or catalog data", async () => {
    const saved: CommerceOrder = {
      ...order,
      status: "paid",
      paidAt: "2026-10-01T12:01:00Z",
      totalCents: 6800,
      refundedCents: 1200,
      address: {
        name: "成交快照收件人",
        line1: "10 Snapshot Road",
        city: "Snapshot City",
        province: "BC",
        postalCode: "V6B 1A1",
        country: "CA",
      },
      items: [
        {
          ...order.items[0]!,
          sku: "SAVED-TOTE",
          name: "成交快照帆布包",
          status: "shipped",
          carrier: "Snapshot Carrier",
          trackingNumber: "SNAPSHOT-TRACK-1",
          refundedCents: 1200,
        },
        {
          ...order.items[0]!,
          id: "saved-cup-line",
          productId: "no-longer-in-catalog",
          sku: "SAVED-CUP",
          name: "成交快照随行杯",
          priceCents: 2900,
          lineCents: 2900,
        },
      ],
    };
    const currentProduct = { ...product, name: "当前目录已改名", priceCents: 9999 };
    commerce.catalog.mockResolvedValue({
      products: [currentProduct],
      currency: "CAD",
      mode: "test",
    });
    commerce.orders.mockResolvedValue({ orders: [saved] });
    render(<ShopClient />);
    await screen.findByText(currentProduct.name);
    await waitFor(() => expect(commerce.withdrawals).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: `将${currentProduct.name}加入购物车` }));
    fireEvent.click(screen.getByRole("button", { name: "购物车，1件商品" }));
    const checkout = screen.getByRole("dialog", { name: "购物车与测试结账" });
    fillTestAddress(checkout, "99 Unsaved Checkout Road");
    fireEvent.change(within(checkout).getByLabelText("收件人"), {
      target: { value: "未提交的新收件人" },
    });
    fireEvent.click(within(checkout).getByRole("button", { name: "关闭购物车与测试结账" }));
    navigate("订单");
    const card = (await screen.findByText(`订单 ${saved.id.slice(0, 8)}`)).closest("article")!;
    for (const value of ["成交快照收件人", "10 Snapshot Road", "Snapshot City", "V6B 1A1"])
      expect(card).toHaveTextContent(value);
    expect(card).not.toHaveTextContent("未提交的新收件人");
    expect(card).not.toHaveTextContent("99 Unsaved Checkout Road");
    expect(card).toHaveTextContent("Snapshot Carrier");
    expect(card).toHaveTextContent("SNAPSHOT-TRACK-1");
    const refundedLine = within(card).getByText("SKU：SAVED-TOTE").parentElement!.parentElement!;
    const otherLine = within(card).getByText("SKU：SAVED-CUP").parentElement!.parentElement!;
    expect(refundedLine).toHaveTextContent("CAD 39.00");
    expect(refundedLine).toHaveTextContent("已退款 CAD 12.00");
    expect(otherLine).toHaveTextContent("CAD 29.00");
    expect(otherLine).not.toHaveTextContent("已退款 CAD 12.00");
    expect(card).toHaveTextContent("合计 CAD 68.00");
    expect(card).not.toHaveTextContent("CAD 99.99");
    expect(commerce.createOrder).not.toHaveBeenCalled();
    expect(commerce.testPay).not.toHaveBeenCalled();
    expect(commerce.requestReturn).not.toHaveBeenCalled();
  });
  it("caps each SKU at the server's 1000-item limit even when more stock exists", async () => {
    commerce.catalog.mockResolvedValue({
      products: [{ ...product, stock: 2000 }],
      currency: "CAD",
      mode: "test",
    });
    sessionStorage.setItem("djl-commerce-cart-v1", JSON.stringify({ [product.id]: 1000 }));
    render(<ShopClient />);
    await screen.findByText(product.name);
    expect(screen.getByRole("button", { name: `将${product.name}加入购物车` })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "购物车，1000件商品" }));
    const increase = screen.getByRole("button", { name: `增加${product.name}` });
    expect(increase).toBeDisabled();
    fireEvent.click(increase);
    expect(screen.getByRole("button", { name: "购物车，1000件商品" })).toBeInTheDocument();
  });
  it("can buy a newly indexed image-search SKU absent from the initial catalog while the server still sets the order price", async () => {
    const found: CommerceProduct = {
      ...product,
      id: "new-product-2",
      sku: "NEW-TOTE-2",
      name: "新检索帆布包",
      priceCents: 4500,
      stock: 5,
    };
    const serverOrder: CommerceOrder = {
      ...order,
      totalCents: 5000,
      items: [
        {
          ...order.items[0]!,
          productId: found.id,
          sku: found.sku,
          name: found.name,
          priceCents: 5000,
          lineCents: 5000,
        },
      ],
    };
    commerce.searchImage.mockResolvedValue({ products: [found], message: "相似推荐，不保证同款" });
    commerce.createOrder.mockResolvedValue({ order: serverOrder });
    commerce.orders
      .mockResolvedValueOnce({ orders: [] })
      .mockResolvedValue({ orders: [serverOrder] });
    render(<ShopClient />);
    await screen.findByText(product.name);
    await waitFor(() => expect(commerce.ledger).toHaveBeenCalled());
    navigate("图片找商品");
    fireEvent.change(screen.getByLabelText("上传找货图片"), {
      target: { files: [new File(["fixture"], "tote.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "查找相似商品" }));
    await screen.findByText(found.name);
    fireEvent.click(screen.getByRole("button", { name: `将${found.name}加入购物车` }));
    fireEvent.click(screen.getByRole("button", { name: "购物车，1件商品" }));
    const dialog = screen.getByRole("dialog", { name: "购物车与测试结账" });
    expect(within(dialog).getByText(found.name)).toBeInTheDocument();
    fillTestAddress(dialog);
    fireEvent.submit(within(dialog).getByRole("button", { name: "创建测试订单" }).closest("form")!);
    await screen.findByText("合计 CAD 50.00");
    expect(commerce.createOrder).toHaveBeenCalledWith(
      [{ productId: found.id, quantity: 1 }],
      expect.objectContaining({ country: "CA" }),
      expect.any(String),
      "buyer-1",
    );
    expect(commerce.testPay).not.toHaveBeenCalled();
  });
  it("uses the hosted TEST capability only for Stripe orders and hides simulated payment actions", async () => {
    commerce.catalog.mockResolvedValue({
      products: [product],
      currency: "CAD",
      mode: "test",
      paymentProvider: "stripe_test",
    });
    commerce.orders.mockResolvedValue({ orders: [{ ...order, paymentProvider: "stripe_test" }] });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("订单");
    expect(await screen.findByRole("button", { name: "准备 Stripe 测试付款" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认测试付款" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消订单" })).not.toBeInTheDocument();
    expect(commerce.testPay).not.toHaveBeenCalled();
    expect(
      screen.getByText("Stripe 测试商城 · 仅使用测试卡，绝不输入真实银行卡；提现仍为模拟"),
    ).toBeInTheDocument();
  });
  it("can query older orders, withdrawals and immutable ledger pages independently", async () => {
    commerce.orders.mockImplementation(async (page = 0) => ({
      orders: [{ ...order, id: `order-page-${page}` }],
      page,
      hasMore: page === 0,
    }));
    commerce.withdrawals.mockImplementation(async (page = 0) => ({
      withdrawals: [
        {
          id: `withdrawal-${page}`,
          amountCents: 2500,
          status: "paid_test",
          reference: `TEST-${page}`,
          createdAt: "2026-10-01T12:00:00Z",
        },
      ],
      page,
      hasMore: page === 0,
    }));
    commerce.ledger.mockImplementation(async (page = 0) => ({
      entries: [
        {
          id: `entry-${page}`,
          account: "paid",
          amountCents: 2500,
          eventKey: `test-record-${page}`,
          createdAt: "2026-10-01T12:00:00Z",
        },
      ],
      page,
      hasMore: page === 0,
    }));
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("订单");
    fireEvent.click(await screen.findByRole("button", { name: "下一页订单" }));
    await waitFor(() => expect(commerce.orders).toHaveBeenLastCalledWith(1));
    expect(screen.getByRole("button", { name: "下一页订单" })).toBeDisabled();
    navigate("我的");
    fireEvent.click(await screen.findByRole("button", { name: "下一页提现" }));
    await screen.findByText(/测试凭证 TEST-1/);
    fireEvent.click(screen.getByRole("button", { name: "下一页流水" }));
    await screen.findByText(/test-record-1/);
    expect(commerce.orders).toHaveBeenLastCalledWith(1);
    expect(commerce.withdrawals).toHaveBeenLastCalledWith(1);
    expect(commerce.ledger).toHaveBeenLastCalledWith(1);
  });
  it("distinguishes an unreachable catalog from an empty inventory and can retry", async () => {
    commerce.catalog
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ products: [product], currency: "CAD", mode: "test" });
    render(<ShopClient />);
    await screen.findByText("暂时无法连接商城服务，请稍后重试。");
    expect(commerce.catalog).toHaveBeenCalledOnce();
    expect(screen.getByText("商城服务暂时不可用")).toBeInTheDocument();
    expect(screen.queryByText("暂无符合条件的商品")).not.toBeInTheDocument();
    expect(screen.queryByText("0 件商品")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新连接商城" }));
    await screen.findByText(product.name);
    expect(commerce.catalog).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("商城服务暂时不可用")).not.toBeInTheDocument();
  });
  it("hands off the fresh catalog if a guest reconnects while identity is still being checked", async () => {
    authState = { data: null, error: null, isPending: true };
    let finishIdentity!: () => void;
    auth.refetch.mockReturnValue(
      new Promise<void>((resolve) => {
        finishIdentity = resolve;
      }),
    );
    commerce.catalog.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<ShopClient />);
    fireEvent.click(await screen.findByRole("button", { name: "重新连接商城" }));
    await screen.findByText(product.name);
    expect(commerce.catalog).toHaveBeenCalledTimes(2);

    authState = { ...authState, isPending: false };
    await act(async () => finishIdentity());
    expect(await screen.findByText(product.name)).toBeInTheDocument();
    expect(commerce.catalog).toHaveBeenCalledTimes(2);
    expect(commerce.me).not.toHaveBeenCalled();
  });
  it("keeps the independent withdrawals pause separate from order history and aftersales", async () => {
    commerce.me.mockResolvedValue({
      ...initialProfile,
      withdrawalsPaused: true,
      wallet: { ...initialProfile.wallet, availableCents: 2500 },
    });
    commerce.orders.mockResolvedValue({ orders: [{ ...order, status: "paid" }] });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    expect(await screen.findByRole("button", { name: "申请测试提现" })).toBeDisabled();
    expect(screen.getByText("提现申请暂时暂停，历史记录与售后仍可查看。")).toBeInTheDocument();
    navigate("订单");
    expect(await screen.findByRole("button", { name: "申请售后" })).toBeEnabled();
  });
  it("does not report a successful add when the cart already contains all available stock", async () => {
    commerce.catalog.mockResolvedValue({
      products: [{ ...product, stock: 1 }],
      currency: "CAD",
      mode: "test",
    });
    render(<ShopClient />);
    await screen.findByText(product.name);
    const add = screen.getByRole("button", { name: `将${product.name}加入购物车` });
    fireEvent.click(add);
    expect(screen.getByText("已加入购物车")).toBeInTheDocument();
    fireEvent.click(add);
    expect(screen.getByText("库存不足，请刷新商品后重试。")).toBeInTheDocument();
    expect(screen.queryByText("已加入购物车")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "购物车，1件商品" })).toBeInTheDocument();
  });
  it("shows real catalog search and keeps sign-in referral without auto-binding", async () => {
    window.history.replaceState({}, "", "/shop?ref=OTHER-USER");
    authState.data = null;
    commerce.me.mockRejectedValue(new ApiError(401, "unauthorized", "Sign in", null));
    render(<ShopClient />);
    await screen.findByText(product.name);
    fireEvent.change(screen.getByLabelText("搜索商品"), { target: { value: "不存在" } });
    expect(screen.getByText("暂无符合条件的商品")).toBeInTheDocument();
    navigate("我的");
    const signIn = await screen.findByRole("link", { name: "登录 DJL 账号" });
    expect(signIn).toHaveAttribute("href", "/sign-in?next=%2Fshop%3Fref%3DOTHER-USER");
    expect(commerce.bind).not.toHaveBeenCalled();
  });
  it("shows a placeholder for failed product images in cards and details without retrying the catalog", async () => {
    const missing = { ...product, imageUrl: "/shop/missing-product.webp" };
    const sibling = {
      ...product,
      id: "product-2",
      name: "保温随行杯",
      imageUrl: "/shop/assets/products.png",
    };
    commerce.catalog.mockResolvedValue({
      products: [sibling, missing],
      currency: "CAD",
      mode: "test",
    });
    render(<ShopClient />);
    const card = (await screen.findByRole("heading", { name: missing.name })).closest("button")!;
    const siblingCard = screen.getByRole("heading", { name: sibling.name }).closest("button")!;
    const siblingImage = within(siblingCard).getByRole("img", { name: sibling.name });
    const catalogReads = commerce.catalog.mock.calls.length;

    fireEvent.error(within(card).getByRole("img", { name: missing.name }));
    expect(within(card).getByLabelText("暂无商品图片")).toBeVisible();
    expect(card.querySelector("img")).toBeNull();
    expect(within(siblingCard).getByRole("img", { name: sibling.name })).toBe(siblingImage);
    expect(siblingImage).toHaveAttribute("src", sibling.imageUrl);

    fireEvent.click(card);
    const detail = screen.getByRole("dialog", { name: "商品详情" });
    fireEvent.error(within(detail).getByRole("img", { name: missing.name }));
    expect(within(detail).getByLabelText("暂无商品图片")).toBeVisible();
    expect(detail.querySelector("img")).toBeNull();
    expect(within(detail).getByRole("button", { name: "加入购物车" })).toBeEnabled();
    expect(within(card).getByLabelText("暂无商品图片")).toBeVisible();

    fireEvent.click(within(detail).getByRole("button", { name: "关闭商品详情" }));
    fireEvent.click(card);
    const reopened = screen.getByRole("dialog", { name: "商品详情" });
    expect(within(reopened).getByRole("img", { name: missing.name })).toHaveAttribute(
      "src",
      missing.imageUrl,
    );
    expect(commerce.catalog).toHaveBeenCalledTimes(catalogReads);
  });
  it("creates a server-priced order, keeps the retry key after failure, then uses test-only payment", async () => {
    commerce.createOrder
      .mockRejectedValueOnce(new Error("Temporary network error"))
      .mockResolvedValueOnce({ order });
    commerce.testPay.mockResolvedValue({ order: { ...order, status: "paid" } });
    commerce.orders.mockResolvedValueOnce({ orders: [] }).mockResolvedValue({ orders: [order] });
    render(<ShopClient />);
    await screen.findByText(product.name);
    await waitFor(() => expect(commerce.withdrawals).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: `将${product.name}加入购物车` }));
    fireEvent.click(screen.getByRole("button", { name: "购物车，1件商品" }));
    const dialog = screen.getByRole("dialog", { name: "购物车与测试结账" });
    fillTestAddress(dialog);
    const submit = within(dialog).getByRole("button", { name: "创建测试订单" });
    fireEvent.submit(submit.closest("form")!);
    await screen.findByText("Temporary network error");
    fireEvent.click(within(dialog).getByRole("button", { name: "重试原订单请求" }));
    await screen.findByRole("button", { name: "确认测试付款" });
    expect(commerce.createOrder).toHaveBeenCalledTimes(2);
    expect(commerce.createOrder.mock.calls[0]?.[2]).toBe(commerce.createOrder.mock.calls[1]?.[2]);
    expect(commerce.createOrder.mock.calls[0]?.[0]).toEqual([
      { productId: product.id, quantity: 1 },
    ]);
    commerce.orders.mockResolvedValue({ orders: [{ ...order, status: "paid" }] });
    fireEvent.click(screen.getByRole("button", { name: "确认测试付款" }));
    await screen.findByText("测试付款已确认，不会扣除真实资金。自己的购买不会给自己返佣。");
    expect(commerce.testPay).toHaveBeenCalledWith(order.id, expect.any(String));
  });
  it.each(["guest", "unverified"] as const)(
    "does not read private referral summary for a %s Mine view",
    async (kind) => {
      if (kind === "guest") authState.data = null;
      else authState.data!.user.emailVerified = false;
      render(<ShopClient />);
      await screen.findByText(product.name);
      navigate("我的");
      await screen.findByText(kind === "guest" ? "尚未登录商城账号。" : /邮箱尚未验证/);
      expect(screen.queryByRole("region", { name: "直接推荐统计" })).not.toBeInTheDocument();
      expect(commerce.referralSummary).not.toHaveBeenCalled();
    },
  );

  it("loads direct referral summary only in verified Mine and aborts when leaving it", async () => {
    let finishOld!: (summary: typeof zeroReferralSummary) => void;
    commerce.referralSummary
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishOld = resolve;
        }),
      )
      .mockResolvedValue({
        ...zeroReferralSummary,
        directBuyers: 7,
        ordersWithCommission: 4,
        netCommissionCents: 1234,
      });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("订单");
    await screen.findByRole("heading", { name: "我的订单" });
    expect(commerce.referralSummary).not.toHaveBeenCalled();

    navigate("我的");
    const panel = await screen.findByRole("region", { name: "直接推荐统计" });
    expect(within(panel).getByRole("status")).toHaveTextContent("正在读取直接推荐统计");
    const [viewer, signal] = commerce.referralSummary.mock.calls[0] as [string, AbortSignal];
    expect(viewer).toBe("buyer-1");
    expect(signal.aborted).toBe(false);
    navigate("订单");
    expect(signal.aborted).toBe(true);
    await act(async () => finishOld(zeroReferralSummary));
    expect(panel).not.toBeInTheDocument();
    navigate("我的");
    const current = within(await screen.findByRole("region", { name: "直接推荐统计" }));
    await current.findByText("CAD 12.34");
    expect(current.getByText("直接推荐买家")).toBeInTheDocument();
    expect(current.getByText("仍有佣金的订单")).toBeInTheDocument();
    expect(current.getByText("累计模拟净佣金（退款后）")).toBeInTheDocument();
    expect(current.getByText("7")).toBeInTheDocument();
    expect(current.getByText("4")).toBeInTheDocument();
    expect(current.getByText(/不是可提现金额/)).toBeInTheDocument();
    expect(commerce.referralSummary).toHaveBeenCalledTimes(2);
  });

  it("shows referral summary unavailable separately from a valid zero and retries independently", async () => {
    commerce.referralSummary
      .mockRejectedValueOnce(
        new ApiError(503, "commerce_referral_summary_unavailable", "fixture", null),
      )
      .mockResolvedValueOnce(zeroReferralSummary)
      .mockResolvedValueOnce({
        ...zeroReferralSummary,
        directBuyers: 1,
        ordersWithCommission: 1,
        netCommissionCents: 50,
      });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    const summary = within(await screen.findByRole("region", { name: "直接推荐统计" }));
    expect(await summary.findByRole("alert")).toHaveTextContent(
      "推荐统计暂不可用，不能据此判断为零",
    );
    expect(summary.queryByText("CAD 0.00")).not.toBeInTheDocument();
    const profileReads = commerce.me.mock.calls.length;
    expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled();
    fireEvent.click(summary.getByRole("button", { name: "重试推荐统计" }));
    await summary.findByText("CAD 0.00");
    expect(summary.getAllByText("0")).toHaveLength(2);
    expect(summary.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(summary.getByRole("button", { name: "刷新推荐统计" }));
    await summary.findByText("CAD 0.50");
    expect(commerce.referralSummary).toHaveBeenCalledTimes(3);
    expect(commerce.me).toHaveBeenCalledTimes(profileReads);
    expect(commerce.withdraw).not.toHaveBeenCalled();
  });

  it("discards an old account's delayed referral summary failure without signing the new account out", async () => {
    let rejectOld!: (error: Error) => void;
    commerce.referralSummary
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
      )
      .mockResolvedValue({
        ...zeroReferralSummary,
        directBuyers: 3,
        ordersWithCommission: 2,
        netCommissionCents: 980,
      });
    const { rerender } = render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    await screen.findByRole("region", { name: "直接推荐统计" });
    const oldSignal = commerce.referralSummary.mock.calls[0]?.[1] as AbortSignal;
    authState = {
      ...authState,
      data: {
        session: { id: "referral-buyer-two-session", token: "never-render-referral-token" },
        user: {
          id: "buyer-2",
          name: "Buyer Two",
          email: "buyer2@test.invalid",
          emailVerified: true,
        },
      },
    };
    rerender(<ShopClient />);
    const summary = within(await screen.findByRole("region", { name: "直接推荐统计" }));
    await summary.findByText("CAD 9.80");
    expect(oldSignal.aborted).toBe(true);
    expect(commerce.referralSummary.mock.calls[1]?.[0]).toBe("buyer-2");
    await act(async () =>
      rejectOld(new ApiError(401, "commerce_account_changed", "old fixture", null)),
    );
    expect(summary.getByText("CAD 9.80")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "商城账号身份" })).toHaveTextContent(
      "buyer2@test.invalid",
    );
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("requires explicit referral confirmation and displays the persistent bound state", async () => {
    window.history.replaceState({}, "", "/shop?ref=OTHER-USER");
    commerce.bind.mockResolvedValue({ ...initialProfile, referrerId: "other-user" });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    await screen.findByLabelText("推荐码");
    expect(commerce.bind).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "我确认这是我的介绍人，理解绑定后不能自行更换。" }),
    );
    fireEvent.submit(screen.getByRole("button", { name: "确认长期绑定" }).closest("form")!);
    await screen.findByText("已绑定推荐人，长期生效，不能自行更换。其他邀请链接不会覆盖这份关系。");
    expect(commerce.bind).toHaveBeenCalledWith("OTHER-USER");
  });
  it.each(["payment_pending", "payment_unknown"] as const)(
    "keeps %s visibly unresolved and prevents another withdrawal even with stale available funds",
    async (status) => {
      commerce.me.mockResolvedValue({
        ...initialProfile,
        wallet: { ...initialProfile.wallet, availableCents: 2500 },
      });
      commerce.withdrawals.mockResolvedValue({
        withdrawals: [
          {
            id: "unconfirmed-withdrawal",
            amountCents: 2500,
            status,
            reference: null,
            createdAt: "2026-10-01T12:00:00Z",
            paymentOperationId: "6b319a53-6dcb-47fe-b600-a4278dc5e189",
            paymentStartedBy: "payment-admin",
            paymentStartedAt: "2026-10-02T12:00:00Z",
            paymentUnknownAt: status === "payment_unknown" ? "2026-10-02T12:05:00Z" : null,
          },
        ],
      });
      render(<ShopClient />);
      await screen.findByText(product.name);
      navigate("我的");
      expect(
        await screen.findByText("结果未确认，需人工核实；金额仍冻结。未确认真实到账。"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "申请测试提现" })).toBeDisabled();
      expect(screen.queryByText("已记录测试付款，非真实到账")).not.toBeInTheDocument();
      expect(commerce.withdraw).not.toHaveBeenCalled();
    },
  );
  it("freezes a server test withdrawal and labels the record as not real payout", async () => {
    commerce.me.mockResolvedValue({
      ...initialProfile,
      wallet: { ...initialProfile.wallet, availableCents: 2500 },
    });
    commerce.withdraw.mockResolvedValue({
      wallet: { ...initialProfile.wallet, frozenCents: 2500 },
    });
    commerce.withdrawals.mockResolvedValueOnce({ withdrawals: [] }).mockResolvedValue({
      withdrawals: [
        {
          id: "withdrawal-1",
          amountCents: 2500,
          status: "requested",
          reference: null,
          createdAt: "2026-10-01T12:00:00Z",
        },
      ],
    });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    fireEvent.click(await screen.findByRole("button", { name: "申请测试提现" }));
    await screen.findByText("等待人工审核");
    expect(screen.getByRole("button", { name: "申请测试提现" })).toBeDisabled();
    expect(commerce.withdraw).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("测试提现申请已提交，对应金额已冻结；没有真实打款。"),
    ).toBeInTheDocument();
  });
  it.each([
    { afterSalesStatus: "none", openCase: false, receipt: null },
    {
      afterSalesStatus: "closed",
      openCase: false,
      receipt: "平台已结束本次售后，不代表退款或到账。",
    },
    {
      afterSalesStatus: "unconfirmed",
      openCase: false,
      receipt: "已有售后记录，处理结果待平台核实。",
    },
    { afterSalesStatus: "closed", openCase: true, receipt: null },
  ] as const)(
    "shows safe aftersales receipt $afterSalesStatus with current openCase=$openCase",
    async ({ afterSalesStatus, openCase, receipt }) => {
      commerce.orders.mockResolvedValue({
        orders: [
          {
            ...order,
            status: "paid",
            items: [Object.assign({}, order.items[0]!, { afterSalesStatus, openCase })],
          },
        ],
      });
      render(<ShopClient />);
      await screen.findByText(product.name);
      navigate("订单");
      const button = await screen.findByRole("button", {
        name: openCase ? "等待平台处理售后" : "申请售后",
      });
      if (receipt) await screen.findByText(receipt);
      else {
        expect(
          screen.queryByText("平台已结束本次售后，不代表退款或到账。"),
        ).not.toBeInTheDocument();
        expect(screen.queryByText("已有售后记录，处理结果待平台核实。")).not.toBeInTheDocument();
      }
      if (openCase) expect(button).toBeDisabled();
      else {
        expect(button).toBeEnabled();
        fireEvent.click(button);
        expect(screen.getByRole("dialog", { name: "申请售后" })).toBeInTheDocument();
      }
      expect(commerce.testPay).not.toHaveBeenCalled();
      expect(commerce.withdraw).not.toHaveBeenCalled();
      expect(commerce.requestReturn).not.toHaveBeenCalled();
    },
  );
  it("submits buyer aftersales without claiming refund success", async () => {
    const paid = { ...order, status: "paid" as const };
    const opened = { ...paid, items: [{ ...paid.items[0]!, openCase: true }] };
    commerce.orders
      .mockResolvedValueOnce({ orders: [paid] })
      .mockResolvedValue({ orders: [opened] });
    commerce.requestReturn.mockResolvedValue({ order: opened });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("订单");
    fireEvent.click(await screen.findByRole("button", { name: "申请售后" }));
    const dialog = screen.getByRole("dialog", { name: "申请售后" });
    fireEvent.change(within(dialog).getByLabelText("售后原因"), {
      target: { value: "Wrong product arrived" },
    });
    fireEvent.submit(within(dialog).getByRole("button", { name: "提交售后申请" }).closest("form")!);
    await screen.findByText(
      "售后申请已提交，平台会核实处理；未结售后期间不会释放相关佣金。当前不发生真实退款。",
    );
    expect(commerce.requestReturn).toHaveBeenCalledWith(order.id, {
      request: { itemId: "item-1", reason: "Wrong product arrived" },
      idempotencyKey: expect.any(String),
      expectedUserId: "buyer-1",
    });
  });
  it("acknowledges an accepted return despite a failed history read without offering a duplicate", async () => {
    const paid = { ...order, status: "paid" as const };
    const opened = {
      ...paid,
      items: [{ ...paid.items[0]!, openCase: true, afterSalesStatus: "open" as const }],
    };
    commerce.orders
      .mockResolvedValueOnce({ orders: [paid], page: 0, hasMore: false })
      .mockRejectedValueOnce(new Error("order-history fixture unavailable"));
    commerce.requestReturn.mockResolvedValue({ order: opened });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("订单");
    fireEvent.click(await screen.findByRole("button", { name: "申请售后" }));
    const dialog = screen.getByRole("dialog", { name: "申请售后" });
    fireEvent.change(within(dialog).getByLabelText("售后原因"), {
      target: { value: "尺码与订单不符" },
    });
    fireEvent.submit(within(dialog).getByRole("button", { name: "提交售后申请" }).closest("form")!);
    await screen.findByText(/售后申请已提交/);
    await screen.findByRole("button", { name: "重新读取订单历史" });
    expect(dialog).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "等待平台处理售后" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "申请售后" })).not.toBeInTheDocument();
    expect(commerce.requestReturn).toHaveBeenCalledOnce();
    commerce.orders.mockResolvedValue({ orders: [opened], page: 0, hasMore: false });
    fireEvent.click(screen.getByRole("button", { name: "重新读取订单历史" }));
    await waitFor(() => expect(commerce.orders).toHaveBeenCalledTimes(3));
    expect(commerce.requestReturn).toHaveBeenCalledOnce();
  });

  it("retains an acknowledged return across stale and target-free history until a compatible read", async () => {
    const paid = { ...order, status: "paid" as const };
    const opened = {
      ...paid,
      items: [{ ...paid.items[0]!, openCase: true, afterSalesStatus: "open" as const }],
    };
    const closed = { ...paid, items: [{ ...paid.items[0]!, afterSalesStatus: "closed" as const }] };
    const oldPage = { orders: [paid], page: 0, hasMore: true };
    let finishRead!: (reply: typeof oldPage) => void;
    const pendingRead = new Promise<typeof oldPage>((resolve) => {
      finishRead = resolve;
    });
    commerce.orders
      .mockResolvedValueOnce(oldPage)
      .mockReturnValueOnce(pendingRead)
      .mockResolvedValueOnce({ orders: [], page: 1, hasMore: false })
      .mockResolvedValueOnce(oldPage)
      .mockResolvedValueOnce({ orders: [closed], page: 0, hasMore: true });
    commerce.requestReturn.mockResolvedValue({ order: opened });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("订单");
    fireEvent.click(await screen.findByRole("button", { name: "申请售后" }));
    const dialog = screen.getByRole("dialog", { name: "申请售后" });
    fireEvent.change(within(dialog).getByLabelText("售后原因"), {
      target: { value: "保留已确认的售后记录" },
    });
    fireEvent.submit(within(dialog).getByRole("button", { name: "提交售后申请" }).closest("form")!);
    await screen.findByText(/售后申请已提交/);
    expect(screen.getByRole("button", { name: "等待平台处理售后" })).toBeDisabled();

    await act(async () => finishRead(oldPage));
    expect(screen.getByRole("button", { name: "等待平台处理售后" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "申请售后" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页订单" }));
    await screen.findByText("第 2 页");
    fireEvent.click(screen.getByRole("button", { name: "上一页订单" }));
    await screen.findByText("第 1 页");
    expect(screen.getByRole("button", { name: "等待平台处理售后" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "刷新订单" }));
    await screen.findByText("平台已结束本次售后，不代表退款或到账。");
    expect(screen.getByRole("button", { name: "申请售后" })).toBeEnabled();
    expect(commerce.requestReturn).toHaveBeenCalledOnce();
  });

  it("keeps a lost return locked across closing the form and retries only the same confirmed intent", async () => {
    const paid = { ...order, status: "paid" as const };
    const closed = {
      ...paid,
      items: [{ ...paid.items[0]!, afterSalesStatus: "closed" as const }],
    };
    commerce.orders
      .mockResolvedValueOnce({ orders: [paid], page: 0, hasMore: false })
      .mockRejectedValueOnce(new Error("order-history fixture unavailable"));
    commerce.requestReturn
      .mockRejectedValueOnce(new TypeError("fixture connection interrupted"))
      .mockResolvedValueOnce({ order: closed });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("订单");
    fireEvent.click(await screen.findByRole("button", { name: "申请售后" }));
    const dialog = screen.getByRole("dialog", { name: "申请售后" });
    fireEvent.change(within(dialog).getByLabelText("售后原因"), {
      target: { value: "  收到的商品型号不对  " },
    });
    const form = within(dialog).getByRole("button", { name: "提交售后申请" }).closest("form")!;
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await within(dialog).findByText(/售后申请结果尚未确认/);
    expect(commerce.requestReturn).toHaveBeenCalledOnce();
    expect(commerce.requestReturn).toHaveBeenCalledWith(order.id, {
      request: { itemId: "item-1", reason: "收到的商品型号不对" },
      idempotencyKey: expect.stringMatching(
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
      ),
      expectedUserId: "buyer-1",
    });
    expect(within(dialog).getByLabelText("售后原因")).toHaveAttribute("readonly");
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭申请售后" }));
    expect(dialog).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "申请售后" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "继续核实售后申请" }));
    const reopened = screen.getByRole("dialog", { name: "申请售后" });
    const reason = within(reopened).getByLabelText("售后原因");
    expect(reason).toHaveValue("收到的商品型号不对");
    expect(reason).toHaveAttribute("readonly");
    fireEvent.change(reason, { target: { value: "不要替换已经发送的申请" } });
    expect(commerce.requestReturn).toHaveBeenCalledOnce();

    fireEvent.submit(
      within(reopened).getByRole("button", { name: "重试原售后申请" }).closest("form")!,
    );
    await screen.findByText(/已核实原售后记录/);
    await screen.findByRole("button", { name: "重新读取订单历史" });
    expect(reopened).not.toBeInTheDocument();
    expect(commerce.requestReturn.mock.calls).toEqual([
      commerce.requestReturn.mock.calls[0],
      commerce.requestReturn.mock.calls[0],
    ]);
    expect(screen.getByText("平台已结束本次售后，不代表退款或到账。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "申请售后" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "等待平台处理售后" })).not.toBeInTheDocument();
    expect(commerce.testPay).not.toHaveBeenCalled();
  });

  it.each(["order", "line", "none"] as const)(
    "does not treat a mismatched return %s as an accepted request",
    async (kind) => {
      const paid = { ...order, status: "paid" as const };
      const wrong = {
        ...paid,
        id: kind === "order" ? "other-order" : paid.id,
        items: [
          {
            ...paid.items[0]!,
            id: kind === "line" ? "other-item" : paid.items[0]!.id,
            openCase: kind !== "none",
          },
        ],
      };
      commerce.orders.mockResolvedValue({ orders: [paid] });
      commerce.requestReturn.mockResolvedValue({ order: wrong });
      render(<ShopClient />);
      await screen.findByText(product.name);
      navigate("订单");
      fireEvent.click(await screen.findByRole("button", { name: "申请售后" }));
      const dialog = screen.getByRole("dialog", { name: "申请售后" });
      fireEvent.change(within(dialog).getByLabelText("售后原因"), {
        target: { value: "请核实实际商品明细" },
      });
      fireEvent.submit(
        within(dialog).getByRole("button", { name: "提交售后申请" }).closest("form")!,
      );
      await within(dialog).findByRole("alert");
      expect(within(dialog).getByRole("alert")).toHaveTextContent("返回的售后记录尚未确认");
      expect(within(dialog).getByRole("button", { name: "重试原售后申请" })).toBeEnabled();
      expect(commerce.orders).toHaveBeenCalledOnce();
      expect(commerce.requestReturn).toHaveBeenCalledOnce();
    },
  );

  it.each(["ack", "401"] as const)(
    "does not apply an old buyer's delayed return %s after the account changes",
    async (outcome) => {
      const paid = { ...order, status: "paid" as const };
      let finish!: () => void;
      commerce.orders.mockResolvedValue({ orders: [paid] });
      commerce.requestReturn.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            finish = () =>
              outcome === "401"
                ? reject(new ApiError(401, "commerce_account_changed", "old fixture", null))
                : resolve({ order: { ...paid, items: [{ ...paid.items[0]!, openCase: true }] } });
          }),
      );
      const view = render(<ShopClient />);
      await screen.findByText(product.name);
      navigate("订单");
      fireEvent.click(await screen.findByRole("button", { name: "申请售后" }));
      const dialog = screen.getByRole("dialog", { name: "申请售后" });
      fireEvent.change(within(dialog).getByLabelText("售后原因"), {
        target: { value: "旧账号的售后原因" },
      });
      fireEvent.submit(
        within(dialog).getByRole("button", { name: "提交售后申请" }).closest("form")!,
      );
      expect(commerce.requestReturn).toHaveBeenCalledOnce();

      commerce.orders.mockResolvedValue({ orders: [] });
      authState = {
        ...authState,
        data: {
          session: { id: "buyer-b-session", token: "synthetic-b-never-render" },
          user: {
            id: "buyer-2",
            name: "Buyer Two",
            email: "buyer2@test.invalid",
            emailVerified: true,
          },
        },
      };
      view.rerender(<ShopClient />);
      await waitFor(() => expect(commerce.orders).toHaveBeenCalledTimes(2));
      await screen.findByText("还没有订单");
      await act(async () => finish());
      expect(dialog).not.toBeInTheDocument();
      expect(screen.queryByText("旧账号的售后原因")).not.toBeInTheDocument();
      expect(screen.queryByText(/售后申请已提交|商城登录状态已失效/)).not.toBeInTheDocument();
      expect(commerce.orders).toHaveBeenCalledTimes(2);
      expect(commerce.requestReturn).toHaveBeenCalledOnce();
    },
  );

  it("copies full order and per-parcel references without any order mutation", async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      const saved: CommerceOrder = {
        ...order,
        id: "order-complete-not-just-eight-characters",
        status: "paid",
        items: [
          {
            ...order.items[0]!,
            status: "shipped",
            carrier: "Carrier A",
            trackingNumber: "PARCEL-A-FULL",
          },
          {
            ...order.items[0]!,
            id: "parcel-b-item",
            name: "第二个包裹",
            status: "shipped",
            carrier: "Carrier B",
            trackingNumber: "PARCEL-B-FULL",
          },
        ],
      };
      commerce.orders.mockResolvedValue({ orders: [saved] });
      render(<ShopClient />);
      await screen.findByText(product.name);
      navigate("订单");
      const card = (await screen.findByText(`订单 ${saved.id.slice(0, 8)}`)).closest("article")!;
      expect(writeText).not.toHaveBeenCalled();
      fireEvent.click(within(card).getByRole("button", { name: "复制完整订单号" }));
      await within(card).findByText("完整订单号已复制。");
      expect(writeText).toHaveBeenNthCalledWith(1, saved.id);
      const lines = within(card).getAllByRole("button", { name: "复制运单号" });
      expect(lines).toHaveLength(2);
      fireEvent.click(lines[0]!);
      await waitFor(() => expect(writeText).toHaveBeenNthCalledWith(2, "PARCEL-A-FULL"));
      fireEvent.click(lines[1]!);
      await waitFor(() => expect(writeText).toHaveBeenNthCalledWith(3, "PARCEL-B-FULL"));
      for (const method of [
        commerce.createOrder,
        commerce.testPay,
        commerce.cancel,
        commerce.requestReturn,
      ])
        expect(method).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("does not offer a tracking copy action before a parcel has a reference", async () => {
    commerce.orders.mockResolvedValue({ orders: [order] });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("订单");
    await screen.findByText(`订单 ${order.id.slice(0, 8)}`);
    expect(screen.queryByRole("button", { name: "复制运单号" })).not.toBeInTheDocument();
  });

  it("reorder refreshes catalog prices and adds to cart without creating or paying an order", async () => {
    commerce.orders.mockResolvedValue({ orders: [{ ...order, status: "paid" }] });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("订单");
    const button = await screen.findByRole("button", { name: "再次购买" });
    const before = commerce.catalog.mock.calls.length;
    commerce.catalog.mockResolvedValueOnce({
      products: [{ ...product, priceCents: 7900 }],
      mode: "test",
      currency: "CAD",
    });
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: "购物车与测试结账" });
    expect(within(dialog).getAllByText("CAD 79.00").length).toBeGreaterThan(0);
    expect(commerce.catalog).toHaveBeenCalledTimes(before + 1);
    expect(commerce.createOrder).not.toHaveBeenCalled();
    expect(commerce.testPay).not.toHaveBeenCalled();
    expect(commerce.cancel).not.toHaveBeenCalled();
  });
  it("reorder leaves the cart untouched and reports a failed fresh catalog read", async () => {
    commerce.orders.mockResolvedValue({ orders: [{ ...order, status: "paid" }] });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("订单");
    const button = await screen.findByRole("button", { name: "再次购买" });
    commerce.catalog.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(button);
    await screen.findByRole("alert");
    expect(screen.queryByRole("dialog", { name: "购物车与测试结账" })).not.toBeInTheDocument();
    expect(commerce.createOrder).not.toHaveBeenCalled();
    expect(commerce.testPay).not.toHaveBeenCalled();
    await waitFor(() => expect(button).toBeEnabled());
    commerce.catalog.mockResolvedValueOnce({ products: [product], mode: "test", currency: "CAD" });
    fireEvent.click(button);
    await screen.findByRole("dialog", { name: "购物车与测试结账" });
    expect(commerce.createOrder).not.toHaveBeenCalled();
    expect(commerce.testPay).not.toHaveBeenCalled();
  });
  it("reorder adjusts quantities against fresh stock and preserves existing cart items", async () => {
    commerce.orders.mockResolvedValue({
      orders: [
        {
          ...order,
          status: "paid",
          totalCents: 15600,
          items: [{ ...order.items[0]!, quantity: 4, lineCents: 15600 }],
        },
      ],
    });
    render(<ShopClient />);
    await screen.findByText(product.name);
    fireEvent.click(screen.getByRole("button", { name: `将${product.name}加入购物车` }));
    navigate("订单");
    const button = await screen.findByRole("button", { name: "再次购买" });
    commerce.catalog.mockResolvedValueOnce({
      products: [{ ...product, stock: 2 }],
      mode: "test",
      currency: "CAD",
    });
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: "购物车与测试结账" });
    expect(within(dialog).getByText("2", { exact: true })).toBeInTheDocument();
    expect(within(dialog).getByText(/^商品小计\s+CAD 78\.00$/)).toBeInTheDocument();
    expect(screen.getByText(/部分商品已下架、缺货或数量受限/)).toBeInTheDocument();
    expect(commerce.createOrder).not.toHaveBeenCalled();
    expect(commerce.testPay).not.toHaveBeenCalled();
  });
  it("reorder blocks repeat clicks while refreshing and explains sold-out results without opening checkout", async () => {
    commerce.orders.mockResolvedValue({ orders: [{ ...order, status: "paid" }] });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("订单");
    const button = await screen.findByRole("button", { name: "再次购买" });
    const before = commerce.catalog.mock.calls.length;
    let finish!: (value: unknown) => void;
    commerce.catalog.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(commerce.catalog).toHaveBeenCalledTimes(before + 1);
    await act(async () =>
      finish({ products: [{ ...product, stock: 0 }], mode: "test", currency: "CAD" }),
    );
    expect(screen.getByText(/没有新增商品/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "购物车与测试结账" })).not.toBeInTheDocument();
    expect(commerce.createOrder).not.toHaveBeenCalled();
    expect(commerce.testPay).not.toHaveBeenCalled();
  });
  it("reorder ignores a late catalog result after the account scope changes", async () => {
    commerce.orders.mockResolvedValue({ orders: [{ ...order, status: "paid" }] });
    const view = render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("订单");
    const button = await screen.findByRole("button", { name: "再次购买" });
    let finish!: (value: unknown) => void;
    commerce.catalog.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    authState = {
      ...authState,
      data: {
        session: { id: "B-session", token: "B-never-render" },
        user: {
          id: "buyer-2",
          name: "Buyer Two",
          email: "buyer2@test.invalid",
          emailVerified: true,
        },
      },
    };
    view.rerender(<ShopClient />);
    await waitFor(() => expect(commerce.me).toHaveBeenCalledTimes(2));
    await act(async () =>
      finish({ products: [{ ...product, priceCents: 9900 }], mode: "test", currency: "CAD" }),
    );
    expect(screen.queryByRole("dialog", { name: "购物车与测试结账" })).not.toBeInTheDocument();
    expect(commerce.createOrder).not.toHaveBeenCalled();
    expect(commerce.testPay).not.toHaveBeenCalled();
  });
  it("reorder does not offer another purchase while the original order awaits payment", async () => {
    commerce.orders.mockResolvedValue({ orders: [order] });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("订单");
    await screen.findByRole("button", { name: "确认测试付款" });
    expect(screen.queryByRole("button", { name: "再次购买" })).not.toBeInTheDocument();
  });
  it("keeps ordering and withdrawals disabled when backend commerce mode is disabled", async () => {
    commerce.catalog.mockResolvedValue({ products: [product], currency: "CAD", mode: "disabled" });
    commerce.me.mockResolvedValue({
      ...initialProfile,
      wallet: { ...initialProfile.wallet, availableCents: 2500 },
    });
    render(<ShopClient />);
    await screen.findByText(product.name);
    navigate("我的");
    expect(await screen.findByRole("button", { name: "申请测试提现" })).toBeDisabled();
    expect(screen.getByText("商城交易未启用 · 不接受真实付款或提现")).toBeInTheDocument();
  });
  it.each(["signed-in", "guest"])(
    "shows a cart-only dialog without collecting checkout details when commerce is disabled for %s",
    async (account) => {
      commerce.catalog.mockResolvedValue({
        products: [product],
        currency: "CAD",
        mode: "disabled",
      });
      if (account === "guest") authState = { ...authState, data: null };
      render(<ShopClient />);
      await screen.findByText(product.name);
      fireEvent.click(screen.getByRole("button", { name: `将${product.name}加入购物车` }));
      fireEvent.click(screen.getByRole("button", { name: "购物车，1件商品" }));
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveAccessibleName("购物车");
      expect(within(dialog).getByText(product.name)).toBeInTheDocument();
      expect(within(dialog).getByText(/商城暂未开放结账/)).toBeInTheDocument();
      const lookup = within(dialog).queryByTestId("optional-address-lookup");
      if (account === "guest") expect(lookup).not.toBeInTheDocument();
      else expect(lookup).toBeInTheDocument();
      expect(within(dialog).queryByRole("link", { name: /登录后结账/ })).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: /创建测试订单/ }),
      ).not.toBeInTheDocument();
      expect(dialog.querySelector("form")).toBeNull();
      expect(dialog).not.toHaveTextContent(/测试结账|测试订单/);
      for (const label of ["收件人", "地址", "城市", "省／地区", "邮编"])
        expect(within(dialog).queryByLabelText(label)).not.toBeInTheDocument();
      const remove = within(dialog).getByRole("button", { name: `移除${product.name}` });
      expect(remove).toBeEnabled();
      fireEvent.click(remove);
      expect(within(dialog).getByText(/购物车还是空的/)).toBeInTheDocument();
      expect(commerce.createOrder).not.toHaveBeenCalled();
      expect(commerce.testPay).not.toHaveBeenCalled();
    },
  );
});

describe("account-owned favorites", () => {
  const openFavorites = async () => {
    navigate("我的");
    fireEvent.click(await screen.findByRole("button", { name: /^我的收藏/ }));
  };
  it("retries a failed product image only on remount or a changed image URL", async () => {
    const initialUrl = "/shop/original-product.webp";
    const updatedUrl = "/shop/new-product.webp";
    const catalog = (imageUrl: string) => ({
      products: [{ ...product, imageUrl }],
      mode: "test",
      currency: "CAD",
    });
    commerce.catalog.mockResolvedValue(catalog(initialUrl));
    commerce.favorites.mockResolvedValue({ userId: "buyer-1", productIds: [product.id] });
    render(<ShopClient />);
    await screen.findByText(product.name);
    await openFavorites();
    const card = (await screen.findByRole("heading", { name: product.name })).closest("button")!;
    fireEvent.error(within(card).getByRole("img", { name: product.name }));
    const refresh = screen.getByRole("button", { name: "刷新收藏" });

    fireEvent.click(refresh);
    await waitFor(() => expect(refresh).toBeEnabled());
    expect(within(card).getByLabelText("暂无商品图片")).toBeVisible();
    expect(card.querySelector("img")).toBeNull();

    for (const nextUrl of [updatedUrl, initialUrl]) {
      commerce.catalog.mockResolvedValueOnce(catalog(nextUrl));
      fireEvent.click(refresh);
      await waitFor(() =>
        expect(within(card).getByRole("img", { name: product.name })).toHaveAttribute(
          "src",
          nextUrl,
        ),
      );
      expect(within(card).queryByLabelText("暂无商品图片")).not.toBeInTheDocument();
    }
  });
  it("reads account favorites on mount and makes them available from mine", async () => {
    commerce.favorites.mockResolvedValue({ userId: "buyer-1", productIds: [product.id] });
    render(<ShopClient />);
    expect(await screen.findByRole("button", { name: `取消收藏${product.name}` })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(commerce.favorites).toHaveBeenCalledWith("buyer-1");
    await openFavorites();
    expect(await screen.findByRole("heading", { name: "我的收藏" })).toBeInTheDocument();
    expect(screen.getByText(product.name)).toBeInTheDocument();
    expect(commerce.createOrder).not.toHaveBeenCalled();
    expect(uploadCommerceImage).not.toHaveBeenCalled();
  });
  it("waits for confirmed saving and blocks duplicate clicks, without optimistic success", async () => {
    let finish!: (value: unknown) => void;
    commerce.setFavorite.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<ShopClient />);
    const button = await screen.findByRole("button", { name: `收藏${product.name}` });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    fireEvent.click(button);
    expect(commerce.setFavorite).toHaveBeenCalledExactlyOnceWith("buyer-1", product.id, true);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toBeDisabled();
    await act(async () => finish({ userId: "buyer-1", productId: product.id, saved: true }));
    expect(await screen.findByRole("button", { name: `取消收藏${product.name}` })).toBeEnabled();
  });
  it("does not report a failed read as empty, and refreshes catalog with cross-device favorites", async () => {
    commerce.favorites.mockRejectedValueOnce(new TypeError("offline"));
    render(<ShopClient />);
    await screen.findByText(product.name);
    await openFavorites();
    expect(await screen.findByRole("alert")).toHaveTextContent("收藏尚未读取成功");
    expect(screen.queryByText(/还没有收藏商品/)).not.toBeInTheDocument();
    const newProduct = { ...product, id: "new-product", name: "其他设备收藏的杯子" };
    commerce.favorites.mockResolvedValue({ userId: "buyer-1", productIds: [newProduct.id] });
    commerce.catalog.mockResolvedValue({
      products: [product, newProduct],
      mode: "test",
      currency: "CAD",
    });
    fireEvent.click(screen.getByRole("button", { name: "刷新收藏" }));
    expect(await screen.findByText(newProduct.name)).toBeInTheDocument();
    expect(screen.queryByText("商品暂不可售")).not.toBeInTheDocument();
  });
  it("requires refreshing an uncertain save instead of blindly repeating it", async () => {
    commerce.setFavorite.mockRejectedValueOnce(new TypeError("response lost"));
    render(<ShopClient />);
    const button = await screen.findByRole("button", { name: `收藏${product.name}` });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    await openFavorites();
    expect(await screen.findByRole("alert")).toHaveTextContent("保存结果待核实");
    commerce.favorites.mockResolvedValue({ userId: "buyer-1", productIds: [product.id] });
    fireEvent.click(screen.getByRole("button", { name: "刷新收藏" }));
    expect(await screen.findByRole("button", { name: `取消收藏${product.name}` })).toBeEnabled();
    expect(commerce.setFavorite).toHaveBeenCalledTimes(1);
  });
  it.each(["empty", "failed"] as const)(
    "clears a stale favorite success when an explicit refresh is %s",
    async (result) => {
      render(<ShopClient />);
      const save = await screen.findByRole("button", { name: `收藏${product.name}` });
      await waitFor(() => expect(save).toBeEnabled());
      fireEvent.click(save);
      await screen.findByText("已保存到账号收藏，可在其他设备登录后查看。");
      await openFavorites();
      if (result === "failed") commerce.favorites.mockRejectedValueOnce(new TypeError("offline"));
      else commerce.favorites.mockResolvedValueOnce({ userId: "buyer-1", productIds: [] });
      fireEvent.click(screen.getByRole("button", { name: "刷新收藏" }));
      if (result === "failed")
        expect(await screen.findByRole("alert")).toHaveTextContent("收藏尚未读取成功");
      else expect(await screen.findByText(/还没有收藏商品/)).toBeInTheDocument();
      expect(
        screen.queryByText("已保存到账号收藏，可在其他设备登录后查看。"),
      ).not.toBeInTheDocument();
    },
  );
  it("prompts guests to sign in without creating or uploading favorites", async () => {
    authState.data = null;
    render(<ShopClient />);
    fireEvent.click(await screen.findByRole("button", { name: `收藏${product.name}` }));
    expect(await screen.findByText(/登录商城账号后即可收藏/)).toBeInTheDocument();
    expect(commerce.favorites).not.toHaveBeenCalled();
    expect(commerce.setFavorite).not.toHaveBeenCalled();
  });
  it("allows unverified buyers to read existing favorites but not change them", async () => {
    authState.data!.user.emailVerified = false;
    commerce.favorites.mockResolvedValue({ userId: "buyer-1", productIds: [product.id] });
    render(<ShopClient />);
    expect(await screen.findByRole("button", { name: `取消收藏${product.name}` })).toBeDisabled();
    await openFavorites();
    expect(await screen.findByText(/验证邮箱后可以修改收藏/)).toBeInTheDocument();
    expect(commerce.setFavorite).not.toHaveBeenCalled();
  });
  it.each(["read", "write"])(
    "ignores a late old-account favorite %s, including a late 401",
    async (kind) => {
      let reject!: (cause: unknown) => void;
      const pending = new Promise((_resolve, fail) => {
        reject = fail;
      });
      if (kind === "read") commerce.favorites.mockReturnValueOnce(pending);
      else commerce.setFavorite.mockReturnValueOnce(pending);
      const view = render(<ShopClient />);
      await screen.findByText(product.name);
      if (kind === "write") {
        const button = screen.getByRole("button", { name: `收藏${product.name}` });
        await waitFor(() => expect(button).toBeEnabled());
        fireEvent.click(button);
      }
      authState.data = {
        session: { id: "B-session", token: "B-never-render" },
        user: {
          id: "buyer-2",
          name: "Buyer Two",
          email: "buyer2@test.invalid",
          emailVerified: true,
        },
      };
      commerce.favorites.mockResolvedValue({ userId: "buyer-2", productIds: [] });
      view.rerender(<ShopClient />);
      await waitFor(() => expect(commerce.favorites).toHaveBeenCalledWith("buyer-2"));
      await act(async () => reject(new ApiError(401, "commerce_account_changed", "old A", null)));
      navigate("我的");
      expect(await screen.findByText(/Buyer Two/)).toBeInTheDocument();
      expect(screen.queryByText(/商城账号已变化，请重新登录后核实收藏/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "我的收藏 · 0" })).toBeInTheDocument();
    },
  );
  it("remains usable after StrictMode replay and permits removing an unavailable saved id", async () => {
    commerce.favorites.mockResolvedValue({ userId: "buyer-1", productIds: ["no-longer-listed"] });
    render(
      <StrictMode>
        <ShopClient />
      </StrictMode>,
    );
    await screen.findByText(product.name);
    await openFavorites();
    expect(await screen.findByText("商品暂不可售")).toBeInTheDocument();
    const remove = screen.getByRole("button", { name: "取消收藏暂不可售商品" });
    await waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);
    expect(commerce.setFavorite).toHaveBeenCalledExactlyOnceWith(
      "buyer-1",
      "no-longer-listed",
      false,
    );
    expect(await screen.findByText(/还没有收藏商品/)).toBeInTheDocument();
  });
});
