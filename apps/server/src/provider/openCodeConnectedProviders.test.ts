import { describe, expect, it } from "vitest";
import type { Provider } from "@opencode-ai/sdk/v2";
import { flattenOpenCodeProviderConnections } from "./Layers/OpenCodeAdapter";

describe("installed OpenCode connected providers", () => {
  it("keeps disconnected OAuth providers available for subscription sign-in", () => {
    const providers = [
      { id: "github-copilot", name: "GitHub Copilot", env: [], models: {} },
    ] as unknown as Provider[];
    expect(
      flattenOpenCodeProviderConnections({
        providers,
        connectedProviderIds: [],
        authMethods: { "github-copilot": [{ type: "oauth", label: "Sign in" }] },
      }),
    ).toEqual([
      {
        id: "github-copilot",
        name: "GitHub Copilot",
        connected: false,
        supportsApiKey: false,
        supportsOAuth: true,
        modelCount: 0,
      },
    ]);
  });
  it("keeps OAuth and configured custom providers discoverable without inventing API-key support", () => {
    const providers = ["github-copilot", "custom-cli-provider", "disconnected-oauth"].map((id) => ({
      id,
      name: id,
      env: [],
      models: { test: { id: "test" } },
    })) as unknown as Provider[];
    expect(
      flattenOpenCodeProviderConnections({
        providers,
        connectedProviderIds: ["github-copilot", "custom-cli-provider"],
        authMethods: { "github-copilot": [{ type: "oauth", label: "Sign in" }] },
      }),
    ).toEqual([
      {
        id: "custom-cli-provider",
        name: "custom-cli-provider",
        connected: true,
        supportsApiKey: false,
        modelCount: 1,
      },
      {
        id: "github-copilot",
        name: "github-copilot",
        connected: true,
        supportsApiKey: false,
        supportsOAuth: true,
        modelCount: 1,
      },
    ]);
  });
});
