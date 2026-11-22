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

  it("uses native tools for Work while retaining evidence requirements", () => {
    const prompt = buildGroundedWorkPrompt(
      "Read /tmp/report.docx",
      decideWorkTurnPolicy({ prompt: "Read /tmp/report.docx" }),
      "native",
    );
    expect(prompt).toContain("native tools");
    expect(prompt).toContain("visible tool succeeds");
    expect(prompt).not.toContain("call djl_read_document");
    expect(prompt).toContain("/tmp/report.docx");
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

describe("marketing conversation routing", () => {
  it("has the agent post in one call and answer in one short sentence, with no cloud sign-in", () => {
    const prompt = buildGroundedWorkPrompt(
      "Post this to Instagram",
      decideWorkTurnPolicy({ prompt: "Post this to Instagram" }),
      "native",
    );
    expect(prompt).toContain("call djl_multipost_post once");
    expect(prompt).toContain("do not also call djl_prepare_marketing");
    expect(prompt).toContain("one short sentence");
    expect(prompt).toContain("never ask the user to sign in to DJL Cloud");
  });
  it("routes beginner requests to marketing tools without intercepting coding requests", () => {
    for (const prompt of [
      "帮我把这些照片做成小红书宣传，一键发布",
      "Create an Instagram campaign for these hotel photos",
    ]) {
      expect(decideWorkTurnPolicy({ prompt, hasAttachments: true })).toMatchObject({
        route: "marketing",
        visibleTools: expect.arrayContaining([
          "djl_marketing_status",
          "djl_inspect_social_media",
          "djl_prepare_marketing",
          "djl_social_status",
          "djl_prepare_social_publish",
          "djl_cancel_social_task",
          "djl_social_metrics",
          "djl_import_product_url",
          "djl_brand_memory",
          "djl_media_library",
          "djl_repurpose_video",
          "djl_transcribe_video",
          "djl_social_workflows",
          "djl_social_inbox",
          "djl_social_coach",
        ]),
      });
    }
    expect(
      decideWorkTurnPolicy({ prompt: "Write TypeScript code for an Instagram marketing API" })
        .route,
    ).toBe("coding");
  });
});

it.each([
  "Turn this product page into social posts",
  "Find three clips from this video",
  "Search my media library",
  "Save this as my content workflow",
  "Show my upcoming posts",
  "Remember our brand tone",
  "为这个视频添加字幕",
  "搜索素材库",
])("routes the social agent capability request: %s", (prompt) => {
  expect(decideWorkTurnPolicy({ prompt }).route).toBe("marketing");
});

it("keeps an explicit social workspace workflow on social tools when its source contains coding terms", () => {
  expect(
    decideWorkTurnPolicy({
      prompt:
        "Social media workspace request. Resume Weekly Python tips and prepare a product post. Source text mentions code.",
    }).route,
  ).toBe("marketing");
  expect(decideWorkTurnPolicy({ prompt: "Write TypeScript code for an Instagram API" }).route).toBe(
    "coding",
  );
});
