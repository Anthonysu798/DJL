import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeFixture = vi.hoisted(() => {
  type Language = "en" | "zh-Hans";
  type OutputSpec = {
    readonly data: Float32Array | Float64Array | BigInt64Array;
    readonly dims: readonly number[];
    readonly type: string;
    readonly size?: number;
  };

  let releaseEnglish: (() => void) | undefined;
  let englishGate = Promise.resolve();
  let afterModel: (() => void) | undefined;
  let modelError: Error | undefined;
  const disposalErrors = new Map<string, Error>();

  return {
    events: [] as string[],
    inputDisposals: [] as string[],
    outputDisposals: [] as string[],
    tokenizerDisposals: [] as string[],
    modelLoads: [] as Array<{ readonly language: Language; readonly options: unknown }>,
    tokenizerLoads: [] as Array<{ readonly language: Language; readonly options: unknown }>,
    tokenizations: [] as Array<{ readonly language: Language; readonly options: unknown }>,
    verifications: [] as string[],
    pipelineCalls: 0,
    outputs: {
      en: {
        data: new Float32Array([0, Math.log(9)]),
        dims: [1, 2],
        type: "float32",
      },
      "zh-Hans": {
        data: new Float32Array([0, Math.log(9)]),
        dims: [1, 2],
        type: "float32",
      },
    } as Record<Language, OutputSpec>,
    reset() {
      this.events.length = 0;
      this.inputDisposals.length = 0;
      this.outputDisposals.length = 0;
      this.tokenizerDisposals.length = 0;
      this.modelLoads.length = 0;
      this.tokenizerLoads.length = 0;
      this.tokenizations.length = 0;
      this.verifications.length = 0;
      this.pipelineCalls = 0;
      this.outputs.en = {
        data: new Float32Array([0, Math.log(9)]),
        dims: [1, 2],
        type: "float32",
      };
      this.outputs["zh-Hans"] = {
        data: new Float32Array([0, Math.log(9)]),
        dims: [1, 2],
        type: "float32",
      };
      afterModel = undefined;
      modelError = undefined;
      disposalErrors.clear();
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
    setAfterModel(callback: () => void) {
      afterModel = callback;
    },
    runAfterModel() {
      afterModel?.();
    },
    setModelError(error: Error) {
      modelError = error;
    },
    getModelError() {
      return modelError;
    },
    setDisposalError(name: string, error: Error) {
      disposalErrors.set(name, error);
    },
    disposeTensor(name: string) {
      const error = disposalErrors.get(name);
      if (error) throw error;
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
    from_pretrained: async (language: "en" | "zh-Hans", options: unknown) => {
      runtimeFixture.tokenizerLoads.push({ language, options });
      return Object.assign(
        (_text: string, tokenizationOptions: unknown) => {
          runtimeFixture.tokenizations.push({ language, options: tokenizationOptions });
          const input = (name: string) => ({
            data: new BigInt64Array([1n]),
            dims: [1, 1],
            size: 1,
            type: "int64",
            dispose: () => {
              const disposalName = `${language}:${name}`;
              runtimeFixture.inputDisposals.push(disposalName);
              runtimeFixture.disposeTensor(disposalName);
            },
          });
          return {
            input_ids: input("input_ids"),
            attention_mask: input("attention_mask"),
          };
        },
        {
          encode: (text: string) => [
            101,
            ...Array.from(text, (character) => character.codePointAt(0)!),
            102,
          ],
          dispose: () => runtimeFixture.tokenizerDisposals.push(language),
        },
      );
    },
  },
  AutoModelForSequenceClassification: {
    from_pretrained: async (language: "en" | "zh-Hans", options: unknown) => {
      runtimeFixture.modelLoads.push({ language, options });
      return Object.assign(
        async () => {
          runtimeFixture.events.push(`score:start:${language}`);
          if (language === "en") await runtimeFixture.waitForEnglish();
          const modelError = runtimeFixture.getModelError();
          if (modelError) throw modelError;
          const spec = runtimeFixture.outputs[language];
          const logits = {
            data: spec.data,
            dims: spec.dims,
            size: spec.size ?? spec.data.length,
            type: spec.type,
            dispose: () => {
              runtimeFixture.outputDisposals.push(language);
              runtimeFixture.disposeTensor(`${language}:logits`);
            },
          };
          runtimeFixture.runAfterModel();
          runtimeFixture.events.push(`score:end:${language}`);
          return { logits };
        },
        {
          config: {
            problem_type: "multi_label_classification",
            id2label: { "0": "ai", "1": "human" },
          },
          dispose: async () => {
            runtimeFixture.events.push(`dispose:${language}`);
          },
        },
      );
    },
  },
  pipeline: async () => {
    runtimeFixture.pipelineCalls += 1;
    throw new Error("The text-classification pipeline must not be used.");
  },
}));

import {
  DetectorModelRuntime,
  detectorProbabilityFromLogits,
  type DetectorLogits,
} from "./modelRuntime";

function logits(
  data: Float32Array | Float64Array | BigInt64Array,
  dims: readonly number[],
  type: string,
  size = data.length,
): DetectorLogits {
  return { data, dims, size, type, dispose: () => undefined };
}

describe("detectorProbabilityFromLogits", () => {
  it("uses numerically stable two-logit softmax with the declared AI index", () => {
    expect(
      detectorProbabilityFromLogits(logits(new Float64Array([1_000, 999]), [1, 2], "float64"), {
        probability: "two-logit-softmax",
        aiLabelIndex: 0,
      }),
    ).toBeCloseTo(0.731_058_578_6, 10);
    expect(
      detectorProbabilityFromLogits(logits(new Float64Array([-1_000, -999]), [1, 2], "float64"), {
        probability: "two-logit-softmax",
        aiLabelIndex: 1,
      }),
    ).toBeCloseTo(0.731_058_578_6, 10);
  });

  it("uses a stable sigmoid for a declared single AI logit", () => {
    const output = { probability: "single-logit-sigmoid", aiLabelIndex: 0 } as const;
    expect(
      detectorProbabilityFromLogits(logits(new Float32Array([0]), [1, 1], "float32"), output),
    ).toBe(0.5);
    expect(
      detectorProbabilityFromLogits(logits(new Float64Array([1_000]), [1, 1], "float64"), output),
    ).toBe(1);
    expect(
      detectorProbabilityFromLogits(logits(new Float64Array([-1_000]), [1, 1], "float64"), output),
    ).toBe(0);
  });

  it.each([
    ["missing logits", undefined],
    ["missing batch dimension", logits(new Float32Array([0, 1]), [2], "float32")],
    ["wrong batch size", logits(new Float32Array([0, 1, 2, 3]), [2, 2], "float32")],
    ["wrong class count", logits(new Float32Array([0]), [1, 1], "float32")],
    ["wrong data length", logits(new Float32Array([0]), [1, 2], "float32")],
    ["wrong reported size", logits(new Float32Array([0, 1]), [1, 2], "float32", 1)],
    ["non-finite data", logits(new Float32Array([0, Number.NaN]), [1, 2], "float32")],
    ["integer data", logits(new BigInt64Array([0n, 1n]), [1, 2], "int64")],
    ["mismatched float data", logits(new Float64Array([0, 1]), [1, 2], "float32")],
  ])("rejects %s", (_name, invalid) => {
    expect(() =>
      detectorProbabilityFromLogits(invalid, {
        probability: "two-logit-softmax",
        aiLabelIndex: 1,
      }),
    ).toThrow(/invalid classification logits/i);
  });
});

describe("DetectorModelRuntime", () => {
  beforeEach(() => runtimeFixture.reset());

  it("uses the manifest contract instead of model config or label text", async () => {
    runtimeFixture.releaseEnglish();
    runtimeFixture.outputs.en = {
      data: new Float32Array([-2, -1]),
      dims: [1, 2],
      type: "float32",
    };
    const runtime = new DetectorModelRuntime("/tmp/djl-ai-detector-models");

    await expect(
      runtime.score("en", "A sufficiently long English passage.", new AbortController().signal),
    ).resolves.toBeCloseTo(0.731_058_578_6, 6);

    expect(runtimeFixture.pipelineCalls).toBe(0);
    expect(runtimeFixture.modelLoads).toEqual([
      {
        language: "en",
        options: { local_files_only: true, device: "cpu", dtype: "q8" },
      },
    ]);
    expect(runtimeFixture.tokenizerLoads).toEqual([
      { language: "en", options: { local_files_only: true } },
    ]);
    expect(runtimeFixture.tokenizations).toEqual([
      {
        language: "en",
        options: { padding: true, truncation: true, max_length: 512 },
      },
    ]);
    expect(runtimeFixture.outputDisposals).toEqual(["en"]);
    expect(runtimeFixture.inputDisposals).toEqual(["en:input_ids", "en:attention_mask"]);
  });

  it("does not dispose an active model when another language starts", async () => {
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
    await expect(english).resolves.toBeCloseTo(0.9, 6);
    await expect(chinese).resolves.toBeCloseTo(0.9, 6);

    expect(runtimeFixture.events).toEqual([
      "score:start:en",
      "score:end:en",
      "dispose:en",
      "score:start:zh-Hans",
      "score:end:zh-Hans",
    ]);
  });

  it("disposes inputs and malformed output tensors when validation fails", async () => {
    runtimeFixture.releaseEnglish();
    runtimeFixture.outputs.en = {
      data: new Float32Array([0]),
      dims: [1, 1],
      type: "float32",
    };
    const runtime = new DetectorModelRuntime("/tmp/djl-ai-detector-models");

    await expect(
      runtime.score("en", "English passage", new AbortController().signal),
    ).rejects.toThrow(/invalid classification logits/i);
    expect(runtimeFixture.outputDisposals).toEqual(["en"]);
    expect(runtimeFixture.inputDisposals).toEqual(["en:input_ids", "en:attention_mask"]);
  });

  it("attempts every tensor disposal and preserves the primary inference error", async () => {
    runtimeFixture.releaseEnglish();
    runtimeFixture.outputs.en = {
      data: new Float32Array([0]),
      dims: [1, 1],
      type: "float32",
    };
    runtimeFixture.setDisposalError("en:logits", new Error("logits disposal failed"));
    const runtime = new DetectorModelRuntime("/tmp/djl-ai-detector-models");

    await expect(
      runtime.score("en", "English passage", new AbortController().signal),
    ).rejects.toThrow(/invalid classification logits/i);
    expect(runtimeFixture.outputDisposals).toEqual(["en"]);
    expect(runtimeFixture.inputDisposals).toEqual(["en:input_ids", "en:attention_mask"]);
  });

  it("reports a disposal failure after otherwise successful inference", async () => {
    runtimeFixture.releaseEnglish();
    runtimeFixture.setDisposalError("en:logits", new Error("logits disposal failed"));
    const runtime = new DetectorModelRuntime("/tmp/djl-ai-detector-models");

    await expect(
      runtime.score("en", "English passage", new AbortController().signal),
    ).rejects.toThrow("logits disposal failed");
    expect(runtimeFixture.outputDisposals).toEqual(["en"]);
    expect(runtimeFixture.inputDisposals).toEqual(["en:input_ids", "en:attention_mask"]);
  });

  it("disposes inputs when inference rejects", async () => {
    runtimeFixture.releaseEnglish();
    runtimeFixture.setModelError(new Error("inference failed"));
    const runtime = new DetectorModelRuntime("/tmp/djl-ai-detector-models");

    await expect(
      runtime.score("en", "English passage", new AbortController().signal),
    ).rejects.toThrow("inference failed");
    expect(runtimeFixture.outputDisposals).toEqual([]);
    expect(runtimeFixture.inputDisposals).toEqual(["en:input_ids", "en:attention_mask"]);
  });

  it("disposes inputs and output when aborted after inference", async () => {
    runtimeFixture.releaseEnglish();
    const controller = new AbortController();
    runtimeFixture.setAfterModel(() => controller.abort());
    const runtime = new DetectorModelRuntime("/tmp/djl-ai-detector-models");

    await expect(runtime.score("en", "English passage", controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(runtimeFixture.outputDisposals).toEqual(["en"]);
    expect(runtimeFixture.inputDisposals).toEqual(["en:input_ids", "en:attention_mask"]);
  });

  it("counts tokens with the installed model tokenizer without truncation", async () => {
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

  it("counts another language without disposing the active inference model", async () => {
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

  it("releases the active model and cached tokenizers on runtime disposal", async () => {
    runtimeFixture.releaseEnglish();
    const runtime = new DetectorModelRuntime("/tmp/djl-ai-detector-models");
    await runtime.score("en", "English passage", new AbortController().signal);

    await runtime.dispose();

    expect(runtimeFixture.events.at(-1)).toBe("dispose:en");
    expect(runtimeFixture.tokenizerDisposals).toEqual(["en"]);
  });
});
