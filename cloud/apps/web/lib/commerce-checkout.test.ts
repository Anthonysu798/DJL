import { afterEach, describe, expect, it, vi } from "vitest";

import { openCommerceCheckout, stripeTestCheckoutUrl } from "./commerce-checkout";

afterEach(() => vi.unstubAllGlobals());
const url = "https://checkout.stripe.com/c/pay/cs_test_UNIT123#test-fragment";

describe("Stripe TEST checkout navigation capability", () => {
  it("allows only the exact HTTPS test-session checkout host and path", () => {
    expect(stripeTestCheckoutUrl(url, "cs_test_UNIT123")).toBe(url);
    for (const raw of [
      null,
      "javascript:alert(1)",
      "http://checkout.stripe.com/c/pay/cs_test_x",
      "https://checkout.stripe.com.evil.invalid/c/pay/cs_test_x",
      "https://user:secret@checkout.stripe.com/c/pay/cs_test_x",
      "https://checkout.stripe.com:444/c/pay/cs_test_x",
      "https://checkout.stripe.com/c/pay/cs_live_x",
      "https://checkout.stripe.com/c/pay/cs_test_x/evil",
      "https://checkout.stripe.com/c/pay/cs_test_%2fx",
      " https://checkout.stripe.com/c/pay/cs_test_x",
    ])
      expect(stripeTestCheckoutUrl(raw, "cs_test_UNIT123")).toBeNull();
  });
  it("opens the validated web checkout separately without opener access", async () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    await openCommerceCheckout({
      orderId: "order-1",
      attemptId: "attempt-1",
      sessionId: "cs_test_UNIT123",
      checkoutUrl: url,
    });
    expect(open).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
  });
  it("sends only order and attempt IDs to the dedicated native bridge", async () => {
    const openCheckout = vi.fn(async () => true);
    const open = vi.fn();
    vi.stubGlobal("window", { open, djlCommerce: { kind: "desktop", openCheckout } });
    await openCommerceCheckout({
      orderId: "order-1",
      attemptId: "attempt-1",
      sessionId: "cs_test_UNIT123",
      checkoutUrl: url,
    });
    expect(openCheckout).toHaveBeenCalledWith({ orderId: "order-1", attemptId: "attempt-1" });
    expect(open).not.toHaveBeenCalled();
  });
  it("never falls back to web opening after a native refusal or malformed URL", async () => {
    const open = vi.fn();
    vi.stubGlobal("window", {
      open,
      djlCommerce: { kind: "desktop", openCheckout: vi.fn(async () => false) },
    });
    await expect(
      openCommerceCheckout({
        orderId: "order-1",
        attemptId: "attempt-1",
        sessionId: "cs_test_UNIT123",
        checkoutUrl: url,
      }),
    ).rejects.toThrow("未能打开");
    expect(open).not.toHaveBeenCalled();
    vi.stubGlobal("window", { open });
    await expect(
      openCommerceCheckout({
        orderId: "order-1",
        attemptId: null,
        sessionId: null,
        checkoutUrl: "https://evil.invalid",
      }),
    ).rejects.toThrow("地址无效");
    expect(open).not.toHaveBeenCalled();
  });
});
