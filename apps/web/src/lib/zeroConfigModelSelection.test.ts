import type { ProviderKind, ServerProviderStatus } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  selectZeroConfigModel,
  type ZeroConfigLocalModelsState,
  type ZeroConfigModelSelectionInput,
} from "./zeroConfigModelSelection";

function providerStatus(
  provider: ProviderKind,
  overrides: Partial<ServerProviderStatus> = {},
): ServerProviderStatus {
  return {
    provider,
    status: "ready",
    available: true,
    authStatus: "authenticated",
    checkedAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

const RUNNING_LOCAL_MODEL: ZeroConfigLocalModelsState = {
  runtimes: [{ runtime: "ollama", state: "running" }],
  installedModels: [{ runtime: "ollama", modelId: "qwen3-coder:30b" }],
};

function input(
  overrides: Partial<ZeroConfigModelSelectionInput> = {},
): ZeroConfigModelSelectionInput {
  return {
    modelOptionsByProvider: {},
    providerStatuses: [],
    openCodeProviders: [],
    localModels: null,
    ...overrides,
  };
}

describe("selectZeroConfigModel", () => {
  it("preserves a healthy current selection before applying fallback order", () => {
    expect(
      selectZeroConfigModel(
        input({
          currentSelection: { provider: "claudeAgent", modelSlug: "claude-sonnet" },
          providerStatuses: [providerStatus("codex"), providerStatus("claudeAgent")],
          modelOptionsByProvider: {
            codex: [{ slug: "gpt-5", processingLocality: "remote" }],
            claudeAgent: [{ slug: "claude-sonnet", processingLocality: "remote" }],
          },
        }),
      ),
    ).toEqual({
      kind: "selected",
      provider: "claudeAgent",
      modelSlug: "claude-sonnet",
      source: "current",
    });
  });

  it("drops an unhealthy current selection and chooses a connected remote model", () => {
    expect(
      selectZeroConfigModel(
        input({
          currentSelection: { provider: "claudeAgent", modelSlug: "claude-sonnet" },
          providerStatuses: [
            providerStatus("claudeAgent", { available: false, status: "error" }),
            providerStatus("codex"),
          ],
          modelOptionsByProvider: {
            claudeAgent: [{ slug: "claude-sonnet", processingLocality: "remote" }],
            codex: [{ slug: "gpt-5", processingLocality: "remote" }],
          },
        }),
      ),
    ).toEqual({
      kind: "selected",
      provider: "codex",
      modelSlug: "gpt-5",
      source: "remote",
    });
  });

  it("prefers a connected remote model over an installed and running local model", () => {
    expect(
      selectZeroConfigModel(
        input({
          providerStatuses: [providerStatus("claudeAgent"), providerStatus("opencode")],
          localModels: RUNNING_LOCAL_MODEL,
          modelOptionsByProvider: {
            claudeAgent: [{ slug: "claude-sonnet", processingLocality: "remote" }],
            opencode: [
              {
                slug: "ollama/qwen3-coder:30b",
                processingLocality: "local",
                upstreamProviderId: "ollama",
              },
            ],
          },
        }),
      ),
    ).toMatchObject({ provider: "claudeAgent", modelSlug: "claude-sonnet", source: "remote" });
  });

  it("requires the matching OpenCode upstream provider to be connected", () => {
    expect(
      selectZeroConfigModel(
        input({
          providerStatuses: [providerStatus("opencode")],
          openCodeProviders: [
            { id: "openrouter", connected: false },
            { id: "anthropic", connected: true },
          ],
          modelOptionsByProvider: {
            opencode: [
              {
                slug: "openrouter/gpt-5",
                upstreamProviderId: "openrouter",
                processingLocality: "remote",
              },
              {
                slug: "anthropic/claude-sonnet",
                upstreamProviderId: "anthropic",
                processingLocality: "remote",
              },
            ],
          },
        }),
      ),
    ).toMatchObject({
      provider: "opencode",
      modelSlug: "anthropic/claude-sonnet",
      source: "remote",
    });
  });

  it("selects a cataloged local model only when it is installed and running", () => {
    expect(
      selectZeroConfigModel(
        input({
          providerStatuses: [providerStatus("opencode")],
          localModels: RUNNING_LOCAL_MODEL,
          modelOptionsByProvider: {
            opencode: [
              {
                slug: "ollama/qwen3-coder:30b",
                upstreamProviderId: "ollama",
                processingLocality: "local",
              },
            ],
          },
        }),
      ),
    ).toEqual({
      kind: "selected",
      provider: "opencode",
      modelSlug: "ollama/qwen3-coder:30b",
      source: "local",
    });
  });

  it("can select an installed local model while dynamic OpenCode discovery catches up", () => {
    expect(
      selectZeroConfigModel(
        input({
          providerStatuses: [providerStatus("opencode")],
          localModels: RUNNING_LOCAL_MODEL,
        }),
      ),
    ).toMatchObject({
      provider: "opencode",
      modelSlug: "ollama/qwen3-coder:30b",
      source: "local",
    });
  });

  it("does not treat a local catalog entry as available before installation", () => {
    expect(
      selectZeroConfigModel(
        input({
          providerStatuses: [providerStatus("opencode")],
          localModels: {
            runtimes: [{ runtime: "ollama", state: "running" }],
            installedModels: [],
          },
          modelOptionsByProvider: {
            opencode: [
              {
                slug: "ollama/qwen3-coder:30b",
                processingLocality: "local",
              },
            ],
          },
        }),
      ),
    ).toEqual({ kind: "no-model", reason: "local-model-not-installed" });
  });

  it("does not treat an installed model as available while its runtime is stopped", () => {
    expect(
      selectZeroConfigModel(
        input({
          providerStatuses: [providerStatus("opencode")],
          localModels: {
            runtimes: [{ runtime: "ollama", state: "stopped" }],
            installedModels: [{ runtime: "ollama", modelId: "qwen3-coder:30b" }],
          },
        }),
      ),
    ).toEqual({ kind: "no-model", reason: "local-runtime-not-ready" });
  });

  it("treats runtime-prefixed models as local even when metadata incorrectly says remote", () => {
    expect(
      selectZeroConfigModel(
        input({
          providerStatuses: [providerStatus("opencode")],
          openCodeProviders: [{ id: "ollama", connected: true }],
          localModels: {
            runtimes: [{ runtime: "ollama", state: "running" }],
            installedModels: [],
          },
          modelOptionsByProvider: {
            opencode: [{ slug: "ollama/missing:7b", processingLocality: "remote" }],
          },
        }),
      ),
    ).toEqual({ kind: "no-model", reason: "local-model-not-installed" });
  });

  it("uses a fixed provider priority and then preserves catalog order", () => {
    const result = selectZeroConfigModel(
      input({
        providerStatuses: [providerStatus("codex"), providerStatus("claudeAgent")],
        modelOptionsByProvider: {
          claudeAgent: [{ slug: "claude-first", processingLocality: "remote" }],
          codex: [
            { slug: "gpt-catalog-first", processingLocality: "remote" },
            { slug: "gpt-catalog-second", processingLocality: "remote" },
          ],
        },
      }),
    );

    expect(result).toMatchObject({
      provider: "codex",
      modelSlug: "gpt-catalog-first",
      source: "remote",
    });
  });

  it("returns an explicit reason when no catalog or installed model exists", () => {
    expect(selectZeroConfigModel(input())).toEqual({ kind: "no-model", reason: "catalog-empty" });
  });
});
