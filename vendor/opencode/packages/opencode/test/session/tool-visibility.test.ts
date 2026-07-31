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
            "first_djl_system_info": {},
            "second_djl_system_info": {},
          },
          ["djl_system_info"],
        ),
      ),
    ).toEqual([]);
  });

  test("an omitted policy preserves existing behavior", () => {
    expect(filterVisibleTools(tools, undefined)).toBe(tools);
  });

  test("uses the portable required choice when a grounded turn exposes only one tool", () => {
    expect(
      requiredWorkToolChoice({
        tools: { djl_work_123_djl_system_info: {} },
        required: true,
        step: 1,
      }),
    ).toBe("required");
  });

  test("falls back to any required tool for multi-tool grounded turns", () => {
    expect(
      requiredWorkToolChoice({
        tools: { websearch: {}, webfetch: {} },
        required: true,
        step: 1,
      }),
    ).toBe("required");
  });

  test("does not force another tool after the first model step", () => {
    expect(
      requiredWorkToolChoice({
        tools: { djl_work_123_djl_system_info: {} },
        required: true,
        step: 2,
      }),
    ).toBeUndefined();
  });

  test("does not require a tool when filtering resolved an empty bundle", () => {
    expect(
      requiredWorkToolChoice({
        tools: {},
        required: true,
        step: 1,
      }),
    ).toBeUndefined();
  });
});
