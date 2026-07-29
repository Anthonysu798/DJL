// FILE: localModels.test.ts
// Purpose: Contract coverage for local runtime discovery, recommendations, and install jobs.

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  LocalModelEvent,
  LocalModelInstallInput,
  LocalInstalledModel,
  LocalModelSetupInput,
  LocalModelSetupJob,
  LocalModelsSnapshot,
} from "./localModels";

const decodeSnapshot = Schema.decodeUnknownEffect(LocalModelsSnapshot);
const decodeInstalledModel = Schema.decodeUnknownEffect(LocalInstalledModel);
const decodeInstall = Schema.decodeUnknownEffect(LocalModelInstallInput);
const decodeEvent = Schema.decodeUnknownEffect(LocalModelEvent);
const decodeSetup = Schema.decodeUnknownEffect(LocalModelSetupInput);
const decodeSetupJob = Schema.decodeUnknownEffect(LocalModelSetupJob);

describe("local model contracts", () => {
  it("decodes LM Studio maximum, loaded, and effective context diagnostics", async () => {
    const model = await Effect.runPromise(
      decodeInstalledModel({
        runtime: "lmstudio",
        modelId: "ibm/granite-4.1-3b",
        name: "Granite 4.1 3B",
        sizeBytes: 2_099_546_710,
        contextWindowTokens: 16_384,
        maxContextWindowTokens: 131_072,
        loadedContextWindowTokens: 8_192,
        toolContextWindowReady: false,
        supportsToolCalls: false,
      }),
    );

    expect(model).toMatchObject({
      contextWindowTokens: 16_384,
      maxContextWindowTokens: 131_072,
      loadedContextWindowTokens: 8_192,
      toolContextWindowReady: false,
    });
  });

  it("decodes a bounded desktop runtime snapshot", async () => {
    const snapshot = await Effect.runPromise(
      decodeSnapshot({
        totalMemoryBytes: 34_359_738_368,
        hardware: {
          totalMemoryBytes: 34_359_738_368,
          cpuModel: "Apple M2 Pro",
          cpuCores: 10,
          acceleration: "apple_unified",
          gpuName: "Apple M2 Pro",
          vramBytes: null,
          usableModelBytes: 14_431_090_114,
        },
        freeDiskBytes: 68_719_476_736,
        recommendedModelId: "qwen3-coder-large",
        runtimes: [
          {
            runtime: "ollama",
            name: "Ollama",
            state: "running",
            version: "0.12.0",
            endpoint: "http://127.0.0.1:11434",
            installerUrl: "https://ollama.com/download",
            installationKind: "external",
            estimatedDownloadBytes: 250_000_000,
            detail: null,
            capabilities: {
              canStart: true,
              canInstallModels: true,
              canCancelInstall: true,
              canDeleteModels: true,
            },
          },
        ],
        recommendations: [
          {
            id: "qwen3-coder-large",
            supportsToolCalls: true,
            name: "Qwen3 Coder 30B",
            description: "Best local coding quality for larger-memory computers.",
            minimumMemoryBytes: 34_359_738_368,
            sources: [
              {
                runtime: "lmstudio",
                modelId: "qwen/qwen3.5-2b",
                estimatedDownloadBytes: 2_040_109_466,
                quantization: "Q4_K_M",
              },
            ],
          },
        ],
        installedModels: [],
        runtimeInstallJobs: [],
        installJobs: [],
        setupJobs: [],
      }),
    );

    expect(snapshot.runtimes[0]?.runtime).toBe("ollama");
    expect(snapshot.recommendedModelId).toBe("qwen3-coder-large");
    expect(snapshot.recommendations[0]?.sources[0]).toMatchObject({
      runtime: "lmstudio",
      modelId: "qwen/qwen3.5-2b",
      quantization: "Q4_K_M",
    });
  });

  it("accepts Ollama tags and approved LM Studio catalog or Hugging Face identifiers", async () => {
    await expect(
      Effect.runPromise(decodeInstall({ runtime: "ollama", modelId: "qwen3-coder:30b" })),
    ).resolves.toMatchObject({ runtime: "ollama" });
    await expect(
      Effect.runPromise(decodeInstall({ runtime: "lmstudio", modelId: "openai/gpt-oss-20b" })),
    ).resolves.toMatchObject({ runtime: "lmstudio" });
    await expect(
      Effect.runPromise(
        decodeInstall({
          runtime: "lmstudio",
          modelId: "https://huggingface.co/lmstudio-community/gpt-oss-20b-GGUF",
          quantization: "Q4_K_M",
        }),
      ),
    ).resolves.toMatchObject({ runtime: "lmstudio" });
  });

  it("rejects arbitrary remote URLs as LM Studio model sources", async () => {
    await expect(
      Effect.runPromise(
        decodeInstall({ runtime: "lmstudio", modelId: "https://example.com/model.gguf" }),
      ),
    ).rejects.toBeDefined();
  });

  it("decodes reconnect-safe snapshot progress events", async () => {
    const event = await Effect.runPromise(
      decodeEvent({
        type: "snapshot.updated",
        snapshot: {
          totalMemoryBytes: 17_179_869_184,
          hardware: {
            totalMemoryBytes: 17_179_869_184,
            cpuModel: "Apple M2 Pro",
            cpuCores: 10,
            acceleration: "apple_unified",
            gpuName: "Apple M2 Pro",
            vramBytes: null,
            usableModelBytes: 14_431_090_114,
          },
          freeDiskBytes: null,
          recommendedModelId: "gpt-oss-balanced",
          runtimes: [],
          recommendations: [],
          installedModels: [],
          runtimeInstallJobs: [
            {
              runtime: "ollama",
              state: "downloading",
              downloadedBytes: 512,
              totalBytes: 1_024,
              message: "Downloading Ollama…",
              startedAt: "2026-07-14T11:59:00.000Z",
              finishedAt: null,
            },
          ],
          installJobs: [
            {
              id: "job-1",
              runtime: "ollama",
              modelId: "gpt-oss:20b",
              state: "downloading",
              downloadedBytes: 1_024,
              totalBytes: 2_048,
              bytesPerSecond: 512,
              message: "pulling manifest",
              startedAt: "2026-07-14T12:00:00.000Z",
              finishedAt: null,
            },
          ],
          setupJobs: [
            {
              id: "setup-1",
              runtime: "ollama",
              recommendationId: "gpt-oss-balanced",
              modelId: "gpt-oss:20b",
              state: "downloading_model",
              downloadedBytes: 1_024,
              totalBytes: 2_048,
              message: "Downloading the local model…",
              startedAt: "2026-07-14T12:00:00.000Z",
              finishedAt: null,
            },
          ],
        },
      }),
    );

    expect(event.snapshot.installJobs[0]?.downloadedBytes).toBe(1_024);
    expect(event.snapshot.runtimeInstallJobs[0]?.runtime).toBe("ollama");
    expect(event.snapshot.setupJobs[0]?.state).toBe("downloading_model");
  });

  it("accepts one-click setup for either runtime and a curated recommendation", async () => {
    await expect(Effect.runPromise(decodeSetup({ runtime: "ollama" }))).resolves.toEqual({
      runtime: "ollama",
    });
    await expect(
      Effect.runPromise(decodeSetup({ runtime: "lmstudio", recommendationId: "granite-4.1-3b" })),
    ).resolves.toEqual({ runtime: "lmstudio", recommendationId: "granite-4.1-3b" });
  });

  it("decodes a failed setup job that can be retried after reconnect", async () => {
    const job = await Effect.runPromise(
      decodeSetupJob({
        id: "setup-2",
        runtime: "lmstudio",
        recommendationId: "granite-4.1-3b",
        modelId: "ibm/granite-4.1-3b",
        state: "failed",
        downloadedBytes: 0,
        totalBytes: 2_400_000_000,
        message: "The download was interrupted.",
        startedAt: "2026-07-14T12:00:00.000Z",
        finishedAt: "2026-07-14T12:01:00.000Z",
      }),
    );

    expect(job.runtime).toBe("lmstudio");
    expect(job.state).toBe("failed");
  });
});
