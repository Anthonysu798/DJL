import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const { commerce, auth } = vi.hoisted(() => ({
  auth: {
    useSession: vi.fn(),
    signOut: vi.fn(),
    refetch: vi.fn(),
    $store: { atoms: { session: { get: vi.fn() } } },
  },
  commerce: {
    me: vi.fn(),
    supplierProducts: vi.fn(),
    supplierOrders: vi.fn(),
    updateStock: vi.fn(),
    accept: vi.fn(),
    ship: vi.fn(),
    reportSupplierIssue: vi.fn(),
  },
}));
vi.mock("@/lib/auth-client", () => ({ authClient: auth }));
vi.mock("@/lib/commerce", async (original) => ({
  ...(await original<typeof import("@/lib/commerce")>()),
  commerce,
}));
import SupplierPage from "./page";
import { ApiError } from "@/lib/api";

let authState: {
  data: { session: { id: string }; user: { id: string } } | null;
  isPending: boolean;
  error: unknown;
};

const item = {
  id: "item-1",
  orderId: "order-1",
  productId: "product-1",
  sku: null,
  name: "测试商品",
  quantity: 1,
  priceCents: 1000,
  lineCents: 1000,
  refundedCents: 0,
  status: "pending",
  carrier: null,
  trackingNumber: null,
  deliveredAt: null,
  openCase: false,
  returnDays: 30,
  address: {
    name: "Test",
    line1: "1 Test Road",
    city: "Toronto",
    province: "ON",
    postalCode: "M5V 2T6",
    country: "CA",
  },
};
beforeEach(() => {
  authState = {
    data: { session: { id: "supplier-session-a" }, user: { id: "supplier-user-a" } },
    isPending: false,
    error: null,
  };
  auth.useSession.mockReset();
  auth.refetch.mockReset();
  auth.refetch.mockResolvedValue(undefined);
  auth.useSession.mockImplementation(() => ({ ...authState, refetch: auth.refetch }));
  auth.$store.atoms.session.get.mockReset();
  auth.$store.atoms.session.get.mockImplementation(() => ({
    ...authState,
    isRefetching: false,
    refetch: auth.refetch,
  }));
  auth.signOut.mockReset();
  for (const method of Object.values(commerce)) method.mockReset();
  commerce.me.mockResolvedValue({ suppliers: [{ id: "supplier-1", name: "Test Supplier" }] });
  commerce.supplierProducts.mockResolvedValue({ products: [] });
  commerce.supplierOrders.mockResolvedValue({ orders: [item] });
  commerce.accept.mockResolvedValue({ ok: true });
  commerce.ship.mockResolvedValue({ ok: true });
  commerce.reportSupplierIssue.mockResolvedValue({ ok: true });
});

it.each(["supplierProducts", "supplierOrders"] as const)(
  "does not call an unread %s failure an empty supplier list and verifies records after retry",
  async (method) => {
    commerce[method].mockRejectedValueOnce(
      new ApiError(500, "internal_error", "Synthetic supplier read failure", null),
    );
    render(<SupplierPage />);
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
    expect(screen.queryByText("尚无授权商品。")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无需要履约的订单。")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByText("1 Test Road", { exact: false });
    expect(screen.getByText("尚无授权商品。")).toBeInTheDocument();
    expect(screen.queryByText("暂无需要履约的订单。")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(commerce.supplierProducts).toHaveBeenCalledTimes(2);
    expect(commerce.supplierOrders).toHaveBeenCalledTimes(2);
    expect(commerce.accept).not.toHaveBeenCalled();
    expect(commerce.ship).not.toHaveBeenCalled();
    expect(commerce.updateStock).not.toHaveBeenCalled();
  },
);
it.each(["supplierProducts", "supplierOrders"] as const)(
  "keeps the previous supplier records visibly unconfirmed after a later %s failure",
  async (method) => {
    const savedProduct = {
      id: "saved-product",
      sku: "SAVED-SKU-1",
      name: "上次已读库存商品",
      description: "Synthetic supplier fixture",
      category: "测试",
      imageUrl: "",
      priceCents: 1000,
      stock: 7,
      reserved: 2,
      commissionBps: 1000,
      returnDays: 30,
    };
    commerce.supplierProducts.mockResolvedValue({ products: [savedProduct] });
    render(<SupplierPage />);
    await screen.findByText(savedProduct.name);
    await screen.findByText("1 Test Road", { exact: false });
    commerce[method].mockRejectedValueOnce(
      new ApiError(500, "internal_error", "Synthetic supplier refresh failure", null),
    );
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByRole("alert");
    expect(screen.getByText(savedProduct.name)).toBeInTheDocument();
    expect(screen.getByText("1 Test Road", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText(/可能.*过期|当前未确认/).length).toBeGreaterThan(0);
    expect(screen.queryByText("尚无授权商品。")).not.toBeInTheDocument();
    expect(screen.queryByText("暂无需要履约的订单。")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled());
    commerce.supplierProducts.mockResolvedValue({
      products: [Object.assign({}, savedProduct, { stock: 9 })],
    });
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByText("总库存：9");
    expect(screen.queryByText(/可能.*过期|当前未确认/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(commerce.accept).not.toHaveBeenCalled();
    expect(commerce.ship).not.toHaveBeenCalled();
    expect(commerce.updateStock).not.toHaveBeenCalled();
  },
);

it("never requests private supplier data while the original authentication session is pending", async () => {
  authState = { data: null, isPending: true, error: null };
  render(<SupplierPage />);
  await act(async () => {});
  expect(screen.getByRole("status")).toHaveTextContent("正在读取供应商授权");
  expect(commerce.me).not.toHaveBeenCalled();
  expect(commerce.supplierProducts).not.toHaveBeenCalled();
  expect(commerce.supplierOrders).not.toHaveBeenCalled();
  expect(screen.queryByText("1 Test Road")).not.toBeInTheDocument();
});
it.each(["changed-user", "unauthorized"] as const)(
  "does not trust a cached authenticated supplier before first verification returns %s",
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
                    data: { session: { id: "fresh-supplier-b" }, user: { id: "supplier-user-b" } },
                    isPending: false,
                    error: null,
                  }
                : { ...authState, error: { status: 401 } };
            auth.useSession.mockReturnValue({ ...cached, refetch: auth.refetch });
            resolve();
          };
        }),
    );
    commerce.supplierOrders.mockResolvedValue({
      orders: [{ ...item, address: { ...item.address, line1: "Fresh B Address" } }],
    });
    render(<SupplierPage />);
    expect(auth.refetch).toHaveBeenCalledOnce();
    expect(auth.refetch).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
    expect(commerce.me).not.toHaveBeenCalled();
    expect(commerce.supplierOrders).not.toHaveBeenCalled();
    expect(screen.queryByText("1 Test Road", { exact: false })).not.toBeInTheDocument();
    await act(async () => finish());
    if (outcome === "changed-user") await screen.findByText("Fresh B Address", { exact: false });
    else {
      await screen.findByText(/原收货地址和操作已隐藏/);
      expect(commerce.supplierOrders).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "确认发货" })).not.toBeInTheDocument();
    }
    expect(screen.queryByText("1 Test Road", { exact: false })).not.toBeInTheDocument();
  },
);
it.each([401, 403])(
  "hides previous addresses and supplier actions after a %s without signing other applications out",
  async (status) => {
    render(<SupplierPage />);
    await screen.findByText("1 Test Road", { exact: false });
    commerce.me.mockRejectedValueOnce(
      new ApiError(status, status === 401 ? "unauthorized" : "supplier_required", "Denied", null),
    );
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await screen.findByText(/原收货地址和操作已隐藏/);
    expect(screen.queryByText("1 Test Road", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认接单" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认发货" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "登录 DJL" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新核实账号" })).not.toBeInTheDocument();
    expect(auth.signOut).not.toHaveBeenCalled();
  },
);
it("does not refill another supplier session with addresses from an old pending refresh", async () => {
  let finish!: (value: { orders: (typeof item)[] }) => void;
  commerce.supplierOrders
    .mockResolvedValueOnce({ orders: [item] })
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue({
      orders: [
        {
          ...item,
          id: "new-item",
          address: { ...item.address, line1: "New Supplier Only Address" },
        },
      ],
    });
  const { rerender } = render(<SupplierPage />);
  await screen.findByText("1 Test Road", { exact: false });
  fireEvent.click(screen.getByRole("button", { name: "刷新" }));
  await waitFor(() => expect(commerce.supplierOrders).toHaveBeenCalledTimes(2));
  authState = {
    data: { session: { id: "supplier-session-b" }, user: { id: "supplier-user-b" } },
    isPending: false,
    error: null,
  };
  rerender(<SupplierPage />);
  await screen.findByText("New Supplier Only Address", { exact: false });
  await act(async () => finish({ orders: [item] }));
  expect(screen.queryByText("1 Test Road", { exact: false })).not.toBeInTheDocument();
  expect(screen.getByText("New Supplier Only Address", { exact: false })).toBeInTheDocument();
});
it("hides old supplier addresses immediately when fresh membership scope changes within the same login", async () => {
  let finish!: (value: { orders: (typeof item)[] }) => void;
  render(<SupplierPage />);
  await screen.findByText("1 Test Road", { exact: false });
  commerce.me.mockResolvedValue({ suppliers: [{ id: "supplier-b", name: "Changed Supplier" }] });
  commerce.supplierOrders.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "刷新" }));
  await screen.findByText(/授权供应商：Changed Supplier/);
  expect(screen.queryByText("1 Test Road", { exact: false })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认发货" })).not.toBeInTheDocument();
  await act(async () => finish({ orders: [] }));
});

it("does not request supplier data for a normal user or AI team owner", async () => {
  commerce.me.mockResolvedValue({ suppliers: [] });
  render(<SupplierPage />);
  await screen.findByText(
    "当前账号没有供应商授权。普通用户和 AI 团队管理员不会自动拥有供货权限，请联系平台运营。",
  );
  expect(commerce.supplierProducts).not.toHaveBeenCalled();
  expect(commerce.supplierOrders).not.toHaveBeenCalled();
});
it("distinguishes same-name supplier SKUs and preserves legacy fulfillment SKU absence", async () => {
  commerce.supplierProducts.mockResolvedValue({
    products: [
      {
        id: "red-product",
        name: "同名商品",
        sku: "CURRENT-RED",
        stock: 5,
        reserved: 0,
        priceCents: 1000,
      },
      {
        id: "blue-product",
        name: "同名商品",
        sku: "CURRENT-BLUE",
        stock: 5,
        reserved: 0,
        priceCents: 1000,
      },
    ],
  });
  commerce.supplierOrders.mockResolvedValue({
    orders: [
      { ...item, id: "red-line", name: "同名商品", sku: "ORDER-RED" },
      { ...item, id: "blue-line", name: "同名商品", sku: "ORDER-BLUE" },
      { ...item, id: "legacy-line", sku: null },
    ],
  });
  render(<SupplierPage />);
  expect(await screen.findByText("SKU：CURRENT-RED")).toBeInTheDocument();
  expect(screen.getByText("SKU：CURRENT-BLUE")).toBeInTheDocument();
  expect(screen.getByText("SKU：ORDER-RED")).toBeInTheDocument();
  expect(screen.getByText("SKU：ORDER-BLUE")).toBeInTheDocument();
  expect(screen.getByText("历史订单未记录 SKU")).toBeInTheDocument();
  const input = screen.getByRole("spinbutton", { name: "同名商品（CURRENT-BLUE）库存" });
  fireEvent.change(input, { target: { value: "3" } });
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(commerce.updateStock).toHaveBeenCalledWith("blue-product", 3));
});
it("separates total, reserved and sellable stock and keeps the stock update at the reserved boundary", async () => {
  const inventory = {
    id: "reserved-product",
    name: "预占演示商品",
    sku: "RESERVED-1",
    stock: 5,
    reserved: 4,
    priceCents: 1000,
  };
  commerce.supplierProducts
    .mockResolvedValueOnce({ products: [inventory] })
    .mockResolvedValue({ products: [{ ...inventory, stock: 4 }] });
  commerce.supplierOrders.mockResolvedValue({ orders: [] });
  commerce.updateStock.mockResolvedValue({ ok: true });
  render(<SupplierPage />);
  const input = await screen.findByRole("spinbutton", { name: "预占演示商品（RESERVED-1）库存" });
  const row = input.closest("tr")!;
  expect(row).toHaveTextContent(/总库存[：:\s]*5/);
  expect(row).toHaveTextContent(/已预占[：:\s]*4/);
  expect(row).toHaveTextContent(/可售[：:\s]*1/);
  expect(input).toHaveAttribute("min", "4");
  expect(row).toHaveTextContent(/至少.*4.*件/);
  fireEvent.change(input, { target: { value: "3" } });
  expect(input).toBeInvalid();
  await act(async () => {
    fireEvent.click(within(row).getByRole("button", { name: "更新" }));
  });
  expect(commerce.updateStock).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "4" } });
  expect(input).toBeValid();
  fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(commerce.updateStock).toHaveBeenCalledWith("reserved-product", 4));
  expect(commerce.updateStock).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(row).toHaveTextContent(/总库存[：:\s]*4/));
  expect(row).toHaveTextContent(/已预占[：:\s]*4/);
  expect(row).toHaveTextContent(/可售[：:\s]*0/);
});
it("can page through supplier inventory and actionable fulfillment independently", async () => {
  commerce.supplierProducts.mockImplementation(async (page = 0) => ({
    products: [],
    page,
    hasMore: page === 0,
  }));
  commerce.supplierOrders.mockImplementation(async (page = 0) => ({
    orders: [{ ...item, id: `item-${page}`, name: `Test item page ${page}` }],
    page,
    hasMore: page === 0,
  }));
  render(<SupplierPage />);
  fireEvent.click(await screen.findByRole("button", { name: "下一页商品" }));
  await waitFor(() => expect(commerce.supplierProducts).toHaveBeenLastCalledWith(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "下一页订单" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "下一页订单" }));
  await screen.findByText("Test item page 1 × 1");
  expect(commerce.supplierProducts).toHaveBeenLastCalledWith(1);
  expect(commerce.supplierOrders).toHaveBeenLastCalledWith(1);
});
it("accepts and records tracking using supplier-only endpoints, never auto-delivers", async () => {
  render(<SupplierPage />);
  expect(
    screen.getByText(
      "供应商履约后台 · TEST 测试环境，非真实交易或到账 · 仅显示明确授权给你的供应商数据",
    ),
  ).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "确认接单" }));
  await waitFor(() => expect(commerce.accept).toHaveBeenCalledWith("item-1"));
  await waitFor(() => expect(screen.getByRole("button", { name: "确认发货" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("承运商"), { target: { value: "Test Carrier" } });
  fireEvent.change(screen.getByLabelText("运单号"), { target: { value: "TEST-TRACKING" } });
  fireEvent.submit(screen.getByRole("button", { name: "确认发货" }).closest("form")!);
  await waitFor(() =>
    expect(commerce.ship).toHaveBeenCalledWith("item-1", "TEST-TRACKING", "Test Carrier"),
  );
  expect(screen.queryByRole("button", { name: "确认签收" })).not.toBeInTheDocument();
});
it("blocks acceptance and shipping controls while an aftersales case is open", async () => {
  commerce.supplierOrders.mockResolvedValue({ orders: [{ ...item, openCase: true }] });
  render(<SupplierPage />);
  await screen.findByText("该商品正在处理售后，请等待平台核实，暂勿发货。");
  expect(screen.queryByRole("button", { name: "确认接单" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认发货" })).not.toBeInTheDocument();
});
it("reports a supplier shortage then shows the server hold without pretending to refund or change stock", async () => {
  render(<SupplierPage />);
  await screen.findByRole("button", { name: "确认接单" });
  commerce.supplierOrders.mockResolvedValue({
    orders: [
      {
        ...item,
        openCase: true,
        supplierIssue: {
          kind: "out_of_stock",
          reason: "Canadian warehouse unavailable",
          reportedAt: "2026-10-26T00:00:00Z",
        },
      },
    ],
  });
  fireEvent.change(screen.getByLabelText("问题说明"), {
    target: { value: "Canadian warehouse unavailable" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "提交问题给平台" }).closest("form")!);
  await waitFor(() =>
    expect(commerce.reportSupplierIssue).toHaveBeenCalledWith(
      "item-1",
      "out_of_stock",
      "Canadian warehouse unavailable",
      expect.any(String),
    ),
  );
  await screen.findByText("该商品正在处理售后，请等待平台核实，暂勿发货。");
  expect(screen.getByText(/最近一次供应商反馈（缺货）/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认发货" })).not.toBeInTheDocument();
  expect(commerce.updateStock).not.toHaveBeenCalled();
  expect(commerce.ship).not.toHaveBeenCalled();
});
it("holds stale fulfillment controls after a lost report result and reuses the same key for a retry", async () => {
  commerce.reportSupplierIssue.mockRejectedValueOnce(new TypeError("Connection lost"));
  render(<SupplierPage />);
  await screen.findByRole("button", { name: "确认接单" });
  fireEvent.change(screen.getByLabelText("问题说明"), {
    target: { value: "Need platform review" },
  });
  const form = screen.getByRole("button", { name: "提交问题给平台" }).closest("form")!;
  fireEvent.submit(form);
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: "确认接单" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "确认发货" })).not.toBeInTheDocument();
  expect(screen.getByText(/问题报告状态尚待查询/)).toBeInTheDocument();
  const first = commerce.reportSupplierIssue.mock.calls[0]!;
  fireEvent.submit(form);
  await waitFor(() => expect(commerce.reportSupplierIssue).toHaveBeenCalledTimes(2));
  expect(commerce.reportSupplierIssue.mock.calls[1]).toEqual(first);
});
it("does not offer an out-of-stock report for an already shipped item", async () => {
  commerce.supplierOrders.mockResolvedValue({ orders: [{ ...item, status: "shipped" }] });
  render(<SupplierPage />);
  await screen.findByText("已发货");
  expect(screen.queryByRole("option", { name: "缺货 / 无法供货" })).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: "履约延期" })).toBeInTheDocument();
});
it("can report unfinished return handling after a full refund, without offering new supply or shipment", async () => {
  commerce.supplierOrders.mockResolvedValue({
    orders: [{ ...item, status: "delivered", refundedCents: 1000, openCase: true }],
  });
  render(<SupplierPage />);
  await screen.findByText("已签收");
  expect(screen.queryByRole("option", { name: "缺货 / 无法供货" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "履约延期" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("问题说明"), {
    target: { value: "Return parcel has not reached warehouse" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "提交问题给平台" }).closest("form")!);
  await waitFor(() =>
    expect(commerce.reportSupplierIssue).toHaveBeenCalledWith(
      "item-1",
      "other",
      "Return parcel has not reached warehouse",
      expect.any(String),
    ),
  );
  expect(commerce.ship).not.toHaveBeenCalled();
});

it.each([429, 500])(
  "lets an unconfirmed supplier explicitly retry HTTP %s without trusting its cached identity",
  async (status) => {
    const cached = authState;
    authState = { ...authState, error: { status } };
    render(<SupplierPage />);
    await screen.findByRole("status", { name: "供应商账号核实" });
    await waitFor(() => expect(screen.getByRole("button", { name: "重新核实账号" })).toBeEnabled());
    const notice = screen.getByRole("status", { name: "供应商账号核实" });
    expect(notice).toHaveTextContent(status === 429 ? "请求过于频繁" : "暂时无法核实供应商账号");
    expect(screen.queryByText(/登录状态或供应商授权已失效/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "登录 DJL" })).not.toBeInTheDocument();
    expect(commerce.me).not.toHaveBeenCalled();
    expect(commerce.supplierOrders).not.toHaveBeenCalled();
    let finish!: () => void;
    auth.refetch.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            authState = {
              data: { session: { id: "fresh-session-b" }, user: { id: "supplier-b" } },
              isPending: false,
              error: null,
            };
            auth.useSession.mockReturnValue({ ...cached, refetch: auth.refetch });
            resolve();
          };
        }),
    );
    commerce.supplierOrders.mockResolvedValue({
      orders: [{ ...item, address: { ...item.address, line1: "Fresh Supplier Only Address" } }],
    });
    fireEvent.click(screen.getByRole("button", { name: "重新核实账号" }));
    expect(screen.getByRole("button", { name: "重新核实账号" })).toBeDisabled();
    expect(screen.queryByText("1 Test Road", { exact: false })).not.toBeInTheDocument();
    expect(commerce.me).not.toHaveBeenCalled();
    await act(async () => finish());
    await screen.findByText("Fresh Supplier Only Address", { exact: false });
    expect(screen.queryByText("1 Test Road", { exact: false })).not.toBeInTheDocument();
    expect(auth.refetch).toHaveBeenCalledTimes(2);
    expect(auth.refetch).toHaveBeenLastCalledWith({ query: { disableCookieCache: true } });
    expect(auth.signOut).not.toHaveBeenCalled();
    for (const method of ["accept", "ship", "updateStock", "reportSupplierIssue"] as const)
      expect(commerce[method]).not.toHaveBeenCalled();
  },
);

it("keeps another 429 unconfirmed without an automatic retry loop or supplier mutation replay", async () => {
  authState = { ...authState, error: { status: 429 } };
  sessionStorage.setItem("djl-ai-draft-supplier-test", "unsent AI draft");
  render(<SupplierPage />);
  await waitFor(() => expect(screen.getByRole("button", { name: "重新核实账号" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "重新核实账号" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "重新核实账号" })).toBeEnabled());
  await act(async () => {});
  expect(auth.refetch).toHaveBeenCalledTimes(2);
  expect(commerce.me).not.toHaveBeenCalled();
  expect(commerce.supplierProducts).not.toHaveBeenCalled();
  expect(commerce.supplierOrders).not.toHaveBeenCalled();
  for (const method of ["accept", "ship", "updateStock", "reportSupplierIssue"] as const)
    expect(commerce[method]).not.toHaveBeenCalled();
  expect(auth.signOut).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("djl-ai-draft-supplier-test")).toBe("unsent AI draft");
});

it("does not request supplier data when an explicit retry completes after unmount", async () => {
  authState = { ...authState, error: { status: 429 } };
  const { unmount } = render(<SupplierPage />);
  await waitFor(() => expect(screen.getByRole("button", { name: "重新核实账号" })).toBeEnabled());
  let finish!: () => void;
  auth.refetch.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = () => {
          authState = { ...authState, error: null };
          resolve();
        };
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "重新核实账号" }));
  unmount();
  await act(async () => finish());
  expect(commerce.me).not.toHaveBeenCalled();
  expect(commerce.supplierOrders).not.toHaveBeenCalled();
  expect(auth.signOut).not.toHaveBeenCalled();
});

it("shows the login link only after the retry actually confirms an anonymous account", async () => {
  authState = { ...authState, error: { status: 429 } };
  let finishInitial!: () => void;
  let confirmAnonymous!: () => void;
  auth.refetch
    .mockReturnValueOnce(new Promise<void>((resolve) => (finishInitial = resolve)))
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          confirmAnonymous = () => {
            authState = { data: null, isPending: false, error: null };
            resolve();
          };
        }),
    );
  render(<SupplierPage />);
  expect(screen.getByRole("status", { name: "供应商账号核实" })).toHaveTextContent("正在读取");
  expect(screen.getByRole("button", { name: "重新核实账号" })).toBeDisabled();
  expect(screen.queryByRole("link", { name: "登录 DJL" })).not.toBeInTheDocument();

  await act(async () => finishInitial());
  expect(screen.getByRole("status", { name: "供应商账号核实" })).toHaveTextContent("请求过于频繁");
  const retry = screen.getByRole("button", { name: "重新核实账号" });
  expect(retry).toBeEnabled();
  fireEvent.click(retry);
  expect(auth.refetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "重新核实账号" })).toBeDisabled();
  expect(screen.queryByRole("link", { name: "登录 DJL" })).not.toBeInTheDocument();
  expect(commerce.me).not.toHaveBeenCalled();

  await act(async () => confirmAnonymous());
  await screen.findByRole("link", { name: "登录 DJL" });
  expect(screen.queryByRole("button", { name: "重新核实账号" })).not.toBeInTheDocument();
  expect(commerce.me).not.toHaveBeenCalled();
  expect(auth.signOut).not.toHaveBeenCalled();
});

it("ignores a late old supplier read denial after the same session has recovered through retry", async () => {
  let rejectOld!: (cause: unknown) => void;
  commerce.supplierOrders
    .mockReturnValueOnce(new Promise((_, reject) => (rejectOld = reject)))
    .mockResolvedValue({
      orders: [{ ...item, address: { ...item.address, line1: "Recovered Same Session Address" } }],
    });
  const { rerender } = render(<SupplierPage />);
  await waitFor(() => expect(commerce.supplierOrders).toHaveBeenCalledOnce());
  authState = { ...authState, error: { status: 429 } };
  rerender(<SupplierPage />);
  await screen.findByRole("status", { name: "供应商账号核实" });
  auth.refetch.mockImplementationOnce(async () => {
    authState = { ...authState, error: null };
  });
  fireEvent.click(screen.getByRole("button", { name: "重新核实账号" }));
  await screen.findByText("Recovered Same Session Address", { exact: false });
  await act(async () => rejectOld(new ApiError(401, "unauthorized", "Old read denied", null)));
  expect(screen.getByText("Recovered Same Session Address", { exact: false })).toBeInTheDocument();
  expect(screen.queryByText(/登录状态或供应商授权已失效/)).not.toBeInTheDocument();
  expect(auth.signOut).not.toHaveBeenCalled();
});

it("ignores a late denied supplier mutation after retry recovers the same session without replaying it", async () => {
  let rejectOld!: (cause: unknown) => void;
  commerce.accept.mockReturnValueOnce(new Promise((_, reject) => (rejectOld = reject)));
  const { rerender } = render(<SupplierPage />);
  await screen.findByText("1 Test Road", { exact: false });
  fireEvent.click(screen.getByRole("button", { name: "确认接单" }));
  await waitFor(() => expect(commerce.accept).toHaveBeenCalledOnce());
  authState = { ...authState, error: { status: 429 } };
  rerender(<SupplierPage />);
  await waitFor(() => expect(screen.getByRole("button", { name: "重新核实账号" })).toBeEnabled());
  commerce.supplierOrders.mockResolvedValue({
    orders: [{ ...item, address: { ...item.address, line1: "Verified After Pending Mutation" } }],
  });
  auth.refetch.mockImplementationOnce(async () => {
    authState = { ...authState, error: null };
  });
  fireEvent.click(screen.getByRole("button", { name: "重新核实账号" }));
  await screen.findByText("Verified After Pending Mutation", { exact: false });
  await act(async () => rejectOld(new ApiError(401, "unauthorized", "Old mutation denied", null)));
  expect(screen.getByText("Verified After Pending Mutation", { exact: false })).toBeInTheDocument();
  expect(screen.queryByText(/登录状态或供应商授权已失效/)).not.toBeInTheDocument();
  expect(commerce.accept).toHaveBeenCalledOnce();
  expect(commerce.ship).not.toHaveBeenCalled();
  expect(auth.signOut).not.toHaveBeenCalled();
});

it.each([
  ["pending", "待接单"],
  ["accepted", "已接单，待发货"],
  ["shipped", "已发货"],
  ["delivered", "已签收"],
  ["cancelled", "已取消"],
])(
  "labels supplier fulfillment status %s as %s without changing its business actions",
  async (status, label) => {
    commerce.supplierOrders.mockResolvedValue({ orders: [{ ...item, status }] });
    render(<SupplierPage />);
    await screen.findByText(label, { exact: true });
    expect(screen.queryByText(status, { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认接单" }) !== null).toBe(status === "pending");
    expect(screen.queryByRole("button", { name: "确认发货" }) !== null).toBe(
      ["pending", "accepted"].includes(status),
    );
    expect(commerce.accept).not.toHaveBeenCalled();
    expect(commerce.ship).not.toHaveBeenCalled();
  },
);
