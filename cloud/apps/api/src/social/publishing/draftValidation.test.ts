import { expect, it } from "vitest";
import { validateDraft } from "./PublishingService.ts";

it("allows a full photo description to reach account/media-specific validation without truncation", () => {
  const caption = "😀".repeat(2000);
  const input = {
    threadId: "thread",
    caption,
    captions: { account: caption },
    accountIds: ["account"],
    mediaFileIds: ["file"],
    scheduledAt: "2026-10-27T00:00:00Z",
    timezone: "UTC",
  };
  expect(() => validateDraft(input)).not.toThrow();
  expect(() => validateDraft({ ...input, caption: `${caption}a` })).toThrow();
  expect(() => validateDraft({ ...input, captions: { account: `${caption}a` } })).toThrow();
});
