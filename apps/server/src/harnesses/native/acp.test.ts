import { describe, expect, it } from "vitest";
import { readAcpModels } from "./acp";

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
