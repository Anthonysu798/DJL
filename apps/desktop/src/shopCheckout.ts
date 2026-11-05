import { commerceTestCheckoutUrl } from "@synara/contracts/cloud";

export const SHOP_CHECKOUT_CHANNEL = "desktop:shop-checkout";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export async function readCheckoutStatus(response: Response): Promise<unknown> {
  if (
    response.status !== 200 ||
    !response.headers.get("content-type")?.includes("application/json") ||
    !response.body
  ) {
    throw new Error("Checkout status is unavailable.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 256 * 1024) {
        await reader.cancel();
        throw new Error("Checkout status exceeds the response limit.");
      }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    reader.releaseLock();
  }
}

/** Re-fetch trusted server state using the shop session. No URL, token or AI privilege crosses IPC. */
export async function openVerifiedShopCheckout(
  raw: unknown,
  deps: {
    readonly sessionFingerprint: (orderId: string) => Promise<string>;
    readonly payment: (orderId: string) => Promise<unknown>;
    readonly openExternal: (url: string) => Promise<unknown>;
    readonly now?: () => number;
  },
): Promise<boolean> {
  const input = object(raw);
  if (
    !input ||
    Object.keys(input).some((key) => key !== "orderId" && key !== "attemptId") ||
    typeof input.orderId !== "string" ||
    !uuid.test(input.orderId) ||
    typeof input.attemptId !== "string" ||
    !uuid.test(input.attemptId)
  )
    return false;
  const { orderId, attemptId } = input;
  try {
    const fingerprint = await deps.sessionFingerprint(orderId);
    if (typeof fingerprint !== "string" || !fingerprint) return false;
    const result = object(await deps.payment(orderId));
    const payment = object(result?.payment);
    if (
      !payment ||
      payment.enabled !== true ||
      payment.mode !== "test" ||
      payment.paymentProvider !== "stripe_test" ||
      payment.provider !== "stripe_test" ||
      payment.status !== "open" ||
      payment.orderId !== orderId ||
      payment.attemptId !== attemptId ||
      typeof payment.expiresAt !== "string" ||
      !(Date.parse(payment.expiresAt) > (deps.now?.() ?? Date.now()))
    )
      return false;
    const url = commerceTestCheckoutUrl(payment.checkoutUrl, payment.sessionId);
    if (!url) return false;
    if (
      (await deps.sessionFingerprint(orderId)) !== fingerprint ||
      !(Date.parse(payment.expiresAt) > (deps.now?.() ?? Date.now()))
    )
      return false;
    await deps.openExternal(url);
    return true;
  } catch {
    return false;
  }
}
