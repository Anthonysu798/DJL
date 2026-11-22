import { expect, it } from "vitest";
import { noticeText } from "./notice";

it("says what happened in plain words, naming the account", () => {
  expect(
    noticeText({ kind: "posted", platformKey: "instagram", label: "@djl.app" }, "en-CA"),
  ).toEqual({ title: "Your post is live", body: "@djl.app" });
  expect(noticeText({ kind: "failed", platformKey: "x", label: "@djl" }, "en")).toEqual({
    title: "A post didn't go out",
    body: "@djl. Open DJL to try again.",
  });
  expect(noticeText({ kind: "needs-you", platformKey: "x", label: "@djl" }, "en")).toEqual({
    title: "A post needs you",
    body: "@djl. Open DJL to finish it.",
  });
});
it("speaks the person's language and falls back to English", () => {
  expect(noticeText({ kind: "posted", platformKey: "x", label: "@djl" }, "zh-CN").title).toBe(
    "帖子已发布",
  );
  expect(noticeText({ kind: "posted", platformKey: "x", label: "@djl" }, "zh-TW").title).toBe(
    "貼文已發布",
  );
  expect(noticeText({ kind: "posted", platformKey: "x", label: "@djl" }, "fr-CA").title).toBe(
    "Votre publication est en ligne",
  );
  expect(noticeText({ kind: "posted", platformKey: "x", label: "" }, "de")).toEqual({
    title: "Your post is live",
    body: "",
  });
});
