// FILE: modelRuntime.ts
// Purpose: Lazy, local-only Transformers.js inference adapter.

import path from "node:path";

import type { DetectorModelLanguage } from "./modelManifest";
import { verifyInstalledModel } from "./modelInstaller";

type ClassifierResult = { readonly label: string; readonly score: number };
type Classifier = ((
  text: string,
  options: Record<string, unknown>,
) => Promise<ClassifierResult | ClassifierResult[]>) & {
  readonly tokenizer?: { readonly encode?: (text: string) => readonly number[] };
  dispose?: () => Promise<void> | void;
};
type Tokenizer = {
  readonly encode: (text: string) => readonly number[];
  dispose?: () => Promise<void> | void;
};

export class DetectorModelIntegrityError extends Error {
  constructor(readonly language: DetectorModelLanguage) {
    super("The local detector model failed its integrity check.");
    this.name = "DetectorModelIntegrityError";
  }
}

export class DetectorModelRuntime {
  private classifier: Classifier | null = null;
  private language: DetectorModelLanguage | null = null;
  private loading: Promise<Classifier> | null = null;
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

  private async load(language: DetectorModelLanguage): Promise<Classifier> {
    if (this.classifier && this.language === language) return this.classifier;
    if (this.loading && this.language === language) return this.loading;
    await this.disposeCurrent();
    await this.verify(language);
    this.language = language;
    this.loading = (async () => {
      const transformers = await this.loadTransformers();
      const loaded = (await transformers.pipeline("text-classification", language, {
        device: "cpu",
        dtype: "q8",
      })) as unknown as Classifier;
      this.classifier = loaded;
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
    if (typeof tokenizer.encode !== "function") {
      throw new Error("The installed detector tokenizer is incompatible with this runtime.");
    }
    this.tokenizers.set(language, tokenizer);
    return tokenizer;
  }

  score(language: DetectorModelLanguage, text: string, signal: AbortSignal): Promise<number> {
    return this.serialize(async () => {
      signal.throwIfAborted();
      const classifier = await this.load(language);
      signal.throwIfAborted();
      const raw = await classifier(text, { top_k: null, truncation: true, max_length: 512 });
      signal.throwIfAborted();
      const results = Array.isArray(raw) ? raw : [raw];
      const ai = results.find((result) =>
        language === "en"
          ? result.label.toLowerCase() === "ai" || result.label === "LABEL_1"
          : result.label === "LABEL_1" || result.label.toLowerCase().includes("ai_generated"),
      );
      if (!ai || !Number.isFinite(ai.score) || ai.score < 0 || ai.score > 1) {
        throw new Error("The local detector returned an invalid classification score.");
      }
      return ai.score;
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
    const classifier = this.classifier;
    this.classifier = null;
    this.language = null;
    this.loading = null;
    await classifier?.dispose?.();
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
