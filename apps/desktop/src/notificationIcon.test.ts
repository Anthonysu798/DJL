import { describe, expect, it } from "vitest";

import { resolveNotificationIconAssetName } from "./notificationIcon";

describe("resolveNotificationIconAssetName", () => {
  it("uses the DJL PNG for Windows and Linux notifications", () => {
    expect(resolveNotificationIconAssetName("win32")).toBe("icon.png");
    expect(resolveNotificationIconAssetName("linux")).toBe("icon.png");
  });

  it("lets macOS use the signed application bundle icon", () => {
    expect(resolveNotificationIconAssetName("darwin")).toBeNull();
  });
});
