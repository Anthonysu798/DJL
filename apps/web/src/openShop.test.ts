import { describe, expect, it, vi } from "vitest";

import { openShop } from "./openShop";

describe("openShop", () => {
  it("uses the fixed desktop capability without a browser popup", async () => {
    const nativeOpen = vi.fn().mockResolvedValue(true);
    const open = vi.fn();
    expect(
      await openShop({
        location: { href: "synara://app/index.html" },
        desktopBridge: { openShop: nativeOpen },
        open,
      }),
    ).toBe(true);
    expect(nativeOpen).toHaveBeenCalledWith();
    expect(open).not.toHaveBeenCalled();
  });

  it("opens a named window on the same site, without leaking the current query", async () => {
    const popup = { opener: {}, focus: vi.fn() };
    const open = vi.fn().mockReturnValue(popup);
    expect(
      await openShop({
        location: { href: "http://localhost:5173/chat/thread?token=private" },
        open,
      }),
    ).toBe(true);
    expect(open).toHaveBeenCalledWith(
      "http://localhost:5173/shop/index.html",
      "djl-commerce",
      "popup,width=1180,height=820",
    );
    expect(popup.opener).toBeNull();
    expect(popup.focus).toHaveBeenCalledOnce();
  });

  it("reports a blocked popup rather than navigating the AI page", async () => {
    expect(await openShop({ location: { href: "http://localhost:5173/" }, open: () => null })).toBe(
      false,
    );
  });
});
