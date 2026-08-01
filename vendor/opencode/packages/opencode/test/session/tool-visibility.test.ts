import { describe, expect, test } from "bun:test";

import { filterVisibleTools, requiredWorkToolChoice } from "@/session/tools";

describe("per-turn tool visibility", () => {
  const tools = {
    read: { description: "read" },
    websearch: { description: "search" },
    "djl-work_djl_system_info": { description: "system" },
  };

  test("an empty allowlist exposes no built-in or MCP schemas", () => {
    expect(Object.keys(filterVisibleTools(tools, []))).toEqual([]);
  });

  test("allows exact built-ins and aliases a unique MCP suffix to its stable name", () => {
    expect(Object.keys(filterVisibleTools(tools, ["websearch", "djl_system_info"]))).toEqual([
      "websearch",
      "djl_system_info",
    ]);
  });

  test("fails closed when more than one MCP tool matches the requested stable name", () => {
    expect(
      Object.keys(
        filterVisibleTools(
          {
            first_djl_system_info: {},
            second_djl_system_info: {},
          },
          ["djl_system_info"],
        ),
      ),
    ).toEqual([]);
  });

  test("an omitted policy preserves existing behavior", () => {
    expect(filterVisibleTools(tools, undefined)).toBe(tools);
  });

  test.each(["deepseek", "openai", "anthropic", "custom-api-provider"])(
    "uses portable automatic tool choice for remote API provider %s",
    (providerID) => {
      expect(
        requiredWorkToolChoice({
          tools: { websearch: {}, webfetch: {} },
          required: true,
          step: 1,
          providerID,
        }),
      ).toBe("auto");
    },
  );

  test.each(["ollama", "lmstudio"])(
    "keeps required tool choice for local provider %s",
    (providerID) => {
      expect(
        requiredWorkToolChoice({
          tools: { djl_work_123_djl_system_info: {} },
          required: true,
          step: 1,
          providerID,
        }),
      ).toBe("required");
    },
  );

  test("does not force another tool after the first model step", () => {
    expect(
      requiredWorkToolChoice({
        tools: { djl_work_123_djl_system_info: {} },
        required: true,
        step: 2,
        providerID: "openai",
      }),
    ).toBeUndefined();
  });

  test("does not select a tool when the grounded policy does not require one", () => {
    expect(
      requiredWorkToolChoice({
        tools: { websearch: {} },
        required: false,
        step: 1,
        providerID: "openai",
      }),
    ).toBeUndefined();
  });

  test("does not require a tool when filtering resolved an empty bundle", () => {
    expect(
      requiredWorkToolChoice({
        tools: {},
        required: true,
        step: 1,
        providerID: "openai",
      }),
    ).toBeUndefined();
  });
});
