import { beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api,
}));
import { commerce, uploadCommerceImage } from "./commerce";

beforeEach(() => {
  api.mockReset();
  vi.unstubAllGlobals();
});

describe("commerce authenticated API adapter", () => {
  it("binds new checkout and recovery to the expected buyer without sending an address on recovery", async () => {
    const idempotencyKey = "31324da7-2658-4162-83d4-a2c46a5dbb58";
    const items = [{ productId: "fixture-product", quantity: 1 }];
    const address = {
      name: "Synthetic",
      line1: "100 Fixture Street",
      city: "Vancouver",
      province: "BC",
      postalCode: "V6B 1A1",
      country: "CA" as const,
    };
    api.mockResolvedValueOnce({ order: {} }).mockResolvedValueOnce({ status: "closed" });
    await commerce.createOrder(items, address, idempotencyKey, "buyer-A");
    await expect(commerce.recoverOrder("buyer-A", idempotencyKey)).resolves.toEqual({
      status: "closed",
    });
    expect(api.mock.calls).toEqual([
      [
        "/v1/commerce/orders",
        { method: "POST", json: { items, address, idempotencyKey, expectedUserId: "buyer-A" } },
      ],
      [
        "/v1/commerce/orders/recover",
        { method: "POST", json: { expectedUserId: "buyer-A", idempotencyKey } },
      ],
    ]);
  });

  it.each([null, {}, { status: "found" }, { status: "closed", order: {} }, { status: "pending" }])(
    "does not treat an unconfirmed recovery reply as a closed attempt: %o",
    async (reply) => {
      api.mockResolvedValue(reply);
      await expect(
        commerce.recoverOrder("buyer-A", "31324da7-2658-4162-83d4-a2c46a5dbb58"),
      ).rejects.toMatchObject({ code: "checkout_recovery_unconfirmed" });
    },
  );

  it("uses a fresh scoped CSRF token for recovery and never falls back to order creation", async () => {
    const webOrigin = "https://127.0.0.1:48981";
    const apiOrigin = "https://127.0.0.1:48982";
    const idempotencyKey = "31324da7-2658-4162-83d4-a2c46a5dbb58";
    vi.stubEnv("NEXT_PUBLIC_DJL_TEST_SCOPED_SHOP", "true");
    vi.stubEnv("NEXT_PUBLIC_DJL_TEST_SCOPED_SHOP_WEB_URL", webOrigin);
    vi.stubEnv("NEXT_PUBLIC_API_URL", apiOrigin);
    vi.stubGlobal("window", { location: { origin: webOrigin } });
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ token: "fresh-scoped-fixture" }))
      .mockResolvedValueOnce(Response.json({ error: { code: "not_found" } }, { status: 404 }));
    vi.stubGlobal("fetch", transport);
    try {
      const { scopedShopCommerce } = await import("./scoped-shop");
      await expect(
        scopedShopCommerce.recoverOrder("buyer-A", idempotencyKey),
      ).rejects.toMatchObject({ status: 404 });
      expect(transport.mock.calls.map(([input]) => input)).toEqual([
        apiOrigin + "/v1/shop/csrf",
        apiOrigin + "/v1/shop/commerce/orders/recover",
      ]);
      const [, post] = transport.mock.calls[1]!;
      expect(post).toMatchObject({
        method: "POST",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
      });
      expect(new Headers(post?.headers).get("x-csrf-token")).toBe("fresh-scoped-fixture");
      expect(JSON.parse(String(post?.body))).toEqual({ expectedUserId: "buyer-A", idempotencyKey });
      expect(api).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it.each([400, 404])(
    "sends only the keyed scoped return envelope after a %s response",
    async (status) => {
      const webOrigin = "https://127.0.0.1:48981";
      const apiOrigin = "https://127.0.0.1:48982";
      vi.stubEnv("NEXT_PUBLIC_DJL_TEST_SCOPED_SHOP", "true");
      vi.stubEnv("NEXT_PUBLIC_DJL_TEST_SCOPED_SHOP_WEB_URL", webOrigin);
      vi.stubEnv("NEXT_PUBLIC_API_URL", apiOrigin);
      vi.stubGlobal("window", { location: { origin: webOrigin } });
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json({ token: "fresh-scoped-return-fixture" }))
        .mockResolvedValueOnce(Response.json({ error: { code: "bad_request" } }, { status }));
      vi.stubGlobal("fetch", transport);
      try {
        const input = {
          request: { itemId: "item-1", reason: "Wrong item" },
          expectedUserId: "buyer-A",
          idempotencyKey: "31324da7-2658-4162-83d4-a2c46a5dbb58",
        };
        const { scopedShopCommerce } = await import("./scoped-shop");
        await expect(scopedShopCommerce.requestReturn("order-1", input)).rejects.toMatchObject({
          status,
        });
        expect(transport.mock.calls.map(([url]) => url)).toEqual([
          apiOrigin + "/v1/shop/csrf",
          apiOrigin + "/v1/shop/commerce/orders/order-1/returns",
        ]);
        const [, post] = transport.mock.calls[1]!;
        expect(post).toMatchObject({ method: "POST", credentials: "include", redirect: "error" });
        expect(new Headers(post?.headers).get("x-csrf-token")).toBe("fresh-scoped-return-fixture");
        expect(JSON.parse(String(post?.body))).toEqual(input);
        expect(api).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
      }
    },
  );

  const summary = {
    mode: "test",
    currency: "CAD",
    directBuyers: 3,
    ordersWithCommission: 2,
    netCommissionCents: 1599,
  } as const;
  it("reads the direct referral summary only through the explicit no-cache buyer GET", async () => {
    const signal = new AbortController().signal;
    api.mockResolvedValue({
      userId: "buyer-A",
      referralSummary: { ...summary, referredBuyers: ["must-not-escape"] },
    });
    await expect(commerce.referralSummary("buyer-A", signal)).resolves.toEqual(summary);
    expect(api).toHaveBeenCalledExactlyOnceWith("/v1/commerce/me?referralSummary=1", {
      method: "GET",
      cache: "no-store",
      signal,
    });
  });

  it.each([
    { referralCode: "OLD-PROFILE", wallet: { availableCents: 999 } },
    { userId: "buyer-A", referralSummary: { ...summary, currency: "USD" } },
    { userId: "buyer-A", referralSummary: { ...summary, mode: "live" } },
    { userId: "buyer-A", referralSummary: { ...summary, directBuyers: -1 } },
    { userId: "buyer-A", referralSummary: { ...summary, ordersWithCommission: 0.5 } },
    {
      userId: "buyer-A",
      referralSummary: { ...summary, netCommissionCents: Number.MAX_SAFE_INTEGER + 1 },
    },
  ])("rejects unavailable referral summary DTOs rather than inventing zero: %o", async (reply) => {
    api.mockResolvedValue(reply);
    await expect(
      commerce.referralSummary("buyer-A", new AbortController().signal),
    ).rejects.toMatchObject({
      code: "commerce_referral_summary_unavailable",
    });
  });

  it("does not accept a direct referral summary for a different current account", async () => {
    api.mockResolvedValue({ userId: "buyer-B", referralSummary: summary });
    await expect(
      commerce.referralSummary("buyer-A", new AbortController().signal),
    ).rejects.toMatchObject({
      status: 401,
      code: "commerce_account_changed",
    });
  });

  it("uses the same scoped referral summary buyer GET with no write or CSRF request", async () => {
    const webOrigin = "https://127.0.0.1:48981";
    const apiOrigin = "https://127.0.0.1:48982";
    const signal = new AbortController().signal;
    vi.stubEnv("NEXT_PUBLIC_DJL_TEST_SCOPED_SHOP", "true");
    vi.stubEnv("NEXT_PUBLIC_DJL_TEST_SCOPED_SHOP_WEB_URL", webOrigin);
    vi.stubEnv("NEXT_PUBLIC_API_URL", apiOrigin);
    vi.stubGlobal("window", { location: { origin: webOrigin } });
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ userId: "buyer-A", referralSummary: summary }));
    vi.stubGlobal("fetch", transport);
    try {
      const { scopedShopCommerce } = await import("./scoped-shop");
      await expect(scopedShopCommerce.referralSummary("buyer-A", signal)).resolves.toEqual(summary);
      expect(transport).toHaveBeenCalledExactlyOnceWith(
        apiOrigin + "/v1/shop/commerce/me?referralSummary=1",
        expect.objectContaining({
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal,
        }),
      );
      expect(new Headers(transport.mock.calls[0]?.[1]?.headers).has("x-csrf-token")).toBe(false);
      expect(api).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it("binds favorites to the confirmed account and sends the desired state, not a toggle", async () => {
    api.mockResolvedValueOnce({ userId: "buyer-A", productIds: ["product-1"] });
    await expect(commerce.favorites("buyer-A")).resolves.toEqual({
      userId: "buyer-A",
      productIds: ["product-1"],
    });
    api.mockResolvedValueOnce({ userId: "buyer-A", productId: "product/1", saved: true });
    await commerce.setFavorite("buyer-A", "product/1", true);
    expect(api).toHaveBeenLastCalledWith("/v1/commerce/favorites/product%2F1", {
      method: "POST",
      json: { expectedUserId: "buyer-A", saved: true },
    });
  });
  it("rejects favorites returned for a different account without exposing them to the client", async () => {
    api.mockResolvedValue({ userId: "buyer-B", productIds: ["private-B"] });
    await expect(commerce.favorites("buyer-A")).rejects.toMatchObject({
      status: 401,
      code: "commerce_account_changed",
    });
  });
  it("rejects a mismatched save receipt instead of claiming a different product was saved", async () => {
    api.mockResolvedValue({ userId: "buyer-A", productId: "different", saved: true });
    await expect(commerce.setFavorite("buyer-A", "intended", true)).rejects.toThrow("尚未确认");
  });
  it("keeps an aborted signal on the persistent POST even when the real API adapter was waiting for CSRF", async () => {
    const actual = await vi.importActual<typeof import("./api")>("./api");
    api.mockImplementation(actual.api);
    let finishCsrf!: (response: Response) => void;
    const csrf = new Promise<Response>((resolve) => {
      finishCsrf = resolve;
    });
    const controller = new AbortController();
    let csrfRequested = false,
      acceptedPosts = 0,
      abortedPostObserved = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (url.endsWith("/v1/csrf")) {
          csrfRequested = true;
          return csrf;
        }
        expect(url.endsWith("/v1/commerce/image-uploads")).toBe(true);
        expect(init.signal).toBe(controller.signal);
        abortedPostObserved = Boolean(init.signal?.aborted);
        init.signal?.throwIfAborted(); // An already-aborted native fetch cannot dispatch this POST.
        acceptedPosts++;
        throw new Error("A persistent upload request escaped cancellation");
      }),
    );
    const file = new File(["A"], "a.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1]).buffer });
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    const pending = uploadCommerceImage(file, {
      expectedUserId: "buyer-A",
      signal: controller.signal,
    });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(csrfRequested).toBe(true));
    controller.abort();
    finishCsrf(Response.json({ token: "synthetic-csrf" }));
    await rejected;
    expect(abortedPostObserved).toBe(true);
    expect(acceptedPosts).toBe(0);
  });
  it("requires an explicit starting identity and propagates image-search cancellation", async () => {
    const controller = new AbortController();
    const file = new File(["A"], "a.png", { type: "image/png" });
    await expect(
      uploadCommerceImage(file, { expectedUserId: "", signal: controller.signal }),
    ).rejects.toThrow("账号");
    expect(api).not.toHaveBeenCalled();
    api.mockResolvedValue({ products: [] });
    await commerce.searchImage("image-A", "  tote  ", controller.signal);
    expect(api).toHaveBeenCalledExactlyOnceWith("/v1/commerce/image-search", {
      method: "POST",
      json: { fileId: "image-A", query: "tote" },
      signal: controller.signal,
    });
  });
  it("never adopts a later account after an image's delayed hash", async () => {
    let finish!: (bytes: ArrayBuffer) => void;
    const file = new File(["private image A"], "a.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve;
        }),
    });
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    const put = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", put);
    api.mockResolvedValue({
      userId: "buyer-B",
      upload: { url: "https://storage.test/B", method: "PUT", headers: {} },
      id: "B-file",
    });
    const pending = uploadCommerceImage(file, {
      expectedUserId: "buyer-A",
      signal: new AbortController().signal,
    });
    const rejected = expect(pending).rejects.toThrow("账号");
    finish(new Uint8Array([1]).buffer);
    await rejected;
    expect(api).toHaveBeenCalledExactlyOnceWith("/v1/commerce/image-uploads", {
      method: "POST",
      signal: expect.any(AbortSignal),
      json: {
        expectedUserId: "buyer-A",
        mimeType: "image/png",
        size: file.size,
        sha256: "0".repeat(64),
      },
    });
    expect(put).not.toHaveBeenCalled();
  });
  it("rejects a late upload receipt from a different user before sending image bytes", async () => {
    let finish!: (value: unknown) => void;
    const file = new File(["A"], "a.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1]).buffer });
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    api.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = uploadCommerceImage(file, {
      expectedUserId: "buyer-A",
      signal: new AbortController().signal,
    });
    const rejected = expect(pending).rejects.toThrow("账号");
    await vi.waitFor(() => expect(api).toHaveBeenCalledOnce());
    finish({
      userId: "buyer-B",
      id: "B-file",
      upload: { url: "https://storage.test/B", method: "PUT", headers: {} },
    });
    await rejected;
    expect(api).toHaveBeenCalledOnce();
  });
  it.each(["bytes", "hash", "presign", "put", "complete"] as const)(
    "stops after a late %s stage is aborted and forwards its signal",
    async (stage) => {
      let finish!: () => void,
        reached = false;
      const barrier = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const pause = async <T>(name: string, value: T) => {
        if (stage === name) {
          reached = true;
          await barrier;
        }
        return value;
      };
      const controller = new AbortController();
      const file = new File(["A"], "a.png", { type: "image/png" });
      const bytes = vi.fn(() => pause("bytes", new Uint8Array([1]).buffer));
      Object.defineProperty(file, "arrayBuffer", { value: bytes });
      const digest = vi.fn(() => pause("hash", new Uint8Array(32).buffer));
      vi.stubGlobal("crypto", { subtle: { digest } });
      const put = vi.fn(() => pause("put", Response.json({})));
      vi.stubGlobal("fetch", put);
      api.mockImplementation((path: string) => {
        if (path === "/v1/commerce/image-uploads")
          return pause("presign", {
            userId: "buyer-A",
            id: "A-file",
            upload: {
              url: "https://storage.test/A",
              method: "PUT",
              headers: { "content-type": "image/png" },
            },
          });
        return pause("complete", { userId: "buyer-A", id: "A-file" });
      });
      const pending = uploadCommerceImage(file, {
        expectedUserId: "buyer-A",
        signal: controller.signal,
      });
      const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      await vi.waitFor(() => expect(reached).toBe(true));
      controller.abort();
      finish();
      await rejected;
      expect(api).toHaveBeenCalledTimes(
        { bytes: 0, hash: 0, presign: 1, put: 1, complete: 2 }[stage],
      );
      expect(put).toHaveBeenCalledTimes(stage === "put" || stage === "complete" ? 1 : 0);
      if (stage === "bytes") expect(digest).not.toHaveBeenCalled();
      for (const [, options] of api.mock.calls) expect(options.signal).toBe(controller.signal);
      if (put.mock.calls.length)
        expect((put.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(
          controller.signal,
        );
    },
  );
  it("reports supplier issues using the item scope and stable caller key, never client financial instructions", async () => {
    api.mockResolvedValue({ ok: true });
    await commerce.reportSupplierIssue("item/id", "out_of_stock", "No stock", "same-issue-key");
    expect(api).toHaveBeenCalledExactlyOnceWith("/v1/commerce/supplier/items/item%2Fid/issues", {
      method: "POST",
      json: { kind: "out_of_stock", reason: "No stock", idempotencyKey: "same-issue-key" },
    });
  });
  it("queries a supplier-authorized read-only statement and preserves exact server time boundaries", async () => {
    api.mockResolvedValue({});
    await commerce.supplierStatement("supplier/id", {
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-26T12:00:00.123456Z",
      page: 2,
    });
    const [path] = api.mock.calls[0]!;
    const url = new URL(path, "http://test");
    expect(url.pathname).toBe("/v1/commerce/supplier/supplier%2Fid/statement");
    expect(url.searchParams.get("to")).toBe("2026-10-26T12:00:00.123456Z");
    expect(url.searchParams.get("from")).toBe("2026-10-01T00:00:00Z");
    expect(url.searchParams.get("page")).toBe("2");
    expect(api.mock.calls[0]).toHaveLength(1);
  });
  it("keeps hosted test checkout and status/cancellation separate from simulated payment", async () => {
    api.mockResolvedValue({});
    await commerce.checkout("order/id", "checkout-key");
    await commerce.payment("order/id");
    await commerce.cancelCheckout("order/id", "cancel-key");
    expect(api).toHaveBeenNthCalledWith(1, "/v1/commerce/orders/order%2Fid/checkout", {
      method: "POST",
      json: { idempotencyKey: "checkout-key" },
    });
    expect(api).toHaveBeenNthCalledWith(2, "/v1/commerce/orders/order%2Fid/payment");
    expect(api).toHaveBeenNthCalledWith(3, "/v1/commerce/orders/order%2Fid/checkout/cancel", {
      method: "POST",
      json: { idempotencyKey: "cancel-key" },
    });
  });
  it("queries explicit pages for historical and supplier data without changing the account scope", async () => {
    api.mockResolvedValue({});
    await commerce.orders(2);
    await commerce.withdrawals(3);
    await commerce.ledger(4);
    await commerce.supplierProducts(5);
    await commerce.supplierOrders(6);
    expect(api.mock.calls.map(([path]) => path)).toEqual([
      "/v1/commerce/orders?page=2",
      "/v1/commerce/withdrawals?page=3",
      "/v1/commerce/wallet/entries?page=4",
      "/v1/commerce/supplier/products?page=5",
      "/v1/commerce/supplier/orders?page=6",
    ]);
  });
  it("sends product ids and quantities, never client prices or wallet balances", async () => {
    api.mockResolvedValue({ order: { id: "order-1" } });
    const address = {
      name: "Test",
      line1: "1 Test Road",
      city: "Toronto",
      province: "ON",
      postalCode: "M5V 2T6",
      country: "CA" as const,
    };
    await commerce.createOrder([{ productId: "sku-1", quantity: 2 }], address, "retry-key");
    expect(api).toHaveBeenCalledWith("/v1/commerce/orders", {
      method: "POST",
      json: { items: [{ productId: "sku-1", quantity: 2 }], address, idempotencyKey: "retry-key" },
    });
  });
  it("uses explicit test payment and withdrawal operations with stable caller keys", async () => {
    api.mockResolvedValue({});
    await commerce.testPay("order/id", "payment-key");
    await commerce.withdraw("withdraw-key");
    expect(api).toHaveBeenNthCalledWith(1, "/v1/commerce/orders/order%2Fid/test-pay", {
      method: "POST",
      json: { idempotencyKey: "payment-key" },
    });
    expect(api).toHaveBeenNthCalledWith(2, "/v1/commerce/withdrawals", {
      method: "POST",
      json: { idempotencyKey: "withdraw-key" },
    });
  });
  it("supports private aftersales, withdrawal records and supplier acceptance without role input", async () => {
    api.mockResolvedValue({});
    const input = {
      request: { itemId: "item-1", reason: "Wrong item" },
      idempotencyKey: "31324da7-2658-4162-83d4-a2c46a5dbb58",
      expectedUserId: "buyer-1",
    };
    await commerce.requestReturn("order-1", input);
    await commerce.withdrawals();
    await commerce.accept("item-1");
    expect(api).toHaveBeenNthCalledWith(1, "/v1/commerce/orders/order-1/returns", {
      method: "POST",
      json: input,
    });
    expect(api).toHaveBeenNthCalledWith(2, "/v1/commerce/withdrawals");
    expect(api).toHaveBeenNthCalledWith(3, "/v1/commerce/supplier/items/item-1/accept", {
      method: "POST",
      json: {},
    });
  });
  it("uses dedicated uploads and never forwards identity, credentials, or the original file name", async () => {
    const signal = new AbortController().signal;
    const file = new File([new Uint8Array([1, 2, 3])], "test.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    const upload = vi.fn(async () => Response.json({}));
    vi.stubGlobal("fetch", upload);
    api
      .mockResolvedValueOnce({
        userId: "buyer-1",
        id: "file-1",
        upload: {
          url: "http://127.0.0.1:9000/signed-test",
          method: "PUT",
          headers: {
            "content-type": "image/png",
            "content-length": "3",
            authorization: "ignore-unexpected-header",
            "x-org-id": "ignore-team",
            cookie: "ignore-cookie",
            "x-csrf-token": "ignore-csrf",
          },
        },
      })
      .mockResolvedValueOnce({ userId: "buyer-1", id: "file-1" });
    await expect(uploadCommerceImage(file, { expectedUserId: "buyer-1", signal })).resolves.toBe(
      "file-1",
    );
    expect(api.mock.calls).toEqual([
      [
        "/v1/commerce/image-uploads",
        {
          method: "POST",
          signal,
          json: {
            expectedUserId: "buyer-1",
            mimeType: "image/png",
            size: 3,
            sha256: "0".repeat(64),
          },
        },
      ],
      [
        "/v1/commerce/image-uploads/file-1/complete",
        { method: "POST", signal, json: { expectedUserId: "buyer-1" } },
      ],
    ]);
    expect(upload).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:9000/signed-test", {
      method: "PUT",
      headers: expect.any(Headers),
      body: file,
      signal,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    const [, uploadOptions] = upload.mock.calls[0] as unknown as [string, RequestInit];
    expect([...new Headers(uploadOptions.headers)]).toEqual([["content-type", "image/png"]]);
  });
  it("does not upload invalid images or fall back when the dedicated endpoint is unavailable", async () => {
    const context = { expectedUserId: "buyer-1", signal: new AbortController().signal };
    const file = new File(["not-image"], "file.txt", { type: "text/plain" });
    await expect(uploadCommerceImage(file, context)).rejects.toThrow("JPEG");
    expect(api).not.toHaveBeenCalled();
    const image = new File(["x"], "file.png", { type: "image/png" });
    Object.defineProperty(image, "arrayBuffer", { value: async () => new Uint8Array([1]).buffer });
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    const storage = vi.fn();
    vi.stubGlobal("fetch", storage);
    api.mockRejectedValueOnce(new Error("image uploads are unavailable"));
    await expect(uploadCommerceImage(image, context)).rejects.toThrow(
      "image uploads are unavailable",
    );
    expect(api.mock.calls.map(([path]) => path)).toEqual(["/v1/commerce/image-uploads"]);
    expect(storage).not.toHaveBeenCalled();
  });

  it.each([
    { method: "POST" },
    { url: "http://non-loopback.invalid/object" },
    { url: "https://user:password@storage.test/object" },
    { headers: { "content-type": "image/jpeg" } },
  ])("refuses malformed storage instructions without sending image bytes", async (override) => {
    const file = new File(["x"], "test.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1]).buffer });
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
    const storage = vi.fn();
    vi.stubGlobal("fetch", storage);
    api.mockResolvedValueOnce({
      userId: "buyer-1",
      id: "file-1",
      upload: {
        url: "https://storage.test/object",
        method: "PUT",
        headers: { "content-type": "image/png" },
        ...override,
      },
    });
    await expect(
      uploadCommerceImage(file, {
        expectedUserId: "buyer-1",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("图片上传");
    expect(storage).not.toHaveBeenCalled();
    expect(api.mock.calls.map(([path]) => path)).toEqual(["/v1/commerce/image-uploads"]);
  });

  it.each([
    { userId: "buyer-2", id: "file-1", error: "账号" },
    { userId: "buyer-1", id: "another-id", error: "尚未确认" },
  ])(
    "refuses a completed receipt for a different buyer or upload handle",
    async ({ userId, id, error }) => {
      const file = new File(["x"], "secret-name.png", { type: "image/png" });
      Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([1]).buffer });
      vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) } });
      const storage = vi.fn(async () => new Response(null, { status: 200 }));
      vi.stubGlobal("fetch", storage);
      api
        .mockResolvedValueOnce({
          userId: "buyer-1",
          id: "file-1",
          upload: {
            url: "https://storage.test/fixture",
            method: "PUT",
            headers: { "content-type": "image/png" },
          },
        })
        .mockResolvedValueOnce({ userId, id });
      await expect(
        uploadCommerceImage(file, {
          expectedUserId: "buyer-1",
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow(error);
      expect(storage).toHaveBeenCalledOnce();
      expect(api.mock.calls.map(([path]) => path)).toEqual([
        "/v1/commerce/image-uploads",
        "/v1/commerce/image-uploads/file-1/complete",
      ]);
    },
  );
});
