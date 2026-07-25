import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatRelativeTime } from "./relativeTime";

describe("formatRelativeTime", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-07-15T12:00:00Z") }));
  afterEach(() => vi.useRealTimers());

  it('returns "now" for timestamps less than 1 minute ago', () => {
    const iso = new Date(Date.now() - 30_000).toISOString();
    expect(formatRelativeTime(iso, "en")).toBe("now");
  });

  it("returns minutes for timestamps under an hour", () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(iso, "en")).toBe("5 min. ago");
  });

  it("returns hours for timestamps under a day", () => {
    const iso = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(iso, "en")).toBe("3 hr. ago");
  });

  it("returns days for timestamps over a day", () => {
    const iso = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(iso, "en")).toBe("2 days ago");
  });

  it('returns "now" for future timestamps caused by clock skew', () => {
    const iso = new Date(Date.now() + 60_000).toISOString();
    expect(formatRelativeTime(iso, "en")).toBe("now");
  });

  it("changes relative-time grammar with the selected locale", () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(iso, "fr")).not.toBe(formatRelativeTime(iso, "en"));
    expect(formatRelativeTime(iso, "fr")).toContain("5");
  });
});
