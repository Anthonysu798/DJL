import type { TFunction } from "i18next";

export type PdfUiErrorSummaryKey =
  | "preview.errors.document.summary"
  | "preview.errors.pageRender"
  | "preview.errors.print";

export interface PdfUiError {
  summaryKey: PdfUiErrorSummaryKey;
  detail: string;
}

export function createPdfUiError(summaryKey: PdfUiErrorSummaryKey, error: unknown): PdfUiError {
  return {
    summaryKey,
    detail: error instanceof Error ? error.message : String(error),
  };
}

export function resolvePdfUiErrorSummary(t: TFunction<"workspace">, error: PdfUiError): string {
  return t(error.summaryKey);
}
