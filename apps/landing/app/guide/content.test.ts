import { describe, expect, it } from "vitest";
import { content, formatGb, localModelCatalog } from "../content";

// The guide's whole purpose is steering readers away from a model that cannot drive the agent, so
// the chat-only facts are asserted rather than trusted to survive a future copy edit.
describe("local model catalog", () => {
  it("keeps Qwen3 1.7B and Qwen3.5 2B marked as unable to drive the agent", () => {
    const chatOnly = localModelCatalog.filter(({ agent }) => !agent).map(({ id }) => id);

    expect(chatOnly).toEqual(["qwen3-1.7b", "qwen3.5-2b"]);
  });

  it("names both chat-only models in the warning, in both languages", () => {
    for (const locale of ["en", "zh"] as const) {
      const { body } = content[locale].guide.local.warning;
      expect(body).toContain("Qwen3 1.7B");
      expect(body).toContain("Qwen3.5 2B");
    }
  });

  it("offers an agent-capable model at every memory tier above the chat-only floor", () => {
    // A reader on an 8 GB machine must have a real option, not just chat-only ones.
    const eightGbAgentModels = localModelCatalog.filter(
      ({ agent, minMemoryGb }) => agent && minMemoryGb <= 8,
    );

    expect(eightGbAgentModels.map(({ id }) => id)).toEqual(["granite-4.1-3b"]);
  });

  it("stays ordered by ascending weight, which is what makes the table scannable", () => {
    const weights = localModelCatalog.map(({ downloadGb }) => downloadGb);

    expect(weights).toEqual([...weights].sort((a, b) => a - b));
  });
});

describe("formatGb", () => {
  it("prints fractional weights without inventing precision", () => {
    expect(formatGb(1.4)).toBe("1.4 GB");
    expect(formatGb(4.36)).toBe("4.36 GB");
  });

  it("does not pad whole numbers with decimals", () => {
    expect(formatGb(13)).toBe("13 GB");
    expect(formatGb(19)).toBe("19 GB");
  });
});

// A half-translated guide is the realistic failure: someone adds an English step and the Chinese
// reader silently gets a shorter list.
describe("guide translation parity", () => {
  const keysOf = (value: unknown): string =>
    JSON.stringify(value, (_key, node) =>
      node && typeof node === "object" && !Array.isArray(node)
        ? Object.fromEntries(
            Object.keys(node)
              .sort()
              .map((key) => [key, (node as Record<string, unknown>)[key]]),
          )
        : Array.isArray(node)
          ? node.map(() => 0)
          : 0,
    );

  it("gives en and zh the same guide shape", () => {
    expect(keysOf(content.zh.guide)).toBe(keysOf(content.en.guide));
  });

  it("gives en and zh the same home get-started shape", () => {
    expect(keysOf(content.zh.start)).toBe(keysOf(content.en.start));
  });

  it("translates every guide string rather than leaving English in the zh copy", () => {
    const { steps } = content.zh.guide.local;
    for (const step of steps) {
      expect(step.k).not.toBe("");
      expect(step.v).not.toBe("");
    }
    expect(content.zh.guide.title).not.toBe(content.en.guide.title);
    expect(content.zh.guide.local.title).not.toBe(content.en.guide.local.title);
  });
});
