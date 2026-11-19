import { commerceTestCheckoutUrl, type CommerceDesktopBridge } from "@synara/contracts/cloud";

/** A returned URL is a navigation capability, not evidence of successful payment. */
export function stripeTestCheckoutUrl(raw: string | null, sessionId: string | null): string | null {
  if (
    !raw ||
    raw.trim() !== raw ||
    Array.from(raw).some((character) => character.charCodeAt(0) <= 32)
  )
    return null;
  return commerceTestCheckoutUrl(raw, sessionId);
}

/** Native IPC accepts IDs only; a refusal must never fall back to an unrestricted opener. */
export async function openCommerceCheckout(input: {
  orderId: string;
  attemptId: string | null;
  sessionId: string | null;
  checkoutUrl: string | null;
}): Promise<void> {
  const native = (window as Window & { djlCommerce?: CommerceDesktopBridge }).djlCommerce;
  if (native) {
    if (
      native.kind !== "desktop" ||
      !input.attemptId ||
      !(await native.openCheckout({ orderId: input.orderId, attemptId: input.attemptId }))
    )
      throw new Error("当前商城窗口未能打开测试收银台，请刷新支付状态后重试。");
    return;
  }
  const url = stripeTestCheckoutUrl(input.checkoutUrl, input.sessionId);
  if (!url) throw new Error("测试收银台地址无效，请刷新支付状态后重试。");
  window.open(url, "_blank", "noopener,noreferrer");
}
