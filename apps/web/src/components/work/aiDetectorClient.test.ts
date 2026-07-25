import type { AiDetectorReport } from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  url: "http://localhost:3773/api/ai-detector/analyze",
}));

vi.mock("~/lib/wsHttpUrl", () => ({
  resolveWsHttpUrl: () => transport.url,
}));

import {
  analyzeWriting,
  renderAiDetectorHtmlReport,
  serializeAiDetectorJsonReport,
  type AiDetectorReportExportOptions,
} from "./aiDetectorClient";

afterEach(() => {
  transport.url = "http://localhost:3773/api/ai-detector/analyze";
  vi.unstubAllGlobals();
});

const report: AiDetectorReport = {
  schemaVersion: 1,
  normalizedText: "<script>alert('private')</script>",
  languagePreference: "auto",
  scores: { likelyAi: 10, uncertain: 20, likelyHuman: 70 },
  assessment: "likely-human",
  confidence: "medium",
  eligibleCharacters: 35,
  excludedCharacters: 0,
  totalCharacters: 35,
  regions: [],
  modelRuns: [],
  preprocessingVersion: "test",
  segmentationVersion: "test",
  contentHash: "d".repeat(64),
  cacheHit: false,
  warnings: [],
};

const options: AiDetectorReportExportOptions = {
  includeText: false,
  reportLanguage: "zh-Hans",
  generatedAt: "2026-07-15T01:00:00.000Z",
  copy: {
    title: "DJL AI 写作检测",
    privacy: "您的文档不会离开此设备",
    methodology: "本地分类器分析",
    disclaimer: "本检测不能证明文本由谁撰写。",
    assessment: "信号混合",
    confidenceLabel: "可信度",
    confidence: "中",
    likelyAi: "AI 写作特征覆盖率",
    uncertain: "不确定覆盖率",
    likelyHuman: "可能为人类写作的覆盖率",
    eligible: "可检测字符",
    excluded: "排除字符",
    evidence: "段落依据",
    technicalDetails: "模型与技术详情",
    analyzedText: "检测文本",
    preprocessing: "预处理",
    segmentation: "分段",
    digest: "内容摘要",
    regionLabels: {
      "likely-ai": "可能由 AI 生成",
      uncertain: "无法确定",
      "likely-human": "可能由人类撰写",
      excluded: "未参与检测",
    },
    exclusionLabels: {},
  },
};

describe("AI detector report export", () => {
  it("omits analyzed text by default", () => {
    const json = serializeAiDetectorJsonReport(report, options);
    const html = renderAiDetectorHtmlReport(report, options);
    expect(json).not.toContain("private");
    expect(html).not.toContain("alert");
    expect(json).toContain('"reportLanguage": "zh-Hans"');
    expect(html).toContain("DJL AI 写作检测");
    expect(html).not.toContain("Likely AI");
  });

  it("escapes analyzed text when explicitly included in HTML", () => {
    const html = renderAiDetectorHtmlReport(report, { ...options, includeText: true });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("keeps JSON field names stable across report languages and includes text only by opt-in", () => {
    const withoutText = JSON.parse(serializeAiDetectorJsonReport(report, options)) as any;
    const withText = JSON.parse(
      serializeAiDetectorJsonReport(report, { ...options, includeText: true }),
    ) as any;

    expect(withoutText.summary.assessmentCode).toBe("likely-human");
    expect(withoutText.summary.confidenceCode).toBe("medium");
    expect(withoutText.summary.coverage).toEqual({
      likelyAi: 10,
      uncertain: 20,
      likelyHuman: 70,
    });
    expect(withoutText).not.toHaveProperty("analyzedText");
    expect(withText.analyzedText).toBe(report.normalizedText);
  });
});

describe("AI detector local-only transport", () => {
  it("refuses to transmit document text to a non-loopback DJL server", async () => {
    transport.url = "https://remote-djl.example/api/ai-detector/analyze";
    const fetchMock = vi.fn(async () => {
      throw new Error("document was transmitted");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      analyzeWriting({
        document: {
          data: "Private document text that must remain on this device.",
          languagePreference: "en",
        },
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "local-only" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels the response stream when a malformed local event is received", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("not-json\n"));
      },
      cancel,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream, { status: 200 })),
    );

    await expect(
      analyzeWriting({
        document: { data: "Local private text", languagePreference: "en" },
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }),
    ).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("maps local HTTP failures to stable localized error codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Document exceeds the 20 MB limit.", { status: 413 })),
    );

    await expect(
      analyzeWriting({
        document: { data: "Local private text", languagePreference: "en" },
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });
});
