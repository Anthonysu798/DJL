import { describe, expect, it } from "vitest";

import englishCatalog from "~/i18n/locales/en.json";

describe("remote settings copy", () => {
  it("ships user-facing copy for every remote bridge state", () => {
    const remote = englishCatalog.settings.remote;

    expect(remote.access.title).toBe("iPhone remote access");
    expect(remote.pairing.title).toBe("Pair your iPhone");
    expect(Object.keys(remote.status).toSorted()).toEqual([
      "connected",
      "disabled",
      "error",
      "offline",
      "ready",
      "starting",
      "unavailable",
    ]);
  });
});
