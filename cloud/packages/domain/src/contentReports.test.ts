import { describe, expect, it } from "vitest";

import { contentReportFieldError } from "./contentReports.ts";

describe("contentReportFieldError", () => {
  it("accepts a cloud report naming a conversation and message", () => {
    expect(
      contentReportFieldError({ source: "cloud", conversationId: "c", messageId: "m" }),
    ).toBeNull();
  });

  it("accepts a desktop report carrying text, with or without an agent", () => {
    expect(contentReportFieldError({ source: "desktop", text: "answer" })).toBeNull();
    expect(
      contentReportFieldError({ source: "desktop", text: "answer", agent: "Codex" }),
    ).toBeNull();
  });

  it("rejects fields that belong to the other source", () => {
    const ids = { conversationId: "c", messageId: "m" };
    expect(contentReportFieldError({ source: "cloud", ...ids, text: "t" })).not.toBeNull();
    expect(contentReportFieldError({ source: "cloud", ...ids, agent: "a" })).not.toBeNull();
    expect(
      contentReportFieldError({ source: "desktop", text: "t", messageId: "m" }),
    ).not.toBeNull();
    expect(
      contentReportFieldError({ source: "desktop", text: "t", conversationId: "c" }),
    ).not.toBeNull();
  });

  it("rejects missing required fields", () => {
    expect(contentReportFieldError({ source: "cloud", messageId: "m" })).not.toBeNull();
    expect(contentReportFieldError({ source: "cloud", conversationId: "c" })).not.toBeNull();
    expect(contentReportFieldError({ source: "desktop" })).not.toBeNull();
    expect(contentReportFieldError({ source: "desktop", agent: "a" })).not.toBeNull();
  });
});
