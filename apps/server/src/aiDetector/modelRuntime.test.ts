import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeFixture = vi.hoisted(() => {
  let releaseEnglish: (() => void) | undefined;
  let englishGate = new Promise<void>((resolve) => {
    releaseEnglish = resolve;
  });

  return {
    events: [] as string[],
    verifications: [] as string[],
    reset() {
      this.events.length = 0;
      this.verifications.length = 0;
      englishGate = new Promise<void>((resolve) => {
        releaseEnglish = resolve;
      });
    },
    releaseEnglish() {
      releaseEnglish?.();
    },
    async waitForEnglish() {
      await englishGate;
    },
  };
});

vi.mock("./modelInstaller", () => ({
  verifyInstalledModel: async (_root: string, language: string) => {
    runtimeFixture.verifications.push(language);
    return true;
  },
}));

vi.mock("@huggingface/transformers", () => ({
  env: {},
  AutoTokenizer: {
    from_pretrained: async (language: "en" | "zh-Hans") => ({
      encode: (text: string) => [
        101,
        ...Array.from(text, (character) => character.codePointAt(0)!),
        102,
      ],
      language,
    }),
  },
  pipeline: async (_task: string, language: "en" | "zh-Hans") => {
    const classifier = Object.assign(
      async () => {
        runtimeFixture.events.push(`score:start:${language}`);
        if (language === "en") await runtimeFixture.waitForEnglish();
        runtimeFixture.events.push(`score:end:${language}`);
        return language === "en"
          ? [
              { label: "human", score: 0.1 },
              { label: "ai", score: 0.9 },
            ]
          : [
              { label: "Human_Written", score: 0.1 },
              { label: "AI_Generated", score: 0.9 },
            ];
      },
      {
        tokenizer: {
          encode: (text: string) => [
            101,
            ...Array.from(text, (character) => character.codePointAt(0)!),
            102,
          ],
        },
        dispose: async () => {
          runtimeFixture.events.push(`dispose:${language}`);
        },
      },
    );
    return classifier;
  },
}));

import { DetectorModelRuntime } from "./modelRuntime";

describe("DetectorModelRuntime concurrency", () => {
  beforeEach(() => runtimeFixture.reset());

  it("does not dispose an active classifier when another language starts", async () => {
    const runtime = new DetectorModelRuntime("/tmp/djl-ai-detector-models");
    const english = runtime.score(
      "en",
      "A sufficiently long English passage.",
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(runtimeFixture.events).toContain("score:start:en"));

    const chinese = runtime.score(
      "zh-Hans",
      "这是一段用于并发检测的简体中文内容。",
      new AbortController().signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtimeFixture.events).not.toContain("dispose:en");
    expect(runtimeFixture.events).not.toContain("score:start:zh-Hans");

    runtimeFixture.releaseEnglish();
    await expect(english).resolves.toBe(0.9);
    await expect(chinese).resolves.toBe(0.9);

    expect(runtimeFixture.events).toEqual([
      "score:start:en",
      "score:end:en",
      "dispose:en",
      "score:start:zh-Hans",
      "score:end:zh-Hans",
    ]);
  });

  it("counts tokens with the installed model tokenizer without truncation", async () => {
    runtimeFixture.releaseEnglish();
    const runtime = new DetectorModelRuntime("/tmp/djl-ai-detector-models");

    await expect(runtime.countTokens("en", "abc", new AbortController().signal)).resolves.toBe(5);
  });

  it("does not re-hash a previously verified model on every language switch", async () => {
    runtimeFixture.releaseEnglish();
    const runtime = new DetectorModelRuntime("/tmp/djl-ai-detector-models");
    const signal = new AbortController().signal;

    await runtime.score("en", "English passage", signal);
    await runtime.score("zh-Hans", "简体中文段落", signal);
    await runtime.score("en", "Another English passage", signal);

    expect(runtimeFixture.verifications).toEqual(["en", "zh-Hans"]);
  });

  it("counts another language without disposing the active inference classifier", async () => {
    runtimeFixture.releaseEnglish();
    const runtime = new DetectorModelRuntime("/tmp/djl-ai-detector-models");
    const signal = new AbortController().signal;

    await runtime.score("en", "English passage", signal);
    await runtime.countTokens("zh-Hans", "简体中文段落", signal);
    await runtime.score("en", "Another English passage", signal);

    expect(runtimeFixture.events).toEqual([
      "score:start:en",
      "score:end:en",
      "score:start:en",
      "score:end:en",
    ]);
  });
});
