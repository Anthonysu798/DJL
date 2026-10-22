import { describe, expect, it } from "vitest";
import {
  createCampaign,
  reviseCampaign,
  approveCampaign,
  confirmAssistedPublication,
  platforms,
} from "./campaign";

describe("campaign approval lifecycle", () => {
  it("invalidates approval when content changes and refuses a stale approval", () => {
    const draft = createCampaign("Room launch");
    const prepared = reviseCampaign(draft, {
      captions: { instagram: "Explore our rooms" },
      platforms: ["instagram"],
      assetIds: ["asset-1"],
    });
    const approved = approveCampaign(prepared, prepared.revision);
    expect(approved.approvedRevision).toBe(prepared.revision);
    const changed = reviseCampaign(approved, { captions: { instagram: "Updated copy" } });
    expect(changed.approvedRevision).toBeNull();
    expect(() => approveCampaign(changed, prepared.revision)).toThrow("changed");
  });
  it("requires content and explicit approval before confirming a manual publication", () => {
    const draft = createCampaign("Launch");
    expect(() => approveCampaign(draft, draft.revision)).toThrow();
    expect(() => confirmAssistedPublication(draft, "instagram")).toThrow();
    const ready = reviseCampaign(draft, {
      platforms: ["instagram"],
      assetIds: ["asset-1"],
      captions: { instagram: "Launch" },
    });
    const approved = approveCampaign(ready, ready.revision);
    const published = confirmAssistedPublication(approved, "instagram");
    expect(published.publications.instagram?.source).toBe("user-confirmed");
    expect(confirmAssistedPublication(published, "instagram")).toEqual(published);
  });
  it("covers every requested destination without assuming direct publishing access", () => {
    expect(platforms).toHaveLength(14);
    expect(platforms.every((p) => p.directPublishing === false)).toBe(true);
    expect(platforms.find((p) => p.id === "whatsapp")?.kind).toBe("business-messaging");
  });
});
