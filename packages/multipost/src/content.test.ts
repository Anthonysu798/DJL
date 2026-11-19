import { it, expect } from "vitest";
import { normalizeContent } from "./content";
it("renders Markdown into the reviewed HTML and preserves source text", () => {
  const result = normalizeContent("article", {
    title: "Article",
    markdownContent: "# Heading\n\n**Saved facts**",
  });
  expect(result.htmlContent).toContain("<h1>Heading</h1>");
  expect(result.htmlContent).toContain("<strong>Saved facts</strong>");
  expect(result.markdownContent).toContain("**Saved facts**");
});
it("supplies empty media arrays for text-only publishers without inventing media", () => {
  const result = normalizeContent("dynamic", { title: "Trip", content: "Real caption" });
  expect(result.images).toEqual([]);
  expect(result.videos).toEqual([]);
  expect(result.content).toBe("Real caption");
});
