import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { CloudCreateContentReportInput, CloudCreateContentReportResponse } from "./reports";

const decode = Schema.decodeUnknownSync(CloudCreateContentReportInput);

describe("content report contract", () => {
  it("decodes a cloud report and a desktop report", () => {
    expect(
      decode({ source: "cloud", reason: "offensive", conversationId: "c1", messageId: "m1" }),
    ).toEqual({ source: "cloud", reason: "offensive", conversationId: "c1", messageId: "m1" });
    expect(
      decode({
        source: "desktop",
        reason: "wrong",
        text: "  the answer ",
        agent: " Codex ",
        note: "  bad  ",
      }),
    ).toEqual({
      source: "desktop",
      reason: "wrong",
      text: "  the answer ",
      agent: "Codex",
      note: "bad",
    });
  });

  it("rejects unknown sources and reasons", () => {
    expect(() => decode({ source: "web", reason: "offensive", text: "x" })).toThrow();
    expect(() => decode({ source: "desktop", reason: "spam", text: "x" })).toThrow();
  });

  it("bounds note, text, and agent", () => {
    const desktop = { source: "desktop", reason: "other" };
    expect(() => decode({ ...desktop, text: "x", note: "n".repeat(1001) })).toThrow();
    expect(decode({ ...desktop, text: "x", note: ` ${"n".repeat(1000)} ` }).note).toHaveLength(
      1000,
    );
    expect(() => decode({ ...desktop, text: "" })).toThrow();
    expect(() => decode({ ...desktop, text: "t".repeat(20_001) })).toThrow();
    expect(decode({ ...desktop, text: "t".repeat(20_000) }).text).toHaveLength(20_000);
    expect(() => decode({ ...desktop, text: "x", agent: "a".repeat(81) })).toThrow();
  });

  it("decodes the create response", () => {
    expect(
      Schema.decodeUnknownSync(CloudCreateContentReportResponse)({
        report: { id: "r1", createdAt: "2026-11-20T00:00:00.000Z" },
      }).report.id,
    ).toBe("r1");
  });
});
