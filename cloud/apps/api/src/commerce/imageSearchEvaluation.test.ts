import { describe, expect, it, vi } from "vitest";
import {
  evaluateCommerceImageSearch,
  type CommerceImageEvaluationCase,
} from "./imageSearchEvaluation.ts";

// Synthetic fixtures test evaluator arithmetic only, never product search accuracy.
const cases: CommerceImageEvaluationCase[] = [
  ...Array.from({ length: 100 }, (_, index) => ({
    caseId: `in-${index}`,
    fileId: `in-${index}`,
    kind: "in_catalog" as const,
    expectedProductIds: [`product-${index}`],
  })),
  ...Array.from({ length: 50 }, (_, index) => ({
    caseId: `out-${index}`,
    fileId: `out-${index}`,
    kind: "out_of_catalog" as const,
    expectedProductIds: [],
  })),
];

async function thresholdSearch(id: string) {
  const index = Number(id.split("-")[1]);
  return {
    products: id.startsWith("in")
      ? index < 85
        ? [{ id: "distractor" }, { id: `product-${index}` }]
        : []
      : index < 45
        ? []
        : [{ id: "distractor" }],
  };
}

describe("commerce image evaluation gate", () => {
  it("requires the full human-labelled cohort before calling search", async () => {
    const search = vi.fn();
    await expect(evaluateCommerceImageSearch(cases.slice(1), search)).rejects.toThrow(
      "100 in-catalog",
    );
    await expect(evaluateCommerceImageSearch(cases.slice(0, 149), search)).rejects.toThrow(
      "50 out-of-catalog",
    );
    expect(search).not.toHaveBeenCalled();
  });

  it("rejects repeated images, repeated labels and contradictory ground truth", async () => {
    for (const patch of [
      { fileId: cases[1]!.fileId },
      { caseId: cases[1]!.caseId },
      { expectedProductIds: [] },
      { expectedProductIds: ["x", "x"] },
    ])
      await expect(
        evaluateCommerceImageSearch([{ ...cases[0]!, ...patch }, ...cases.slice(1)], vi.fn()),
      ).rejects.toThrow();
    await expect(
      evaluateCommerceImageSearch(
        [...cases.slice(0, 149), { ...cases[149]!, expectedProductIds: ["x"] }],
        vi.fn(),
      ),
    ).rejects.toThrow();
  });

  it("computes the exact 85% and 90% thresholds from returned top-five IDs", async () => {
    const report = await evaluateCommerceImageSearch(cases, thresholdSearch);
    expect(report).toMatchObject({
      top5Hits: 85,
      correctNoResults: 45,
      top5HitRate: 0.85,
      noResultAccuracy: 0.9,
      failedRequests: 0,
      passed: true,
    });
    const below = await evaluateCommerceImageSearch(cases, async (id) =>
      id === "in-84" ? { products: [] } : thresholdSearch(id),
    );
    expect(below.passed).toBe(false);
  });

  it("never counts errors or malformed results as correct empty results", async () => {
    const report = await evaluateCommerceImageSearch(cases, async (id) => {
      if (id === "out-0") throw new Error("provider unavailable");
      if (id === "out-1")
        return { products: Array.from({ length: 6 }, (_, index) => ({ id: `x-${index}` })) };
      return { products: id.startsWith("in") ? [{ id: `product-${id.split("-")[1]}` }] : [] };
    });
    expect(report).toMatchObject({
      top5Hits: 100,
      correctNoResults: 48,
      failedRequests: 2,
      passed: false,
    });
    expect(report.results.find((entry) => entry.caseId === "out-0")).toMatchObject({
      correct: false,
      requestFailed: true,
    });
  });
});
