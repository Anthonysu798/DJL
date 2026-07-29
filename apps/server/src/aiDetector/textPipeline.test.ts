import { describe, expect, it } from "vitest";

import {
  AI_DETECTOR_PREPROCESSING_VERSION,
  AI_DETECTOR_SEGMENTATION_VERSION,
  aggregateReport,
  calibrateScore,
  classifyParagraphLanguage,
  normalizeWithOffsets,
  routeEligibleProse,
  segmentPassages,
  segmentPassagesTokenAware,
} from "./textPipeline";

describe("AI detector text pipeline", () => {
  it("versions the hardened routing and token-aware segmentation for cache invalidation", () => {
    expect(AI_DETECTOR_PREPROCESSING_VERSION).toBe("djl-prose-v2");
    expect(AI_DETECTOR_SEGMENTATION_VERSION).toBe("djl-passages-v3");
  });

  it("normalizes CRLF and compatibility characters with monotonic source offsets", () => {
    const normalized = normalizeWithOffsets("ＡI\r\ntext\0");
    expect(normalized.text).toBe("AI\ntext");
    expect(normalized.sourceOffsets).toHaveLength(normalized.text.length + 1);
    expect(
      normalized.sourceOffsets.every(
        (value, index, values) => index === 0 || value >= values[index - 1]!,
      ),
    ).toBe(true);
    expect(normalized.sourceOffsets.at(-1)).toBe(8);
  });

  it("normalizes decomposed grapheme clusters as a unit", () => {
    const normalized = normalizeWithOffsets("Cafe\u0301");

    expect(normalized.text).toBe("Café");
    expect(normalized.sourceOffsets).toEqual([0, 1, 2, 3, 5]);
  });

  it("routes English, Simplified Chinese, and unsupported prose", () => {
    expect(classifyParagraphLanguage("This paragraph contains an ordinary English sentence.")).toBe(
      "en",
    );
    expect(classifyParagraphLanguage("这是一段用于语言识别的简体中文内容。")).toBe("zh-Hans");
    expect(classifyParagraphLanguage("🙂 123")).toBe("unsupported");
  });

  it("does not route Japanese prose through the Simplified Chinese model", () => {
    expect(
      classifyParagraphLanguage("これは日本語で書かれた文章であり、中国語ではありません。"),
    ).toBe("unsupported");
  });

  it("does not route Traditional Chinese prose through the Simplified Chinese model", () => {
    expect(
      classifyParagraphLanguage("這是一段使用繁體中文撰寫的內容，用於檢測語言路由是否正確。"),
    ).toBe("unsupported");
  });

  it("routes English and Simplified Chinese sentences separately on the same line", () => {
    const text =
      "This English sentence contains enough natural prose for a reliable language decision. 这是一段包含足够自然文本的简体中文句子，用于可靠地选择本地检测模型。";
    const eligible = routeEligibleProse(text, "auto").filter(
      (span) => span.excludedReason === undefined,
    );

    expect(eligible.map((span) => span.language)).toEqual(["en", "zh-Hans"]);
    expect(eligible.map((span) => text.slice(span.start, span.end).trim())).toEqual([
      "This English sentence contains enough natural prose for a reliable language decision.",
      "这是一段包含足够自然文本的简体中文句子，用于可靠地选择本地检测模型。",
    ]);
  });

  it("removes zero-width and non-text control characters while preserving offsets", () => {
    const normalized = normalizeWithOffsets("A\u200bB\u0007C\tD\nE");
    expect(normalized.text).toBe("ABC\tD\nE");
    expect(normalized.sourceOffsets).toHaveLength(normalized.text.length + 1);
    expect(normalized.sourceOffsets.at(-1)).toBe(9);
  });

  it("excludes headings, quotes, lists, code, references, and unsupported spans", () => {
    const text = [
      "# Heading\n",
      "> A quoted sentence that should not influence the writing detector.\n",
      "- a short list item\n",
      "```ts\n",
      "const value = 1;\n",
      "```\n",
      "This is a long eligible English paragraph with enough ordinary prose to be routed into the English detector and scored as part of the document.\n",
      "References\n",
      "Smith, A. (2024). Example.\n",
    ].join("");
    const spans = routeEligibleProse(text, "auto");
    expect(spans.some((span) => span.excludedReason === undefined && span.language === "en")).toBe(
      true,
    );
    expect(new Set(spans.map((span) => span.excludedReason).filter(Boolean))).toEqual(
      expect.objectContaining(new Set(["heading", "quotation", "list", "code", "references"])),
    );
  });

  it("uses inclusive conservative calibration boundaries", () => {
    expect(calibrateScore("en", 0.001, 119)).toBe("uncertain");
    expect(calibrateScore("zh-Hans", 0.999, 119)).toBe("uncertain");
    expect(calibrateScore("en", 0.35, 800)).toBe("likely-human");
    expect(calibrateScore("en", 0.351, 800)).toBe("uncertain");
    expect(calibrateScore("en", 0.9899, 800)).toBe("uncertain");
    expect(calibrateScore("en", 0.99, 800)).toBe("likely-ai");
    expect(calibrateScore("en", 0.999, 599)).toBe("uncertain");
    expect(calibrateScore("en", 0.9899, 1_000)).toBe("uncertain");
    expect(calibrateScore("en", 0.99, 1_000)).toBe("likely-ai");
    expect(calibrateScore("zh-Hans", 0.015, 200)).toBe("likely-human");
    expect(calibrateScore("zh-Hans", 0.799, 200)).toBe("uncertain");
    expect(calibrateScore("zh-Hans", 0.8, 200)).toBe("likely-ai");
    expect(calibrateScore("zh-Hans", 0.799, 400)).toBe("uncertain");
    expect(calibrateScore("zh-Hans", 0.8, 400)).toBe("likely-ai");
    expect(calibrateScore("zh-Hans", 0.25, 800)).toBe("likely-human");
    expect(calibrateScore("zh-Hans", 0.8, 800)).toBe("likely-ai");
  });

  it("segments deterministically and counts overlap only once", () => {
    const text = `${"This is a complete English sentence with explanatory prose. ".repeat(40)}\n`;
    const routed = routeEligibleProse(text, "auto");
    const passages = segmentPassages(text, routed);
    expect(passages.length).toBeGreaterThan(1);
    expect(segmentPassages(text, routed)).toEqual(passages);
    const scored = passages.map((passage, index) =>
      Object.assign({}, passage, { aiProbability: index % 2 === 0 ? 0.9 : 0.1 }),
    );
    const result = aggregateReport({ text, routed, passages: scored });
    expect(result.scores.likelyAi + result.scores.uncertain + result.scores.likelyHuman).toBe(100);
    expect(result.eligibleCharacters).toBeLessThanOrEqual(text.length);
    for (let index = 1; index < result.regions.length; index += 1) {
      expect(result.regions[index]!.start).toBeGreaterThanOrEqual(result.regions[index - 1]!.end);
    }
  });

  it("shrinks passages until the installed tokenizer fits the model limit", async () => {
    const text = `${"word ".repeat(400)}\n`;
    const routed = routeEligibleProse(text, "auto");
    const passages = await segmentPassagesTokenAware(
      text,
      routed,
      async (_language, passageText) => passageText.length + 2,
      new AbortController().signal,
      { maxTokens: 200 },
    );

    expect(passages.length).toBeGreaterThan(2);
    expect(passages.every((passage) => passage.text.length + 2 <= 200)).toBe(true);
  });

  it("keeps tokenizer-limited overlap proportional instead of advancing one character", async () => {
    const text = `${"word ".repeat(220)}\n`;
    const passages = await segmentPassagesTokenAware(
      text,
      routeEligibleProse(text, "auto"),
      async (_language, passageText) => passageText.length + 2,
      new AbortController().signal,
      { maxTokens: 200 },
    );

    expect(passages.length).toBeLessThanOrEqual(10);
    expect(
      passages.slice(1).every((passage, index) => passage.start - passages[index]!.start >= 100),
    ).toBe(true);
  });

  it("does not rescore nested suffixes when a fitted passage ends in whitespace", async () => {
    const text = `${"This is ordinary English prose with enough detail for a stable passage. ".repeat(5)}\n`;
    const passages = await segmentPassagesTokenAware(
      text,
      routeEligibleProse(text, "auto"),
      async () => 80,
      new AbortController().signal,
    );

    expect(passages).toHaveLength(1);
    expect(passages[0]?.text).toBe(text.trim());
  });

  it("groups tokenization by language so mixed documents do not reload models per span", async () => {
    const text = [
      "This is the first complete English paragraph with enough ordinary prose for routing.\n",
      "这是第一段结构完整的简体中文正文，用于验证混合语言文档的分词顺序。\n",
      "This is the second complete English paragraph with enough ordinary prose for routing.\n",
      "这是第二段结构完整的简体中文正文，用于验证本地模型不会反复加载。\n",
    ].join("");
    const tokenizedLanguages: string[] = [];
    await segmentPassagesTokenAware(
      text,
      routeEligibleProse(text, "auto"),
      async (language, passageText) => {
        tokenizedLanguages.push(language);
        return passageText.length;
      },
      new AbortController().signal,
    );
    const transitions = tokenizedLanguages.filter(
      (language, index) => index === 0 || language !== tokenizedLanguages[index - 1],
    );

    expect(new Set(tokenizedLanguages)).toEqual(new Set(["en", "zh-Hans"]));
    expect(transitions).toHaveLength(2);
  });

  it("abstains on short eligible text", () => {
    const text = "This sentence is eligible but too short for a responsible document assessment.";
    const routed = routeEligibleProse(text, "auto");
    const passages = segmentPassages(text, routed).map((passage) =>
      Object.assign({}, passage, { aiProbability: 0.99 }),
    );
    expect(aggregateReport({ text, routed, passages }).assessment).toBe("insufficient");
  });

  it("requires 120 eligible characters for each language in a mixed document", () => {
    const english = "a".repeat(40);
    const chinese = "中".repeat(90);
    const text = `${english}${chinese}`;
    const report = aggregateReport({
      text,
      routed: [
        { start: 0, end: english.length, language: "en" },
        {
          start: english.length,
          end: text.length,
          language: "zh-Hans",
        },
      ],
      passages: [
        {
          id: "short-en",
          start: 0,
          end: english.length,
          language: "en",
          text: english,
          aiProbability: 0.5,
        },
        {
          id: "short-zh",
          start: english.length,
          end: text.length,
          language: "zh-Hans",
          text: chinese,
          aiProbability: 0.999,
        },
      ],
    });

    expect(report.eligibleCharacters).toBe(130);
    expect(report.scores).toEqual({ likelyAi: 0, uncertain: 100, likelyHuman: 0 });
    expect(report.assessment).toBe("inconclusive");
  });

  it("does not label a short single-passage English document as likely AI", () => {
    const text =
      "The community garden opens early each Saturday so neighbors can water seedlings before the afternoon heat. Volunteers record soil conditions, repair shared tools, and explain the planting schedule to new members. The group reviews its routines every month and changes them when a plot becomes difficult to maintain. These practical habits keep the garden welcoming and dependable throughout the growing season.";
    const routed = routeEligibleProse(text, "auto");
    const passages = segmentPassages(text, routed).map((passage) =>
      Object.assign({}, passage, { aiProbability: 0.999 }),
    );

    expect(text.length).toBeLessThan(600);
    expect(aggregateReport({ text, routed, passages })).toMatchObject({
      scores: { likelyAi: 0, uncertain: 100, likelyHuman: 0 },
      assessment: "inconclusive",
      confidence: "low",
    });
  });

  it("distinguishes inconclusive evidence from conflicting AI and human regions", () => {
    const text = `${"This is a complete English sentence with stable explanatory prose. ".repeat(25)}\n`;
    const routed = routeEligibleProse(text, "auto");
    const passages = segmentPassages(text, routed);

    const inconclusive = aggregateReport({
      text,
      routed,
      passages: passages.map((passage) => Object.assign({}, passage, { aiProbability: 0.8 })),
    });
    expect(inconclusive.assessment).toBe("inconclusive");

    const mixedText = "a".repeat(1_400);
    const mixed = aggregateReport({
      text: mixedText,
      routed: [{ start: 0, end: mixedText.length, language: "en" }],
      passages: [
        {
          id: "en-ai-half",
          start: 0,
          end: 700,
          language: "en",
          text: mixedText.slice(0, 700),
          aiProbability: 0.999,
        },
        {
          id: "en-human-half",
          start: 700,
          end: 1_400,
          language: "en",
          text: mixedText.slice(700),
          aiProbability: 0.01,
        },
      ],
    });
    expect(mixed.assessment).toBe("mixed");
  });

  it("reports no percentages when every span is an unsupported language", () => {
    const text = "これは日本語で書かれた文章であり、対応している中国語ではありません。";
    const routed = routeEligibleProse(text, "auto");
    const report = aggregateReport({ text, routed, passages: [] });

    expect(report.eligibleCharacters).toBe(0);
    expect(report.scores).toEqual({ likelyAi: 0, uncertain: 0, likelyHuman: 0 });
    expect(report.assessment).toBe("unsupported");
  });

  it("distinguishes excluded supported-language content from an unsupported language", () => {
    const text = [
      "> This quoted English sentence is excluded from authorship analysis.\n",
      "```ts\n",
      "const generated = true;\n",
      "```\n",
    ].join("");
    const routed = routeEligibleProse(text, "auto");
    const report = aggregateReport({ text, routed, passages: [] });

    expect(report.eligibleCharacters).toBe(0);
    expect(report.assessment).toBe("insufficient");
  });

  it.each([
    [
      "English",
      `${"This is a complete English sentence with stable academic prose. ".repeat(30)}\n`,
    ],
    [
      "Simplified Chinese",
      `${"这是一段结构完整、用于验证稳定分段和覆盖率计算的简体中文正文。".repeat(45)}\n`,
    ],
    [
      "mixed English and Chinese",
      `${"This is a complete English paragraph used to verify deterministic coverage. ".repeat(18)}\n${"这是一段用于验证中英文混合文本稳定性的简体中文正文。".repeat(35)}\n`,
    ],
  ])("produces identical %s coverage across 20 runs", (_label, text) => {
    const signatures = Array.from({ length: 20 }, () => {
      const routed = routeEligibleProse(text, "auto");
      const passages = segmentPassages(text, routed).map((passage) =>
        Object.assign({}, passage, {
          aiProbability: passage.language === "en" ? 0.82 : 0.18,
        }),
      );
      const report = aggregateReport({ text, routed, passages });
      return JSON.stringify({
        scores: report.scores,
        assessment: report.assessment,
        confidence: report.confidence,
        regions: report.regions,
      });
    });

    expect(new Set(signatures)).toHaveLength(1);
  });
});
