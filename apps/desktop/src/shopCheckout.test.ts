import { describe, expect, it, vi } from "vitest";
import { commerceTestCheckoutUrl } from "@synara/contracts/cloud";
import { openVerifiedShopCheckout, readCheckoutStatus } from "./shopCheckout";

const orderId = "00000000-0000-4000-8000-000000000001";
const attemptId = "00000000-0000-4000-8000-000000000002";
const sessionId = "cs_test_abc123";
const checkoutUrl = `https://checkout.stripe.com/c/pay/${sessionId}#opaque`;
const now = () => Date.parse("2026-10-26T12:00:00Z");
const status = {
  enabled: true,
  mode: "test",
  paymentProvider: "stripe_test",
  provider: "stripe_test",
  orderId,
  attemptId,
  sessionId,
  status: "open",
  expiresAt: "2026-10-26T12:30:00Z",
  checkoutUrl,
};
function fixture(overrides: Record<string, unknown> = {}) {
  return {
    sessionFingerprint: vi.fn(async (_orderId: string) => "shop-session-a"),
    payment: vi.fn(async () => ({ payment: { ...status, ...overrides } })),
    openExternal: vi.fn(async () => {}),
    now,
  };
}

describe("isolated test checkout capability", () => {
  it("limits server JSON without reading an unbounded body", async () => {
    expect(await readCheckoutStatus(Response.json({ payment: status }))).toEqual({
      payment: status,
    });
    await expect(
      readCheckoutStatus(
        new Response("<html>sign in</html>", { headers: { "content-type": "text/html" } }),
      ),
    ).rejects.toThrow();
    await expect(
      readCheckoutStatus(Response.json({ error: "unauthorized" }, { status: 401 })),
    ).rejects.toThrow();
    await expect(
      readCheckoutStatus(
        new Response("x".repeat(256 * 1024 + 1), {
          headers: { "content-type": "application/json" },
        }),
      ),
    ).rejects.toThrow("response limit");
  });
  it("opens only the authenticated current server-bound test session", async () => {
    const deps = fixture();
    expect(await openVerifiedShopCheckout({ orderId, attemptId }, deps)).toBe(true);
    expect(deps.payment).toHaveBeenCalledWith(orderId);
    expect(deps.sessionFingerprint).toHaveBeenCalledTimes(2);
    expect(deps.sessionFingerprint).toHaveBeenNthCalledWith(1, orderId);
    expect(deps.sessionFingerprint).toHaveBeenNthCalledWith(2, orderId);
    expect(deps.openExternal).toHaveBeenCalledExactlyOnceWith(checkoutUrl);
  });
  it("does not accept renderer URLs, invalid IDs, or tokens", async () => {
    const deps = fixture();
    for (const input of [
      null,
      [],
      { orderId: "../auth", attemptId },
      { orderId, attemptId, url: checkoutUrl },
      { orderId, attemptId, token: "secret" },
    ]) {
      expect(await openVerifiedShopCheckout(input, deps)).toBe(false);
    }
    expect(deps.payment).not.toHaveBeenCalled();
    expect(deps.sessionFingerprint).not.toHaveBeenCalled();
    expect(deps.openExternal).not.toHaveBeenCalled();
  });
  it("does not open an old authenticated response after the account changes while proof is pending", async () => {
    const deps = fixture();
    let finish!: (value: Awaited<ReturnType<typeof deps.payment>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof deps.payment>>>((resolve) => {
      finish = resolve;
    });
    deps.payment.mockReturnValueOnce(pending);
    deps.sessionFingerprint
      .mockResolvedValueOnce("shop-session-a")
      .mockResolvedValueOnce("shop-session-b");
    const opening = openVerifiedShopCheckout({ orderId, attemptId }, deps);
    await vi.waitFor(() => expect(deps.payment).toHaveBeenCalledOnce());
    expect(deps.openExternal).not.toHaveBeenCalled();
    finish({ payment: status });
    expect(await opening).toBe(false);
    expect(deps.sessionFingerprint).toHaveBeenCalledTimes(2);
    expect(deps.openExternal).not.toHaveBeenCalled();
  });
  it.each([1, 2])("fails closed when session fingerprint read %i fails", async (read) => {
    const deps = fixture();
    if (read === 2) deps.sessionFingerprint.mockResolvedValueOnce("shop-session-a");
    deps.sessionFingerprint.mockRejectedValueOnce(new Error("Cookie access unavailable"));
    expect(await openVerifiedShopCheckout({ orderId, attemptId }, deps)).toBe(false);
    expect(deps.payment).toHaveBeenCalledTimes(read - 1);
    expect(deps.openExternal).not.toHaveBeenCalled();
  });
  it("rejects a recorded cookie A-to-B-to-A change even when the final fingerprint would match", async () => {
    const deps = fixture();
    let fingerprint = "shop-session-a";
    let invalidated = false;
    // Models the sticky native guard, not a real Electron cookies.changed event.
    deps.sessionFingerprint.mockImplementation(async () => {
      if (invalidated) throw new Error("Shop checkout context changed.");
      return fingerprint;
    });
    deps.payment.mockImplementationOnce(async () => {
      fingerprint = "shop-session-b";
      invalidated = true;
      fingerprint = "shop-session-a";
      return { payment: status };
    });
    expect(await openVerifiedShopCheckout({ orderId, attemptId }, deps)).toBe(false);
    expect(fingerprint).toBe("shop-session-a");
    expect(deps.sessionFingerprint).toHaveBeenCalledTimes(2);
    expect(deps.openExternal).not.toHaveBeenCalled();
  });
  it("refuses an empty fingerprint before retrieving authenticated payment proof", async () => {
    const deps = fixture();
    deps.sessionFingerprint.mockResolvedValueOnce("");
    expect(await openVerifiedShopCheckout({ orderId, attemptId }, deps)).toBe(false);
    expect(deps.payment).not.toHaveBeenCalled();
    expect(deps.openExternal).not.toHaveBeenCalled();
  });
  it("rechecks expiry after the final asynchronous fingerprint read", async () => {
    const deps = fixture();
    let time = now();
    deps.now = () => time;
    deps.sessionFingerprint
      .mockResolvedValueOnce("shop-session-a")
      .mockImplementationOnce(async () => {
        time = Date.parse(status.expiresAt);
        return "shop-session-a";
      });
    expect(await openVerifiedShopCheckout({ orderId, attemptId }, deps)).toBe(false);
    expect(deps.openExternal).not.toHaveBeenCalled();
  });
  it("respects the final native window guard even if the authenticated session is unchanged", async () => {
    const deps = fixture();
    deps.openExternal.mockRejectedValueOnce(new Error("Shop checkout context changed."));
    expect(await openVerifiedShopCheckout({ orderId, attemptId }, deps)).toBe(false);
    expect(deps.sessionFingerprint).toHaveBeenCalledTimes(2);
  });
  it("rejects stale, live, paid, unknown, foreign or mismatched sessions", async () => {
    for (const override of [
      { enabled: false },
      { mode: "live" },
      { status: "paid" },
      { status: "unknown" },
      { status: "creating" },
      { orderId: attemptId },
      { attemptId: orderId },
      { expiresAt: "2026-10-26T11:59:59Z" },
      { expiresAt: "invalid" },
      { sessionId: "cs_live_abc" },
      { checkoutUrl: "https://attacker.test/c/pay/cs_test_abc123" },
    ]) {
      const deps = fixture(override);
      expect(await openVerifiedShopCheckout({ orderId, attemptId }, deps)).toBe(false);
      expect(deps.openExternal).not.toHaveBeenCalled();
    }
  });
  it("fails closed on sign-in errors, malformed responses, or OS browser failure", async () => {
    const deps = fixture();
    deps.payment.mockRejectedValueOnce(new Error("Unauthorized"));
    expect(await openVerifiedShopCheckout({ orderId, attemptId }, deps)).toBe(false);
    deps.openExternal.mockRejectedValueOnce(new Error("blocked"));
    expect(await openVerifiedShopCheckout({ orderId, attemptId }, deps)).toBe(false);
  });
  it("never broadens the URL allowlist to real sessions, redirects or arbitrary hosts", () => {
    expect(commerceTestCheckoutUrl(checkoutUrl, sessionId)).toBe(checkoutUrl);
    for (const url of [
      `http://checkout.stripe.com/c/pay/${sessionId}`,
      `https://checkout.stripe.com.attacker.test/c/pay/${sessionId}`,
      `https://secret@checkout.stripe.com/c/pay/${sessionId}`,
      `https://checkout.stripe.com:444/c/pay/${sessionId}`,
      `https://checkout.stripe.com:443/c/pay/${sessionId}`,
      `https://checkout.stripe.com/x/../c/pay/${sessionId}`,
      `https://checkout.stripe.com/c/pay/${sessionId}?redirect=https://attacker.test`,
      `https://checkout.stripe.com/c/pay/cs_live_real`,
      `https://checkout.stripe.com/c/pay/cs_test_other`,
    ])
      expect(commerceTestCheckoutUrl(url, sessionId)).toBeNull();
  });
});
