/** The isolated storefront receives no AI bridge, only this fixed checkout capability. */
export interface CommerceDesktopBridge {
  readonly kind: "desktop";
  readonly openCheckout: (input: {
    readonly orderId: string;
    readonly attemptId: string;
  }) => Promise<boolean>;
}

/** Checkout URLs come from a server-verified test session, never directly from renderer IPC. */
export function commerceTestCheckoutUrl(value: unknown, sessionId: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 8192 ||
    /[\p{Cc}\s]/u.test(value) ||
    typeof sessionId !== "string" ||
    !/^cs_test_[A-Za-z0-9_]+$/.test(sessionId)
  )
    return null;
  const prefix = `https://checkout.stripe.com/c/pay/${sessionId}`;
  if (value !== prefix && !value.startsWith(`${prefix}#`)) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "checkout.stripe.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.pathname !== `/c/pay/${sessionId}`
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
