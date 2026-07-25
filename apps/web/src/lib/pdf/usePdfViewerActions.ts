import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { createPdfUiError, type PdfUiError } from "./pdfUiError";

export { createPdfUiError, resolvePdfUiErrorSummary } from "./pdfUiError";
export type { PdfUiError } from "./pdfUiError";

export interface PdfPrintErrorState {
  previewUrl: string;
  error: PdfUiError;
}

export function resolvePdfPrintErrorForPreview(
  state: PdfPrintErrorState | null,
  previewUrl: string,
): PdfUiError | null {
  return state?.previewUrl === previewUrl ? state.error : null;
}

async function printPdf(previewUrl: string, frameTitle: string): Promise<void> {
  const desktopPrint = window.desktopBridge?.printPdf;
  if (desktopPrint) {
    await desktopPrint(previewUrl);
    return;
  }

  const response = await fetch(previewUrl, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blobUrl = URL.createObjectURL(await response.blob());
  const frame = document.createElement("iframe");
  frame.title = frameTitle;
  frame.style.position = "fixed";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  frame.src = blobUrl;
  document.body.append(frame);
  frame.addEventListener(
    "load",
    () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      globalThis.setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(blobUrl);
      }, 60_000);
    },
    { once: true },
  );
}

export function usePdfViewerActions(previewUrl: string) {
  const { t } = useTranslation("workspace");
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);
  const [printErrorState, setPrintErrorState] = useState<PdfPrintErrorState | null>(null);

  useEffect(() => {
    setPrintErrorState(null);
  }, [previewUrl]);

  useEffect(() => {
    const update = () => setNativeFullscreen(document.fullscreenElement === root);
    document.addEventListener("fullscreenchange", update);
    update();
    return () => document.removeEventListener("fullscreenchange", update);
  }, [root]);

  const toggleFullscreen = useCallback(async () => {
    if (!root) return;
    if (document.fullscreenElement === root) {
      await document.exitFullscreen();
      setFallbackFullscreen(false);
      return;
    }
    // Keep this app-local: Electron's platform Fullscreen API can switch the
    // entire desktop window/Space and is inconsistently permitted in embedded
    // development surfaces. A fixed viewer layer is immediate and reversible.
    setFallbackFullscreen((fullscreen) => !fullscreen);
  }, [fallbackFullscreen, root]);

  const print = useCallback(async () => {
    setPrintErrorState(null);
    try {
      await printPdf(previewUrl, t("preview.actions.print"));
    } catch (error) {
      setPrintErrorState({
        previewUrl,
        error: createPdfUiError("preview.errors.print", error),
      });
    }
  }, [previewUrl, t]);

  return {
    setRoot,
    isFullscreen: nativeFullscreen || fallbackFullscreen,
    fullscreenClassName:
      nativeFullscreen || fallbackFullscreen
        ? "fixed inset-0 z-[100] bg-[var(--color-background-surface)]"
        : undefined,
    toggleFullscreen,
    print,
    printError: resolvePdfPrintErrorForPreview(printErrorState, previewUrl),
  };
}
