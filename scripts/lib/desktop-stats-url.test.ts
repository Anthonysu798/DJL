import { assert, describe, it } from "@effect/vitest";

import { validateDesktopStatsUrl } from "./desktop-stats-url.ts";

describe("validateDesktopStatsUrl", () => {
  it("returns null when unset or blank", () => {
    assert.equal(validateDesktopStatsUrl(undefined), null);
    assert.equal(validateDesktopStatsUrl("   "), null);
  });

  it("accepts a clean https URL and strips trailing slashes", () => {
    assert.equal(
      validateDesktopStatsUrl("https://djl-stats.example.workers.dev/"),
      "https://djl-stats.example.workers.dev",
    );
  });

  it("rejects non-https URLs and URLs carrying credentials or query data", () => {
    assert.throws(() => validateDesktopStatsUrl("http://stats.example"));
    assert.throws(() => validateDesktopStatsUrl("https://u:p@stats.example"));
    assert.throws(() => validateDesktopStatsUrl("https://stats.example/?a=1"));
    assert.throws(() => validateDesktopStatsUrl("not a url"));
  });
});
