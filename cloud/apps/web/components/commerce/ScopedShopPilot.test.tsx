// @vitest-environment-options {"url":"https://127.0.0.1:48981/shop/sign-in?next=%2Fshop%3Fref%3DTEST"}
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { CommerceOrder, CommerceProduct } from "@synara/contracts/cloud";

const { genericUseSession, genericSignOut, replace, push } = vi.hoisted(() => ({
  genericUseSession: vi.fn(),
  genericSignOut: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: genericUseSession, signOut: genericSignOut },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const web = "https://127.0.0.1:48981";
const api = "https://127.0.0.1:48982";
const auth = "/v1/shop/auth";
const shop = "/v1/shop/commerce";
const csrfPath = "/v1/shop/csrf";
const csrfToken = "synthetic-scoped-csrf";
const user = { id: "scoped-buyer", email: "scoped-buyer@test.invalid", emailVerified: true };
const product: CommerceProduct = {
  id: "product-1",
  sku: "PILOT-1",
  name: "测试帆布包",
  description: "测试商品",
  category: "包袋",
  imageUrl: "",
  priceCents: 2499,
  stock: 4,
  commissionBps: 0,
  returnDays: 30,
};
const address = {
  name: "Test Recipient",
  line1: "1 Test Road",
  city: "Toronto",
  province: "ON",
  postalCode: "M5V 2T6",
  country: "CA",
} as const;
const order: CommerceOrder = {
  id: "order-1",
  paymentProvider: "simulation",
  status: "awaiting_payment",
  mode: "test",
  currency: "CAD",
  totalCents: 2499,
  refundedCents: 0,
  createdAt: "2026-11-05T12:00:00Z",
  expiresAt: "2026-11-05T12:30:00Z",
  paidAt: null,
  address,
  items: [],
};
let ShopClient: typeof import("./ShopClient").ShopClient;
let SignInPage: typeof import("@/app/shop/sign-in/page").default;
let SupplierPage: typeof import("@/app/shop/supplier/page").default;
let scope: typeof import("@/lib/scoped-shop");

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_DJL_TEST_SCOPED_SHOP", "true");
  vi.stubEnv("NEXT_PUBLIC_DJL_TEST_SCOPED_SHOP_WEB_URL", web);
  vi.stubEnv("NEXT_PUBLIC_API_URL", api);
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    },
  });
  ({ ShopClient } = await import("./ShopClient"));
  ({ default: SignInPage } = await import("@/app/shop/sign-in/page"));
  ({ default: SupplierPage } = await import("@/app/shop/supplier/page"));
  scope = await import("@/lib/scoped-shop");
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("requires explicit canonical loopback HTTPS origins and only returns to the shop", () => {
  const valid = { enabled: "true", webUrl: web, apiUrl: api };
  expect(scope.resolveScopedShopConfig(valid)).toEqual({
    mode: "test",
    webOrigin: web,
    apiOrigin: api,
  });
  expect(scope.resolveScopedShopConfig({ ...valid, enabled: undefined })).toEqual({ mode: "off" });
  for (const override of [
    { webUrl: web + "/" },
    { webUrl: "http://127.0.0.1:48981" },
    { webUrl: "https://localhost:48981" },
    { webUrl: "https://outside.invalid:48981" },
    { apiUrl: api + "?token=synthetic" },
    { apiUrl: web },
    { apiUrl: "https://[::1]:48982" },
  ])
    expect(scope.resolveScopedShopConfig({ ...valid, ...override })).toEqual({ mode: "invalid" });
  expect(scope.scopedShopReturn("/shop?ref=TEST")).toBe("/shop?ref=TEST");
  for (const input of ["/chat", "/shop/supplier", "//outside.invalid/", "/shop/../chat"])
    expect(scope.scopedShopReturn(input)).toBe("/shop");
});

it("signs in by scoped TOTP and performs simulated checkout, session refresh and sign-out without generic credentials", async () => {
  let active = false;
  let currentOrder: CommerceOrder | null = null;
  const calls: { method: string; path: string; body: unknown; csrf: string | null }[] = [];
  const fetcher = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    expect(url.origin).toBe(api);
    expect(init.credentials).toBe("include");
    expect(init.redirect).toBe("error");
    const headers = new Headers(init.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("x-org-id")).toBe(false);
    const method = init.method ?? "GET";
    const path = url.pathname;
    const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method, path, body, csrf: headers.get("x-csrf-token") });
    if (path === auth + "/sign-in/email")
      return Response.json({ twoFactorRedirect: true, twoFactorMethods: ["totp", "otp"] });
    if (path === auth + "/two-factor/verify-totp") {
      if ((body as { code?: unknown })?.code !== "123456")
        return Response.json({ error: { code: "INVALID_CODE" } }, { status: 401 });
      active = true;
      return Response.json({ user });
    }
    if (path === auth + "/get-session")
      return Response.json(active ? { user, session: { id: "scoped-session" } } : null);
    if (path === auth + "/sign-out") {
      active = false;
      return Response.json({ success: true });
    }
    if (path === shop + "/catalog")
      return Response.json({
        products: [product],
        currency: "CAD",
        mode: "test",
        paymentProvider: "simulation",
      });
    expect(active).toBe(true);
    if (path === csrfPath) return Response.json({ token: csrfToken });
    if (path === shop + "/orders" && method === "POST") {
      currentOrder = order;
      return Response.json({ order });
    }
    if (path === shop + "/orders/order-1/test-pay") {
      currentOrder = { ...order, status: "paid", paidAt: "2026-11-05T12:05:00Z" };
      return Response.json({ order: currentOrder });
    }
    if (path === shop + "/orders")
      return Response.json({ orders: currentOrder ? [currentOrder] : [], hasMore: false });
    if (path === shop + "/favorites") return Response.json({ userId: user.id, productIds: [] });
    if (path === shop + "/wallet/entries") return Response.json({ entries: [], hasMore: false });
    if (path === shop + "/withdrawals") return Response.json({ withdrawals: [], hasMore: false });
    if (path === shop + "/me")
      return Response.json({
        referralCode: "TEST",
        firstPaidAt: null,
        referrerId: null,
        wallet: {
          pendingCents: 0,
          availableCents: 0,
          frozenCents: 0,
          paidCents: 0,
          recoveryCents: 0,
        },
        suppliers: [{ id: "should-not-link", name: "Synthetic Supplier" }],
      });
    throw new Error("Unexpected non-pilot API route");
  });
  vi.stubGlobal("fetch", fetcher);

  const signIn = render(<SignInPage />);
  await screen.findByRole("heading", { name: "登录测试商城" });
  fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "synthetic-password" } });
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
  await screen.findByRole("heading", { name: "验证器确认" });
  expect(replace).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "000000" } });
  fireEvent.click(screen.getByRole("button", { name: "验证并登录" }));
  await screen.findByRole("alert");
  expect(replace).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("验证码"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "验证并登录" }));
  await waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith("/shop?ref=TEST"));
  signIn.unmount();

  sessionStorage.setItem("djl-commerce-cart-v1", JSON.stringify({ [product.id]: 99 }));
  const shopScreen = render(<ShopClient />);
  await screen.findByRole("heading", { name: product.name });
  await waitFor(() => expect(calls.some((call) => call.path === shop + "/withdrawals")).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: `将${product.name}加入购物车` }));
  fireEvent.click(screen.getByRole("button", { name: "购物车，1件商品" }));
  const dialog = screen.getByRole("dialog", { name: "购物车与测试结账" });
  for (const [label, value] of [
    ["收件人", address.name],
    ["地址", address.line1],
    ["城市", address.city],
    ["省／地区", address.province],
    ["邮编", address.postalCode],
  ])
    fireEvent.change(within(dialog).getByLabelText(label!), { target: { value } });
  fireEvent.submit(within(dialog).getByRole("button", { name: "创建测试订单" }).closest("form")!);
  fireEvent.click(await screen.findByRole("button", { name: "确认测试付款" }));
  await screen.findByText(/测试付款已确认/);

  const writes = calls.filter((call) => call.method === "POST" && call.path.startsWith(shop));
  expect(writes.map((call) => [call.path, call.csrf])).toEqual([
    [shop + "/orders", csrfToken],
    [shop + "/orders/order-1/test-pay", csrfToken],
  ]);
  expect(writes[0]?.body).toMatchObject({
    expectedUserId: user.id,
    items: [{ productId: product.id, quantity: 1 }],
    address,
  });
  expect(calls.filter((call) => call.path === csrfPath)).toHaveLength(2);
  const checks = calls.filter((call) => call.path === auth + "/get-session").length;
  fireEvent(window, new Event("focus"));
  await waitFor(() =>
    expect(calls.filter((call) => call.path === auth + "/get-session").length).toBeGreaterThan(
      checks,
    ),
  );

  fireEvent.click(screen.getAllByRole("button", { name: "我的" })[0]!);
  expect(screen.queryByRole("link", { name: /供应商履约后台/ })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "退出商城账号" }));
  await screen.findByText(/商城账号已退出/);
  expect(sessionStorage.getItem("djl-commerce-cart-v1")).toBe(JSON.stringify({ [product.id]: 99 }));
  shopScreen.unmount();
  render(<SupplierPage />);
  expect(screen.getByText(/不开放供应商后台/)).toBeInTheDocument();

  const before = calls.length;
  await expect(scope.scopedShopCommerce.checkout(order.id, "test")).rejects.toMatchObject({
    code: "scoped_shop_operation_unavailable",
  });
  await expect(scope.scopedShopCommerce.supplierOrders()).rejects.toMatchObject({
    code: "scoped_shop_operation_unavailable",
  });
  expect(calls).toHaveLength(before);
  expect(calls.every((call) => call.path.startsWith("/v1/shop/"))).toBe(true);
  expect(genericUseSession).not.toHaveBeenCalled();
  expect(genericSignOut).not.toHaveBeenCalled();
});
