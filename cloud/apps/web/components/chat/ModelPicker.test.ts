import type { CloudModel } from "@synara/contracts/cloud";
import { describe, expect, it } from "vitest";

import { chooseModel } from "./ModelPicker";

const model = (id: string, extra: Partial<CloudModel> = {}): CloudModel => ({
  id,
  provider: "openai",
  displayName: id,
  capabilities: ["text.chat"],
  price: { inputPer1k: "0", outputPer1k: "0", perImage: "0" },
  contextWindow: null,
  maxOutputTokens: null,
  status: "active",
  ...extra,
});

const models = [model("opus"), model("haiku", { freeEligible: true })];

describe("chooseModel", () => {
  it("starts free-plan users on a model their free allowance covers", () => {
    expect(chooseModel(models, null, true)).toBe("haiku");
    expect(chooseModel(models, null, false)).toBe("opus");
  });

  it("keeps a remembered choice, even on the free plan", () => {
    expect(chooseModel(models, "opus", true)).toBe("opus");
  });
});
