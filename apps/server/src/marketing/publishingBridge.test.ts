import { describe, it, expect } from "vitest";
import { validatePublishingBinding } from "./publishingBridge";
describe("publishing card identity and revision", () => {
  const binding = {
    apiBaseUrl: "https://cloud.test",
    campaignId: "campaign",
    campaignRevision: 4,
    draftId: "draft",
    cloudRevision: 2,
    userId: "user",
    orgId: "org",
  };
  it("rejects stale content and account switches before confirmation", () => {
    expect(() =>
      validatePublishingBinding(binding, {
        apiBaseUrl: "https://cloud.test",
        campaignId: "campaign",
        campaignRevision: 5,
        draftId: "draft",
        cloudRevision: 2,
        userId: "user",
        orgId: "org",
      }),
    ).toThrow();
    expect(() => validatePublishingBinding(binding, { ...binding, userId: "other" })).toThrow();
    expect(() => validatePublishingBinding(binding, { ...binding, orgId: "other" })).toThrow();
    expect(() => validatePublishingBinding(binding, { ...binding, cloudRevision: 1 })).toThrow();
    expect(() => validatePublishingBinding(binding, binding)).not.toThrow();
  });
});
