/** Offline evaluation orchestration: supply real, consented uploaded images and the real search service.
 * This module never generates ground truth or substitutes example products for a search result.
 */
export interface CommerceImageEvaluationCase {
  readonly caseId: string;
  readonly fileId: string;
  readonly kind: "in_catalog" | "out_of_catalog";
  /** Human-labelled acceptable real product IDs; empty for out-of-catalog images. */
  readonly expectedProductIds: readonly string[];
}

export interface CommerceImageEvaluationReport {
  readonly inCatalogImages: number;
  readonly outOfCatalogImages: number;
  readonly top5Hits: number;
  readonly correctNoResults: number;
  readonly top5HitRate: number;
  readonly noResultAccuracy: number;
  readonly failedRequests: number;
  readonly passed: boolean;
  readonly results: readonly {
    readonly caseId: string;
    readonly returnedProductIds: readonly string[];
    readonly correct: boolean;
    readonly requestFailed: boolean;
  }[];
}

export async function evaluateCommerceImageSearch(
  cases: readonly CommerceImageEvaluationCase[],
  search: (fileId: string) => Promise<{ readonly products: readonly { readonly id: string }[] }>,
): Promise<CommerceImageEvaluationReport> {
  const caseIds = new Set<string>();
  const fileIds = new Set<string>();
  for (const entry of cases) {
    if (
      !entry.caseId.trim() ||
      !entry.fileId.trim() ||
      caseIds.has(entry.caseId) ||
      fileIds.has(entry.fileId) ||
      (entry.kind !== "in_catalog" && entry.kind !== "out_of_catalog") ||
      entry.expectedProductIds.some((id) => !id.trim()) ||
      new Set(entry.expectedProductIds).size !== entry.expectedProductIds.length ||
      (entry.kind === "in_catalog"
        ? entry.expectedProductIds.length === 0
        : entry.expectedProductIds.length !== 0)
    )
      throw new RangeError(
        "Evaluation cases need unique images, IDs and human-labelled expected products.",
      );
    caseIds.add(entry.caseId);
    fileIds.add(entry.fileId);
  }
  const inCatalogImages = cases.filter((entry) => entry.kind === "in_catalog").length;
  const outOfCatalogImages = cases.length - inCatalogImages;
  if (inCatalogImages < 100 || outOfCatalogImages < 50)
    throw new RangeError(
      "Evaluation requires at least 100 in-catalog and 50 out-of-catalog images.",
    );

  let top5Hits = 0,
    correctNoResults = 0,
    failedRequests = 0;
  const results: CommerceImageEvaluationReport["results"][number][] = [];
  // Deliberately sequential: an evaluation must honor the same quota and platform budget as real searches.
  for (const entry of cases) {
    let returnedProductIds: string[] = [],
      requestFailed = false;
    try {
      const response = await search(entry.fileId);
      returnedProductIds = response.products.map((product) => product.id);
      if (
        returnedProductIds.length > 5 ||
        returnedProductIds.some((id) => !id.trim()) ||
        new Set(returnedProductIds).size !== returnedProductIds.length
      )
        throw new Error("Invalid image search result.");
    } catch {
      requestFailed = true;
      returnedProductIds = [];
      failedRequests++;
    }
    const correct =
      !requestFailed &&
      (entry.kind === "in_catalog"
        ? returnedProductIds.some((id) => entry.expectedProductIds.includes(id))
        : returnedProductIds.length === 0);
    if (correct) {
      if (entry.kind === "in_catalog") top5Hits++;
      else correctNoResults++;
    }
    results.push({ caseId: entry.caseId, returnedProductIds, correct, requestFailed });
  }
  return {
    inCatalogImages,
    outOfCatalogImages,
    top5Hits,
    correctNoResults,
    top5HitRate: top5Hits / inCatalogImages,
    noResultAccuracy: correctNoResults / outOfCatalogImages,
    failedRequests,
    passed:
      failedRequests === 0 &&
      top5Hits * 100 >= inCatalogImages * 85 &&
      correctNoResults * 100 >= outOfCatalogImages * 90,
    results,
  };
}
