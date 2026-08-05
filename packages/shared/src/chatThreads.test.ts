import { describe, expect, it } from "vitest";

import {
  buildPromptThreadTitleFallback,
  GENERIC_CHAT_THREAD_TITLE,
  isGenericChatThreadTitle,
  isProviderProtocolOnlyText,
  sanitizeGeneratedThreadTitle,
} from "./chatThreads";

describe("chatThreads", () => {
  it("builds a short fallback title without forcing case", () => {
    expect(buildPromptThreadTitleFallback("FIX the BROKEN auth redirect in production now")).toBe(
      "FIX the BROKEN auth redirect in",
    );
  });

  it("falls back to the generic thread title when there is no usable text", () => {
    expect(buildPromptThreadTitleFallback("   \n\t  ")).toBe(GENERIC_CHAT_THREAD_TITLE);
  });

  it("sanitizes generated titles without lowercasing acronyms", () => {
    expect(sanitizeGeneratedThreadTitle('"Folder picker UI ASAP."')).toBe("Folder picker UI ASAP");
  });

  it("rejects leaked provider tool-call markup", () => {
    expect(
      sanitizeGeneratedThreadTitle(
        '<tool_calls> <tool_call name="Read"> <parameter name="file_path">policy.pdf</parameter>',
      ),
    ).toBe(GENERIC_CHAT_THREAD_TITLE);
    expect(sanitizeGeneratedThreadTitle('{"name":"websearch","arguments":{"query":"DJL"}}')).toBe(
      GENERIC_CHAT_THREAD_TITLE,
    );
  });

  it("rejects leaked DeepSeek DSML tool-call markup", () => {
    expect(
      sanitizeGeneratedThreadTitle(
        '<｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="websearch"> <｜｜DSML｜｜parameter name="query" string="true">MiniMax stock price</｜｜DSML｜｜parameter> </｜｜DSML｜｜invoke> </｜｜DSML｜｜tool_calls>',
      ),
    ).toBe(GENERIC_CHAT_THREAD_TITLE);
  });

  it("detects conventional JSON tool-call envelopes without hiding examples", () => {
    expect(
      isProviderProtocolOnlyText(
        '{"name":"websearch","arguments":{"query":"MiniMax stock price","numResults":6}}',
      ),
    ).toBe(true);
    expect(
      isProviderProtocolOnlyText(
        '```json\n{"name":"websearch","arguments":{"query":"example"}}\n```',
      ),
    ).toBe(false);
    expect(
      isProviderProtocolOnlyText("<example><tool_calls>documentation</tool_calls></example>"),
    ).toBe(false);
    expect(isProviderProtocolOnlyText("<article>Ordinary XML</article>")).toBe(false);
  });

  it("keeps distinguishing identifiers within the six-word cap", () => {
    expect(sanitizeGeneratedThreadTitle("PR #1234 Conflict Review and more extra")).toBe(
      "PR #1234 Conflict Review and more",
    );
  });

  it("detects the generic chat placeholder title", () => {
    expect(isGenericChatThreadTitle(" New thread ")).toBe(true);
    expect(isGenericChatThreadTitle("Manual rename")).toBe(false);
  });
});
