import * as FS from "node:fs";
import { describe, expect, it } from "vitest";

describe("font fallback stacks", () => {
  it("keeps CJK fallbacks after optional theme-provided families", () => {
    const css = FS.readFileSync(new URL("./index.css", import.meta.url), "utf8");
    const uiStack = css.match(/--font-ui-family:\s*([\s\S]*?);/)?.[1] ?? "";
    const monoStack = css.match(/--font-mono-family:\s*([\s\S]*?);/)?.[1] ?? "";
    const chatCodeStack = css.match(/--font-chat-code-family:\s*([^;]+);/)?.[1]?.trim() ?? "";

    expect(uiStack.indexOf("--theme-font-ui-family")).toBeLessThan(uiStack.indexOf("PingFang SC"));
    expect(monoStack.indexOf("--theme-font-code-family")).toBeLessThan(
      monoStack.indexOf("Noto Sans Mono CJK SC"),
    );
    expect(uiStack).toMatch(/var\(--theme-font-ui-family,[^)]+\),[\s\S]+PingFang SC/);
    expect(monoStack).toMatch(/var\(--theme-font-code-family,[^)]+\),[\s\S]+Noto Sans Mono CJK SC/);
    expect(chatCodeStack).toBe("var(--font-mono-family)");
  });
});
