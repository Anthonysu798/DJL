import { describe, expect, it } from "vitest";
import { COMMERCE_STRIPE_TEST_WEBHOOK_PATH } from "../commerce/paymentRoutes.ts";
import { csrfRefusal } from "./csrf.ts";

const headers = { cookie: "djl.session_token=session", origin: "https://untrusted.test" };
const trusted = new Set(["https://shop.test"]);

describe("commerce signed callback CSRF boundary", () => {
  it("lets only the exact POST callback reach raw-body signature verification", () => {
    expect(
      csrfRefusal({ method: "POST", path: COMMERCE_STRIPE_TEST_WEBHOOK_PATH, headers }, trusted),
    ).toBeNull();
  });
  it("keeps checkout, refunds, lookalike callbacks and non-POST requests protected", () => {
    for (const path of [
      "/v1/commerce/orders/id/checkout",
      "/v1/commerce/webhooks/stripe-test/",
      "/v1/commerce/webhooks/stripe-test/extra",
      "/v1/commerce/webhooks/stripe-live",
      "/v1/commerce/webhooks/%73tripe-test",
    ])
      expect(csrfRefusal({ method: "POST", path, headers }, trusted)).toBe("csrf_origin");
    expect(
      csrfRefusal({ method: "PUT", path: COMMERCE_STRIPE_TEST_WEBHOOK_PATH, headers }, trusted),
    ).toBe("csrf_origin");
  });
});
