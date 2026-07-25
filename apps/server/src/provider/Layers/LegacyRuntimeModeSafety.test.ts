import { describe, expect, it } from "vitest";

import * as CursorAdapterModule from "./CursorAdapter";
import * as GeminiAdapterModule from "./GeminiAdapter";
import * as GrokAdapterModule from "./GrokAdapter";

const modeState = {
  currentModeId: "implement",
  availableModes: [
    { id: "ask", name: "Ask", description: "Ask before acting" },
    { id: "implement", name: "Implement", description: "Act without asking" },
  ],
};

describe("legacy provider runtime-mode safety", () => {
  it.each([
    [CursorAdapterModule, "resolveCursorRequestedModeId"],
    [GrokAdapterModule, "resolveGrokRequestedModeId"],
  ] as const)("maps accept-edits to the approval mode", (adapterModule, exportName) => {
    const resolver = (adapterModule as Record<string, unknown>)[exportName];
    expect(resolver).toBeTypeOf("function");
    if (typeof resolver !== "function") return;

    expect(
      resolver({
        interactionMode: "default",
        runtimeMode: "accept-edits",
        modeState,
      }),
    ).toBe("ask");
  });

  it("maps accept-edits to Gemini's approval-required mode", () => {
    const resolver = (GeminiAdapterModule as Record<string, unknown>)["runtimeModeToGeminiModeId"];
    expect(resolver).toBeTypeOf("function");
    if (typeof resolver !== "function") return;

    expect(resolver("accept-edits")).toBe("default");
  });

  it.each([
    [CursorAdapterModule, "resolveCursorRequestedModeId"],
    [GrokAdapterModule, "resolveGrokRequestedModeId"],
  ] as const)("maps auto-approval to the approval mode", (adapterModule, exportName) => {
    const resolver = (adapterModule as Record<string, unknown>)[exportName];
    expect(resolver).toBeTypeOf("function");
    if (typeof resolver !== "function") return;

    expect(resolver({ interactionMode: "default", runtimeMode: "auto-approval", modeState })).toBe(
      "ask",
    );
  });

  it("maps auto-approval to Gemini's approval-required mode", () => {
    const resolver = (GeminiAdapterModule as Record<string, unknown>)["runtimeModeToGeminiModeId"];
    expect(resolver).toBeTypeOf("function");
    if (typeof resolver !== "function") return;

    expect(resolver("auto-approval")).toBe("default");
  });
});
