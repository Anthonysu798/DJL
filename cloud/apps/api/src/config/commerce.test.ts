import { describe, expect, it } from "vitest";
import { commerceRuntimeConfig } from "./commerce.ts";

const local = { env: "local", mockExternals: false } as const;
const selected = {
  DJL_COMMERCE_MODE: "test",
  DJL_COMMERCE_PAYMENT_PROVIDER: "stripe_test",
  DJL_COMMERCE_STRIPE_ENABLED: "true",
};

describe("commerce runtime rollout gates", () => {
  it("defaults to disabled simulation and ignores all AI Stripe credentials", () => {
    expect(
      commerceRuntimeConfig(local, {
        STRIPE_SECRET_KEY: "sk_test_ai",
        STRIPE_WEBHOOK_SECRET: "whsec_ai",
      }),
    ).toMatchObject({ mode: "disabled", paymentProvider: "simulation", stripeEnabled: false });
  });
  it("requires explicit local/test gates and keeps the isolated adapter independent of AI mocks", () => {
    expect(commerceRuntimeConfig(local, selected).stripeEnabled).toBe(true);
    expect(commerceRuntimeConfig({ ...local, mockExternals: true }, selected).stripeEnabled).toBe(
      true,
    );
    for (const values of [
      { ...selected, DJL_COMMERCE_MODE: "disabled" },
      { ...selected, DJL_COMMERCE_STRIPE_ENABLED: "false" },
      { ...selected, DJL_COMMERCE_PAYMENT_PROVIDER: "simulation" },
    ])
      expect(commerceRuntimeConfig(local, values).stripeEnabled).toBe(false);
  });
  it("fails closed for misspelled/live selectors and every staging/production setting", () => {
    for (const provider of ["live", "stripe", "stripe-live", "stripe_test_typo"])
      expect(
        commerceRuntimeConfig(local, { ...selected, DJL_COMMERCE_PAYMENT_PROVIDER: provider }),
      ).toMatchObject({ mode: "disabled", stripeEnabled: false });
    for (const env of ["staging", "production"] as const)
      expect(commerceRuntimeConfig({ env, mockExternals: false }, selected)).toMatchObject({
        mode: "disabled",
        stripeEnabled: false,
      });
  });
  it("keeps checkout and withdrawal pause independent of aftersales capability", () => {
    expect(
      commerceRuntimeConfig(local, {
        DJL_COMMERCE_MODE: "test",
        DJL_COMMERCE_CHECKOUT_PAUSED: "1",
      }),
    ).toMatchObject({ mode: "test", checkoutPaused: true, withdrawalsPaused: false });
    expect(
      commerceRuntimeConfig(local, {
        DJL_COMMERCE_MODE: "test",
        DJL_COMMERCE_WITHDRAWALS_PAUSED: "true",
      }),
    ).toMatchObject({ mode: "test", checkoutPaused: false, withdrawalsPaused: true });
  });
});
