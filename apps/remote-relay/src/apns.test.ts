import { describe, expect, it } from "vitest";

import { buildGenericPushPayload, normalizeDeviceToken } from "./apns";

describe("generic DJL push payload", () => {
  it("contains routing metadata but never transcript content", () => {
    const payload = buildGenericPushPayload({
      threadId: "thread-123",
      turnId: "turn-456",
      result: "completed",
    });

    expect(payload).toEqual({
      aps: {
        alert: {
          title: "DJL task finished",
          body: "Open DJL to review the result.",
        },
        sound: "default",
      },
      source: "djl.runCompletion",
      threadId: "thread-123",
      turnId: "turn-456",
      result: "completed",
    });
    expect(JSON.stringify(payload)).not.toMatch(/prompt|response|preview|message/i);
  });

  it("accepts only canonical APNs tokens", () => {
    expect(normalizeDeviceToken("AA bb-01")).toBe("aabb01");
    expect(normalizeDeviceToken("xyz")).toBeNull();
    expect(normalizeDeviceToken("ab".repeat(101))).toBeNull();
  });
});
