import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./api";
import {
  cad,
  centerCropImage,
  commerceErrorMessage,
  imageSource,
  readCart,
  shopSignInPath,
} from "./commerce";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("commerce browser boundaries", () => {
  it("explains actual stock and shared referral rule codes without relying on English text", () => {
    expect(
      commerceErrorMessage(
        new ApiError(409, "out_of_stock", "A selected product is unavailable.", null),
      ),
    ).toContain("库存已变化");
    expect(
      commerceErrorMessage(
        new ApiError(409, "reserved_stock", "Stock cannot be below reservations.", null),
      ),
    ).toContain("订单预占");
    expect(
      commerceErrorMessage(
        new ApiError(404, "referral_not_found", "Recommendation code not found.", null),
      ),
    ).toBe("推荐码不存在，请核对后再试。");
    for (const cause of ["self referral", "mutual referral", "referral cycle", "already bound"])
      expect(commerceErrorMessage(new ApiError(409, "referral_locked", cause, null))).toContain(
        "不能自绑、互绑或形成循环",
      );
  });
  it("explains CAD 20, recovery, active withdrawal and independent pause rules", () => {
    const message = (code: string) =>
      commerceErrorMessage(new ApiError(409, code, "English fixture", null));
    expect(message("withdrawal_unavailable")).toContain("至少 CAD 20");
    expect(message("withdrawal_unavailable")).toContain("没有退款待追回");
    expect(message("withdrawal_pending")).toContain("不要重复申请");
    expect(message("withdrawal_review_required")).toContain("退款或售后需要核实");
    expect(message("commerce_checkout_paused")).toContain("历史订单和售后仍可查看");
    expect(message("commerce_withdrawals_paused")).toContain("已有提现记录仍可查看");
  });
  it("offers text search for real image quota and unavailable codes without asking users to pay", () => {
    for (const code of ["image_search_limit", "image_search_unavailable", "image_search_failed"]) {
      const message = commerceErrorMessage(new ApiError(503, code, "English fixture", null));
      expect(message).toContain("文字搜索");
      expect(message).not.toContain("充值");
    }
  });
  it("preserves unknown money risks and refuses to imply a silent simulated payment fallback", () => {
    const message = (code: string) =>
      commerceErrorMessage(new ApiError(503, code, "English fixture", null));
    expect(message("commerce_stripe_test_disabled")).toContain("不会自动切换成模拟支付");
    for (const code of [
      "commerce_payment_provider_unavailable",
      "commerce_payment_unavailable",
      "commerce_write_failed",
    ])
      expect(message(code)).toContain("不要重复付款、退款或提现");
    expect(message("commerce_payment_unresolved")).toContain("付款结果尚未确认");
    expect(message("commerce_refund_unresolved")).toContain("不要重复退款");
    expect(message("commerce_checkout_in_progress")).toContain("不要新建付款");
    expect(message("commerce_payment_proof_invalid")).toContain("需要平台核实");
    expect(message("idempotency_conflict")).toContain("不要重复提交");
  });
  it("keeps unknown diagnostics as plain normalized text and retains the network fallback", () => {
    expect(
      commerceErrorMessage(new ApiError(400, "future_code", "Unknown\nserver\u0000message", null)),
    ).toBe("Unknown server message");
    expect(commerceErrorMessage(new Error("Existing diagnostic"))).toBe("Existing diagnostic");
    expect(commerceErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "暂时无法连接商城服务，请稍后重试。",
    );
    expect(commerceErrorMessage(null)).toBe("操作失败，请重试。");
  });
  it("formats only safe integer minor units", () => {
    expect(cad(3999)).toBe("CAD 39.99");
    for (const amount of [-1, 1.1, Number.MAX_SAFE_INTEGER + 1])
      expect(() => cad(amount)).toThrow();
  });
  it("restores ids and quantities, never client money, roles or wallet data", () => {
    expect(readCart('{"tote":2,"priceCents":-10,"availableCents":99999999,"bad/id":3}')).toEqual({
      tote: 2,
    });
    expect(readCart('{"tote":1.5}')).toEqual({});
    expect(readCart("broken")).toEqual({});
    expect(readCart("[]")).toEqual({});
  });
  it("refuses script, insecure remote and credential-bearing catalog image urls", () => {
    expect(imageSource("javascript:alert(1)")).toBeUndefined();
    expect(imageSource("http://internal.example/x")).toBeUndefined();
    expect(imageSource("https://user:secret@example.com/x")).toBeUndefined();
    expect(imageSource("https://cdn.example.com/image.png")).toBe(
      "https://cdn.example.com/image.png",
    );
    expect(imageSource("http://127.0.0.1:8787/image.png")).toBeDefined();
  });
  it("allows only storefront-local relative images, never AI paths or URL traversal", () => {
    expect(imageSource("/shop/media/tote.jpg")).toBe("/shop/media/tote.jpg");
    expect(imageSource("/shop/media/tote.jpg?v=2")).toBe("/shop/media/tote.jpg?v=2");
    for (const path of [
      "/api/status",
      "/products/tote.jpg",
      "//127.0.0.1/api",
      "/shop/../api",
      "/shop/%2e%2e/api",
      "/shop/media%2f../api",
      "/shop/media\\..\\api",
      "/shop//media.png",
      "/shop/media/unsafe name.png",
      "/shop/media/unsafe\nname.png",
    ])
      expect(imageSource(path)).toBeUndefined();
  });
  it("really crops the center square and uploads a newly encoded image, not the original", async () => {
    const drawImage = vi.fn();
    const close = vi.fn();
    const bitmap = { width: 2400, height: 1800, close };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
      callback(new Blob(["cropped-png"], { type: "image/png" })),
    );
    const original = new File(["original-image"], "photo.jpg", { type: "image/jpeg" });
    const cropped = await centerCropImage(original);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 300, 0, 1800, 1800, 0, 0, 1536, 1536);
    expect(cropped.name).toBe("commerce-search-crop.png");
    expect(cropped.type).toBe("image/png");
    expect(cropped).not.toBe(original);
    expect(close).toHaveBeenCalledOnce();
  });
  it("closes decoded image resources when cropping fails", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 10, height: 20, close })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(
      centerCropImage(new File(["image"], "photo.png", { type: "image/png" })),
    ).rejects.toThrow("裁剪");
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([
    { width: 2400, height: 1800, focus: { x: 1, y: 0.5 }, x: 600, y: 0 },
    { width: 1200, height: 2000, focus: { x: 0.5, y: 0 }, x: 0, y: 0 },
    { width: 1200, height: 2000, focus: { x: 0.5, y: 1 }, x: 0, y: 800 },
  ])("crops the selected off-center region in a $width by $height image", async (fixture) => {
    const drawImage = vi.fn();
    const bitmap = { width: fixture.width, height: fixture.height, close: vi.fn() };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
      callback(new Blob(["cropped-png"], { type: "image/png" })),
    );
    await centerCropImage(
      new File(["image"], "photo.png", { type: "image/png" }),
      undefined,
      fixture.focus,
    );
    const side = Math.min(fixture.width, fixture.height);
    const output = Math.min(side, 1536);
    expect(drawImage).toHaveBeenCalledWith(
      bitmap,
      fixture.x,
      fixture.y,
      side,
      side,
      0,
      0,
      output,
      output,
    );
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it.each([
    { x: -0.1, y: 0.5 },
    { x: 0.5, y: 1.1 },
    { x: NaN, y: 0.5 },
  ])("rejects an invalid crop focus before decoding pixels", async (focus) => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    await expect(
      centerCropImage(new File(["image"], "photo.png", { type: "image/png" }), undefined, focus),
    ).rejects.toThrow("裁剪位置");
    expect(decode).not.toHaveBeenCalled();
  });
  it.each(["decode", "encode"] as const)(
    "does not return a late %s crop after its scope is aborted",
    async (stage) => {
      const controller = new AbortController();
      const bitmap = { width: 20, height: 10, close: vi.fn() };
      let finish!: () => void;
      const barrier = new Promise<void>((resolve) => {
        finish = resolve;
      });
      vi.stubGlobal(
        "createImageBitmap",
        vi.fn(async () => {
          if (stage === "decode") await barrier;
          return bitmap;
        }),
      );
      const drawImage = vi.fn();
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        drawImage,
      } as unknown as CanvasRenderingContext2D);
      const encode = vi
        .spyOn(HTMLCanvasElement.prototype, "toBlob")
        .mockImplementation((callback) => {
          void barrier.then(() => callback(new Blob(["cropped"], { type: "image/png" })));
        });
      const pending = centerCropImage(
        new File(["A"], "a.png", { type: "image/png" }),
        controller.signal,
      );
      const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
      if (stage === "encode") await vi.waitFor(() => expect(encode).toHaveBeenCalledOnce());
      controller.abort();
      finish();
      await rejected;
      expect(bitmap.close).toHaveBeenCalledOnce();
      if (stage === "decode") expect(drawImage).not.toHaveBeenCalled();
    },
  );
  it("keeps a referral in the existing safe sign-in return route", () => {
    expect(shopSignInPath("FRIEND-1")).toBe("/sign-in?next=%2Fshop%3Fref%3DFRIEND-1");
    expect(shopSignInPath("https://evil.invalid")).not.toContain("next=https");
  });
});
