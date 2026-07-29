// FILE: modelManifest.ts
// Purpose: Immutable, checksum-verified model manifests for AI Writing Check.

import { createHash } from "node:crypto";

import type { AiDetectorLanguage } from "@synara/contracts";

export type DetectorModelLanguage = Exclude<AiDetectorLanguage, "unsupported">;

export interface DetectorModelFile {
  readonly path: string;
  readonly url: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface DetectorCalibrationBand {
  readonly minimumEligibleCharacters: number;
  readonly maximumEligibleCharacters: number | null;
  readonly humanThreshold: number;
  readonly aiThreshold: number | null;
}

export type DetectorModelOutputContract =
  | {
      readonly probability: "two-logit-softmax";
      readonly aiLabelIndex: 0 | 1;
    }
  | {
      readonly probability: "single-logit-sigmoid";
      readonly aiLabelIndex: 0;
    };

export interface DetectorModelManifest {
  readonly language: DetectorModelLanguage;
  readonly id: string;
  readonly displayName: string;
  readonly revision: string;
  readonly license: "MIT" | "Apache-2.0";
  readonly licenseUrl: string;
  readonly calibrationVersion: string;
  readonly humanThreshold: number;
  readonly aiThreshold: number;
  readonly calibrationBands: readonly DetectorCalibrationBand[];
  readonly output: DetectorModelOutputContract;
  readonly files: readonly DetectorModelFile[];
}

const englishRevision = "b9aa251e5bcda7e429fcc936767d921435945b60";
const chineseRevision = "e6c77fd62955fac134e76deb5396806f6d35fd30";
const chineseConfigRevision = "47695ff451b32c225dd938f4f478f7fdc6aa6bb0";

export const AI_DETECTOR_MODELS: Readonly<Record<DetectorModelLanguage, DetectorModelManifest>> =
  Object.freeze({
    en: {
      language: "en",
      id: "onnx-community/tmr-ai-text-detector-ONNX",
      displayName: "TMR AI Text Detector (English)",
      revision: englishRevision,
      license: "MIT",
      licenseUrl:
        "https://huggingface.co/onnx-community/tmr-ai-text-detector-ONNX/blob/b9aa251e5bcda7e429fcc936767d921435945b60/LICENSE",
      calibrationVersion: "djl-en-conservative-length-bands-v8",
      humanThreshold: 0.35,
      aiThreshold: 0.99,
      calibrationBands: [
        {
          minimumEligibleCharacters: 0,
          maximumEligibleCharacters: 599,
          humanThreshold: 0.35,
          aiThreshold: null,
        },
        {
          minimumEligibleCharacters: 600,
          maximumEligibleCharacters: null,
          humanThreshold: 0.35,
          aiThreshold: 0.99,
        },
      ],
      output: {
        probability: "two-logit-softmax",
        aiLabelIndex: 1,
      },
      files: [
        {
          path: "config.json",
          url: `https://huggingface.co/onnx-community/tmr-ai-text-detector-ONNX/resolve/${englishRevision}/config.json`,
          sizeBytes: 866,
          sha256: "d9d45b537b9cf386a0ce958f8b2f840b0529ed846e45c4e26bc53a62dcb06f1f",
        },
        {
          path: "tokenizer.json",
          url: `https://huggingface.co/onnx-community/tmr-ai-text-detector-ONNX/resolve/${englishRevision}/tokenizer.json`,
          sizeBytes: 3_558_741,
          sha256: "1f33749d010b4d63908e5c174c341622cb45039dd73a139dcd95bd74cc7e304b",
        },
        {
          path: "tokenizer_config.json",
          url: `https://huggingface.co/onnx-community/tmr-ai-text-detector-ONNX/resolve/${englishRevision}/tokenizer_config.json`,
          sizeBytes: 1_354,
          sha256: "288b4077af1ffb3beead6d96fccfc93beb2df9b689cbb038c4eb329165efc43a",
        },
        {
          path: "onnx/model_quantized.onnx",
          url: `https://huggingface.co/onnx-community/tmr-ai-text-detector-ONNX/resolve/${englishRevision}/onnx/model_quantized.onnx`,
          sizeBytes: 125_855_418,
          sha256: "a1ff8a917090467375ceaf47667459e431217d5691df463c57b7194624f3ff79",
        },
      ],
    },
    "zh-Hans": {
      language: "zh-Hans",
      id: "Eslzzyl/aigc-detector-zh-onnx",
      displayName: "AIGC Detector ZH v3 (Simplified Chinese)",
      revision: chineseRevision,
      license: "Apache-2.0",
      licenseUrl:
        "https://huggingface.co/yuchuantian/AIGC_detector_zhv3/blob/47695ff451b32c225dd938f4f478f7fdc6aa6bb0/README.md",
      calibrationVersion: "djl-zh-hans-selective-human-v3",
      humanThreshold: 0.25,
      aiThreshold: 0.8,
      calibrationBands: [
        {
          minimumEligibleCharacters: 0,
          maximumEligibleCharacters: 299,
          humanThreshold: 0.015,
          aiThreshold: 0.8,
        },
        {
          minimumEligibleCharacters: 300,
          maximumEligibleCharacters: 599,
          humanThreshold: 0.015,
          aiThreshold: 0.8,
        },
        {
          minimumEligibleCharacters: 600,
          maximumEligibleCharacters: null,
          humanThreshold: 0.25,
          aiThreshold: 0.8,
        },
      ],
      output: {
        probability: "two-logit-softmax",
        aiLabelIndex: 1,
      },
      files: [
        {
          path: "config.json",
          url: `https://huggingface.co/yuchuantian/AIGC_detector_zhv3/resolve/${chineseConfigRevision}/config.json`,
          sizeBytes: 980,
          sha256: "74dfcf54a25f4847f97e285f60c03d3ceaccba87484c41ab4144e6acc4d7ecf4",
        },
        {
          path: "tokenizer.json",
          url: `https://huggingface.co/Eslzzyl/aigc-detector-zh-onnx/resolve/${chineseRevision}/tokenizer.json`,
          sizeBytes: 439_118,
          sha256: "e3664152464ac6604e88e0b5348cb0819f5e2b75dc0a3f976dd4ab5058441b01",
        },
        {
          path: "tokenizer_config.json",
          url: `https://huggingface.co/Eslzzyl/aigc-detector-zh-onnx/resolve/${chineseRevision}/tokenizer_config.json`,
          sizeBytes: 430,
          sha256: "412cdf8e53b7a890e9c67c3eb93b7eaa93393f96e42ae5d306fbeb37cecfda2b",
        },
        {
          path: "onnx/model_quantized.onnx",
          url: `https://huggingface.co/Eslzzyl/aigc-detector-zh-onnx/resolve/${chineseRevision}/onnx/model_quantized.onnx`,
          sizeBytes: 103_097_593,
          sha256: "57e5ec316f7ce764e94ba4f301cf492f3f22f22ea0cd3b385ebad847a42de40c",
        },
      ],
    },
  });

export const AI_DETECTOR_MODEL_HOSTS = new Set(["huggingface.co", "cdn-lfs.huggingface.co"]);

export function getModelManifest(language: DetectorModelLanguage): DetectorModelManifest {
  return AI_DETECTOR_MODELS[language];
}

export function getCalibrationBand(
  manifest: DetectorModelManifest,
  eligibleCharacters: number,
): DetectorCalibrationBand {
  const characters = Math.max(0, eligibleCharacters);
  return (
    manifest.calibrationBands.find(
      (band) =>
        characters >= band.minimumEligibleCharacters &&
        (band.maximumEligibleCharacters === null || characters <= band.maximumEligibleCharacters),
    ) ?? {
      minimumEligibleCharacters: 0,
      maximumEligibleCharacters: null,
      humanThreshold: manifest.humanThreshold,
      aiThreshold: manifest.aiThreshold,
    }
  );
}

export function modelSizeBytes(manifest: DetectorModelManifest): number {
  return manifest.files.reduce((total, file) => total + file.sizeBytes, 0);
}

export function primaryModelSha256(manifest: DetectorModelManifest): string {
  return manifest.files.find((file) => file.path.endsWith(".onnx"))?.sha256 ?? "";
}

export function modelArtifactFingerprint(manifest: DetectorModelManifest): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        manifest.files.map((file) => ({
          path: file.path,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
        })),
      ),
    )
    .digest("hex");
}
