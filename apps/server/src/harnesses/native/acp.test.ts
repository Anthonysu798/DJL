import { describe, expect, it } from "vitest";
import { acpPluginServers, readAcpModels } from "./acp";

describe("ACP plugin servers", () => {
  const plugins = {
    bearerToken: "session-token",
    servers: [{ name: "djl_linear", url: "http://127.0.0.1:5000/mcp/linear" }],
  };
  it("offers plugins over HTTP to an agent that supports it", () => {
    expect(
      acpPluginServers({ agentCapabilities: { mcpCapabilities: { http: true } } }, plugins),
    ).toEqual([
      {
        type: "http",
        name: "djl_linear",
        url: "http://127.0.0.1:5000/mcp/linear",
        headers: [{ name: "Authorization", value: "Bearer session-token" }],
      },
    ]);
  });
  it("offers nothing to an agent without HTTP tool servers, or when no plugin is connected", () => {
    expect(acpPluginServers({ agentCapabilities: {} }, plugins)).toEqual([]);
    expect(acpPluginServers({}, plugins)).toEqual([]);
    expect(
      acpPluginServers({ agentCapabilities: { mcpCapabilities: { http: true } } }, undefined),
    ).toEqual([]);
  });
});

describe("ACP model discovery", () => {
  it("reads grouped model configuration choices without confusing thinking controls for models", () => {
    expect(
      readAcpModels({
        configOptions: [
          { id: "thinking", category: "thought_level", options: [{ value: "high", name: "High" }] },
          {
            id: "model",
            category: "model",
            options: [
              {
                group: "kimi-code",
                name: "Kimi Code",
                options: [{ value: "kimi-code/k3", name: "Kimi K3" }],
              },
            ],
          },
        ],
      }),
    ).toEqual([{ slug: "kimi-code/k3", name: "Kimi K3" }]);
  });
  it("retains support for the legacy ACP model catalog", () => {
    expect(
      readAcpModels({ models: { availableModels: [{ modelId: "grok-test", name: "Grok" }] } }),
    ).toEqual([{ slug: "grok-test", name: "Grok" }]);
  });
  it("reads the iFlow catalog published under session _meta", () => {
    expect(
      readAcpModels({
        _meta: {
          models: {
            currentModelId: "glm-4.7",
            availableModels: [{ id: "glm-4.7", name: "GLM-4.7" }],
          },
        },
      }),
    ).toEqual([{ slug: "glm-4.7", name: "GLM-4.7" }]);
  });
  it("does not invent models when the runtime advertises no model controls", () => {
    expect(() => readAcpModels({})).toThrow("did not advertise models");
  });
});
