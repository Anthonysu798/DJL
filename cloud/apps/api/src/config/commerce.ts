import type { ApiEnv } from "./env.ts";

/** No live selector. Invalid configuration disables commerce, never the existing AI services. */
export function commerceRuntimeConfig(
  api: Pick<ApiEnv, "env" | "mockExternals">,
  values: NodeJS.ProcessEnv,
) {
  const selected = values.DJL_COMMERCE_PAYMENT_PROVIDER?.trim() || "simulation";
  const valid = selected === "simulation" || selected === "stripe_test";
  const local = api.env === "local" || api.env === "test";
  const mode = valid && local && values.DJL_COMMERCE_MODE === "test" ? "test" : "disabled";
  const paymentProvider = selected === "stripe_test" ? "stripe_test" : "simulation";
  const yes = (key: string) => values[key] === "true" || values[key] === "1";
  return {
    mode,
    paymentProvider,
    stripeEnabled:
      mode === "test" && paymentProvider === "stripe_test" && yes("DJL_COMMERCE_STRIPE_ENABLED"),
    checkoutPaused: yes("DJL_COMMERCE_CHECKOUT_PAUSED"),
    withdrawalsPaused: yes("DJL_COMMERCE_WITHDRAWALS_PAUSED"),
  } as const;
}
