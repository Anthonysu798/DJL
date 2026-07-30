// FILE: modelRuntime.ts
// Purpose: Lazy, local-only Transformers.js inference adapter.

import path from "node:path";

import {
  getModelManifest,
  type DetectorModelLanguage,
  type DetectorModelOutputContract,
} from "./modelManifest";
import { verifyInstalledModel } from "./modelInstaller";

export interface DetectorLogits {
  readonly dims: readonly number[];
  readonly data: ArrayLike<number | bigint>;
  readonly size: number;
  readonly type: string;
  dispose: () => void;
}

type ModelInputs = Readonly<Record<string, DetectorLogits>>;
type SequenceClassifier = ((
  inputs: ModelInputs,
) => Promise<{ readonly logits?: DetectorLogits }>) & {
  dispose?: () => Promise<unknown> | unknown;
};
type Tokenizer = ((
  text: string,
  options: {
    readonly padding: true;
    readonly truncation: true;
    readonly max_length: 512;
  },
) => ModelInputs) & {
  readonly encode: (text: string) => readonly number[];
  dispose?: () => Promise<void> | void;
};

const invalidLogitsMessage = "The local detector returned invalid classification logits.";

function validateLogitsData(logits: DetectorLogits, expectedLogits: number): readonly number[] {
  const validData =
    (logits.type === "float32" && logits.data instanceof Float32Array) ||
    (logits.type === "float64" && logits.data instanceof Float64Array);
  if (
    logits.dims.length !== 2 ||
    logits.dims[0] !== 1 ||
    logits.dims[1] !== expectedLogits ||
    logits.size !== expectedLogits ||
    logits.data.length !== expectedLogits ||
    !validData
  ) {
    throw new Error(invalidLogitsMessage);
  }

  const values = Array.from(logits.data);
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(invalidLogitsMessage);
  }
  return values as number[];
}

export function detectorProbabilityFromLogits(
  logits: DetectorLogits | undefined,
  output: DetectorModelOutputContract,
): number {
  if (!logits) throw new Error(invalidLogitsMessage);
  const expectedLogits = output.probability === "two-logit-softmax" ? 2 : 1;
  const values = validateLogitsData(logits, expectedLogits);

  let probability: number;
  if (output.probability === "two-logit-softmax") {
    const maximum = Math.max(...values);
    const exponentials = values.map((value) => Math.exp(value - maximum));
    const denominator = exponentials.reduce((total, value) => total + value, 0);
    probability = exponentials[output.aiLabelIndex]! / denominator;
  } else {
    const value = values[0]!;
    if (value >= 0) {
      probability = 1 / (1 + Math.exp(-value));
    } else {
      const exponential = Math.exp(value);
      probability = exponential / (1 + exponential);
    }
  }

  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error(invalidLogitsMessage);
  }
  return probability;
}

function disposeTensors(tensors: Iterable<DetectorLogits | undefined>): void {
  const unique = new Set(tensors);
  let firstError: unknown;
  let disposalFailed = false;
  for (const tensor of unique) {
    try {
      tensor?.dispose();
    } catch (error) {
      if (!disposalFailed) firstError = error;
      disposalFailed = true;
    }
  }
  if (disposalFailed) throw firstError;
}

export class DetectorModelIntegrityError extends Error {
  constructor(readonly language: DetectorModelLanguage) {
    super("The local detector model failed its integrity check.");
    this.name = "DetectorModelIntegrityError";
  }
}

export class DetectorModelRuntime {
  private model: SequenceClassifier | null = null;
  private language: DetectorModelLanguage | null = null;
  private loading: Promise<SequenceClassifier> | null = null;
  private operation = Promise.resolve();
  private readonly verifiedLanguages = new Set<DetectorModelLanguage>();
  private readonly tokenizers = new Map<DetectorModelLanguage, Tokenizer>();

  constructor(private readonly modelRoot: string) {}

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.operation.then(operation, operation);
    this.operation = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }

  private async verify(language: DetectorModelLanguage): Promise<void> {
    if (this.verifiedLanguages.has(language)) return;
    if (!(await verifyInstalledModel(this.modelRoot, language))) {
      throw new DetectorModelIntegrityError(language);
    }
    this.verifiedLanguages.add(language);
  }

  private async loadTransformers() {
    const transformers = await import("@huggingface/transformers");
    transformers.env.allowRemoteModels = false;
    transformers.env.allowLocalModels = true;
    transformers.env.localModelPath = this.modelRoot;
    transformers.env.cacheDir = path.join(this.modelRoot, ".runtime-cache");
    return transformers;
  }

  private async load(language: DetectorModelLanguage): Promise<SequenceClassifier> {
    if (this.model && this.language === language) return this.model;
    if (this.loading && this.language === language) return this.loading;
    await this.disposeCurrent();
    await this.verify(language);
    this.language = language;
    this.loading = (async () => {
      const transformers = await this.loadTransformers();
      const loaded = (await transformers.AutoModelForSequenceClassification.from_pretrained(
        language,
        {
          local_files_only: true,
          device: "cpu",
          dtype: "q8",
        },
      )) as unknown as SequenceClassifier;
      if (typeof loaded !== "function") {
        throw new Error("The installed detector model is incompatible with this runtime.");
      }
      this.model = loaded;
      return loaded;
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async loadTokenizer(language: DetectorModelLanguage): Promise<Tokenizer> {
    const existing = this.tokenizers.get(language);
    if (existing) return existing;
    await this.verify(language);
    const transformers = await this.loadTransformers();
    const tokenizer = (await transformers.AutoTokenizer.from_pretrained(language, {
      local_files_only: true,
    })) as unknown as Tokenizer;
    if (typeof tokenizer !== "function" || typeof tokenizer.encode !== "function") {
      throw new Error("The installed detector tokenizer is incompatible with this runtime.");
    }
    this.tokenizers.set(language, tokenizer);
    return tokenizer;
  }

  score(language: DetectorModelLanguage, text: string, signal: AbortSignal): Promise<number> {
    return this.serialize(async () => {
      signal.throwIfAborted();
      const model = await this.load(language);
      signal.throwIfAborted();
      const tokenizer = await this.loadTokenizer(language);
      signal.throwIfAborted();
      let inputs: ModelInputs | null = null;
      let logits: DetectorLogits | undefined;
      let probability: number | undefined;
      let operationFailed = false;
      let operationError: unknown;
      try {
        inputs = tokenizer(text, { padding: true, truncation: true, max_length: 512 });
        signal.throwIfAborted();
        const output = await model(inputs);
        logits = output.logits;
        signal.throwIfAborted();
        probability = detectorProbabilityFromLogits(logits, getModelManifest(language).output);
      } catch (error) {
        operationFailed = true;
        operationError = error;
      }

      let disposalFailed = false;
      let disposalError: unknown;
      try {
        disposeTensors([logits, ...Object.values(inputs ?? {})]);
      } catch (error) {
        disposalFailed = true;
        disposalError = error;
      }
      if (operationFailed) throw operationError;
      if (disposalFailed) throw disposalError;
      return probability!;
    });
  }

  countTokens(language: DetectorModelLanguage, text: string, signal: AbortSignal): Promise<number> {
    return this.serialize(async () => {
      signal.throwIfAborted();
      const tokenizer = await this.loadTokenizer(language);
      signal.throwIfAborted();
      const tokenIds = tokenizer.encode(text);
      if (!tokenIds || !Number.isSafeInteger(tokenIds.length) || tokenIds.length <= 0) {
        throw new Error("The local detector tokenizer returned an invalid token count.");
      }
      return tokenIds.length;
    });
  }

  private async disposeCurrent(): Promise<void> {
    const model = this.model;
    this.model = null;
    this.language = null;
    this.loading = null;
    await model?.dispose?.();
  }

  dispose(): Promise<void> {
    return this.serialize(async () => {
      await this.disposeCurrent();
      await Promise.all([...this.tokenizers.values()].map((tokenizer) => tokenizer.dispose?.()));
      this.tokenizers.clear();
      this.verifiedLanguages.clear();
    });
  }
}
