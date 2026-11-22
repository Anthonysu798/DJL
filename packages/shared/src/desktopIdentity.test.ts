import { describe, expect, it } from "vitest";

import {
  DJL_DESKTOP_ENTRY_URL,
  DJL_DESKTOP_ORIGIN,
  DJL_DESKTOP_UPDATE_CHANNEL,
  DJL_DEVELOPMENT_BUNDLE_ID,
  DJL_PRODUCTION_BUNDLE_ID,
  djlBundleId,
} from "./desktopIdentity";

describe("desktopIdentity", () => {
  it("uses the exact canonical production and development bundle IDs", () => {
    expect(DJL_PRODUCTION_BUNDLE_ID).toBe("app.djl.desktop");
    expect(DJL_DEVELOPMENT_BUNDLE_ID).toBe("app.djl.desktop.dev");
    expect(djlBundleId(false)).toBe(DJL_PRODUCTION_BUNDLE_ID);
    expect(djlBundleId(true)).toBe(DJL_DEVELOPMENT_BUNDLE_ID);
  });

  it("uses the exact packaged renderer origin and entry URL", () => {
    expect(DJL_DESKTOP_ORIGIN).toBe("djl-app://app");
    expect(DJL_DESKTOP_ENTRY_URL).toBe("djl-app://app/index.html");
  });

  it("uses the isolated DJL desktop update channel", () => {
    expect(DJL_DESKTOP_UPDATE_CHANNEL).toBe("djl");
  });
});
