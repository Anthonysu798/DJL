import { describe, expect, it } from "vitest";

import { buildGroundedWorkPrompt, decideWorkTurnPolicy } from "./workRouter.ts";

describe("decideWorkTurnPolicy", () => {
  it.each([
    ["hi", "chat"],
    ["remember today was nice", "chat"],
    ["I work for a software company", "chat"],
    ["今天怎么样？", "chat"],
    ["What is today's NVDA price?", "web-research"],
    ["i want all the stocks prices for today", "web-research"],
    ["Use websearch to compare these companies", "web-research"],
    ["Use webfetch on https://example.com/data", "web-research"],
    ["Analyze MiniMax as a company and investment.", "web-research"],
    ["分析一下minimax 这家公司。", "web-research"],
    ["分析一下minimax 这家公司 值不值投资", "web-research"],
    ["今天英伟达的股票价格是多少？", "web-research"],
    ["How much RAM does this computer have?", "system-info"],
    ["我的电脑内存有多少？", "system-info"],
    ["Create a DOCX report", "office"],
    ["帮我创建一个 Word 文档", "office"],
    ["Read /tmp/fixture.txt", "file"],
    ["Read Deliverables/report.docx", "file"],
    ["读取 /tmp/fixture.txt", "file"],
    ["Fix the TypeScript bug and run its test", "coding"],
    ["修复这个代码并运行测试", "coding"],
  ])("routes %j to %s", (prompt, route) => {
    expect(decideWorkTurnPolicy({ prompt }).route).toBe(route);
  });

  it("shows no tools for ambiguous chat", () => {
    expect(decideWorkTurnPolicy({ prompt: "Tell me something interesting" })).toMatchObject({
      route: "chat",
      visibleTools: [],
      requireSuccessfulTool: false,
      evidenceRequired: false,
      instructionScope: "work-isolated",
    });
  });

  it("requires grounded tools for current facts and explicit actions", () => {
    expect(decideWorkTurnPolicy({ prompt: "What is today's NVDA price?" })).toMatchObject({
      visibleTools: ["websearch", "webfetch"],
      requireSuccessfulTool: true,
      evidenceRequired: true,
    });
    expect(decideWorkTurnPolicy({ prompt: "How much RAM does this Mac have?" })).toMatchObject({
      visibleTools: ["djl_system_info"],
      requireSuccessfulTool: true,
      evidenceRequired: true,
    });
    expect(decideWorkTurnPolicy({ prompt: "Read /tmp/fixture.txt" })).toMatchObject({
      requireSuccessfulTool: true,
      evidenceRequired: true,
    });
    expect(
      decideWorkTurnPolicy({
        prompt: "Fix the TypeScript bug and run its test",
      }),
    ).toMatchObject({
      requireSuccessfulTool: true,
      evidenceRequired: true,
    });
  });

  it("exposes only the office operation requested by the user", () => {
    expect(decideWorkTurnPolicy({ prompt: "Create a DOCX report" }).visibleTools).toEqual([
      "djl_create_document",
    ]);
    expect(
      decideWorkTurnPolicy({ prompt: "Modify the existing Word document" }).visibleTools,
    ).toEqual(["djl_modify_office_copy"]);
    expect(decideWorkTurnPolicy({ prompt: "Merge these PDF files" }).visibleTools).toEqual([
      "djl_merge_pdfs",
    ]);
    expect(decideWorkTurnPolicy({ prompt: "Read Deliverables/report.docx" }).visibleTools).toEqual([
      "djl_read_document",
    ]);
  });

  it("places an evidence-first boundary around tool-dependent requests", () => {
    const policy = decideWorkTurnPolicy({
      prompt: "What is today's NVDA price?",
    });
    const prompt = buildGroundedWorkPrompt("What is today's NVDA price?", policy);

    expect(prompt).toContain("Do not write an answer before a visible tool succeeds");
    expect(prompt).toContain("source URLs");
    expect(prompt).toContain("retrieval time");
    expect(prompt).toContain("never relabel Open");
    expect(prompt).toContain("report the conflict");
    expect(prompt).toContain("What is today's NVDA price?");
  });

  it("keeps ordinary chat conversational without implying project context", () => {
    const prompt = buildGroundedWorkPrompt("hi", decideWorkTurnPolicy({ prompt: "hi" }));

    expect(prompt).toBe("hi");
    expect(prompt).not.toContain("visible tool succeeds");
  });

  it("does not ask small local models to recalculate system byte counts", () => {
    const prompt = buildGroundedWorkPrompt(
      "How much RAM does this computer have?",
      decideWorkTurnPolicy({ prompt: "How much RAM does this computer have?" }),
    );

    expect(prompt).toContain("copy the tool's canonical GiB fields exactly");
    expect(prompt).toContain("Do not convert or recalculate raw byte values");
  });

  it("tells small local models exactly which tool to use for an explicit file path", () => {
    const prompt = buildGroundedWorkPrompt(
      "Read /tmp/fixture.txt",
      decideWorkTurnPolicy({ prompt: "Read /tmp/fixture.txt" }),
    );

    expect(prompt).toContain("call read now with that exact path");
  });

  it("uses the document extractor for an explicit Office path", () => {
    const prompt = buildGroundedWorkPrompt(
      "Read Deliverables/report.docx",
      decideWorkTurnPolicy({ prompt: "Read Deliverables/report.docx" }),
    );

    expect(prompt).toContain("call djl_read_document now with that exact path");
  });

  it("names the sole office tool that must create the requested deliverable", () => {
    const prompt = buildGroundedWorkPrompt(
      "Create a DOCX report",
      decideWorkTurnPolicy({ prompt: "Create a DOCX report" }),
    );

    expect(prompt).toContain("Call djl_create_document now");
    expect(prompt).toContain("until that exact tool succeeds");
  });
});
