import { expect, it } from "vitest";
import { captionWarnings, foldCaption, postLook } from "./postLook";

it("warns before posting when a platform would cut the caption or refuse the hashtags", () => {
  expect(captionWarnings("a".repeat(322), ["x", "instagram", "x"])).toEqual([
    { platformKey: "x", kind: "too-long", over: 42 },
  ]);
  const tags = Array.from({ length: 31 }, (_, n) => `#tag${n}`).join(" ");
  expect(captionWarnings(tags, ["instagram", "tiktok"])).toEqual([
    { platformKey: "instagram", kind: "too-many-hashtags", allowed: 30 },
  ]);
  expect(captionWarnings("Short and sweet #hello", ["x", "instagram", "somewhere-new"])).toEqual(
    [],
  );
});
it("counts an emoji as one character, like people do", () => {
  expect(captionWarnings("👋".repeat(280), ["x"])).toEqual([]);
});
it("shows the caption the way the feed folds it", () => {
  expect(foldCaption("a".repeat(200), "instagram")).toEqual({ shown: "a".repeat(125), more: true });
  expect(foldCaption("  Hello  ", "instagram")).toEqual({ shown: "Hello", more: false });
});
it("frames the picture the way each platform does, with a square for ones it does not know", () => {
  expect(postLook("instagram").ratio).toBe("1 / 1");
  expect(postLook("tiktok").ratio).toBe("9 / 16");
  expect(postLook("somewhere-new").ratio).toBe("1 / 1");
});
