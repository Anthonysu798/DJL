import { describe, expect, it } from "vitest";
import { parseAnalyticsBatch, parseAnalyticsInstallation } from "./analytics";

const event = {
  eventId: "10000000-0000-4000-8000-000000000001",
  sessionId: "20000000-0000-4000-8000-000000000001",
  kind: "foreground",
  occurredAt: "2026-10-13T12:00:00.000Z",
};

describe("bounded product analytics contract", () => {
  it("accepts fixed features and rejects rich or fabricated identity fields", () => {
    expect(parseAnalyticsBatch({ events: [{ ...event, kind: "feature_used", feature: "remote_control" }] }).events).toHaveLength(1);
    for (const extra of [{ prompt: "private" }, { userId: "another-user" }, { properties: {} }, { feature: "remote_control" }]) {
      expect(() => parseAnalyticsBatch({ events: [{ ...event, ...extra }] })).toThrow();
    }
    expect(() => parseAnalyticsBatch({ events: [{ ...event, kind: "feature_used" }] })).toThrow();
  });

  it("rejects invalid ids, timestamps, oversized batches and unknown fields", () => {
    expect(() => parseAnalyticsBatch({ events: [{ ...event, eventId: "not-an-id" }] })).toThrow();
    expect(() => parseAnalyticsBatch({ events: [{ ...event, occurredAt: "yesterday" }] })).toThrow();
    expect(() => parseAnalyticsBatch({ events: Array.from({ length: 21 }, () => event) })).toThrow();
    expect(() => parseAnalyticsBatch({ events: [] })).toThrow();
    expect(() => parseAnalyticsBatch({ events: [event], apiKey: "private" })).toThrow();
  });

  it("registers coarse client metadata without accepting arbitrary identifiers", () => {
    const install = {
      installationId: event.eventId, platform: "ios", appVersion: "0.5.0", osVersion: "26.1", channel: "test",
    };
    expect(parseAnalyticsInstallation(install).platform).toBe("ios");
    expect(() => parseAnalyticsInstallation({ ...install, deviceName: "Personal iPhone" })).toThrow();
    expect(() => parseAnalyticsInstallation({ ...install, osVersion: "hostname-private" })).toThrow();
    expect(() => parseAnalyticsInstallation({ ...install, appVersion: "x".repeat(65) })).toThrow();
  });
});
