// FILE: PdfFilePreview.tsx
// Purpose: In-app PDF viewer surface. Renders our own toolbar (file name, page
//          navigation, zoom) over a continuously-scrolling, centered stack of
//          pdf.js-rendered pages — replacing the browser's built-in PDF iframe so
//          the chrome matches the rest of Synara. Modeled on how Codex vendors a
//          custom pdf.js viewer (canvas + text layer + clickable links).
//          This component is the orchestrator: document load, container
//          measurement, page navigation, and zoom each live in their own hook
//          (usePdfDocument / useContainerSize / usePdfPageNavigation /
//          usePdfZoomController) and are composed here.
// Layer: Web chat/editor file-preview component
// Exports: PdfFilePreview

import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { basenameOfPath } from "~/file-icons";
import { TriangleAlertIcon } from "~/lib/icons";
import { buildLocalImageUrl } from "~/lib/localImageUrls";
import { useContainerSize } from "~/lib/pdf/useContainerSize";
import { usePdfDocument } from "~/lib/pdf/usePdfDocument";
import { usePdfPageNavigation } from "~/lib/pdf/usePdfPageNavigation";
import { usePdfSearch } from "~/lib/pdf/usePdfSearch";
import { resolvePdfUiErrorSummary, usePdfViewerActions } from "~/lib/pdf/usePdfViewerActions";
import { usePdfZoomController } from "~/lib/pdf/usePdfZoomController";
import { cn } from "~/lib/utils";
import { PdfPageView } from "./pdf/PdfPageView";
import { PdfViewerToolbar } from "./pdf/PdfViewerToolbar";

export const PdfFilePreview = memo(function PdfFilePreview(props: {
  /**
   * Workspace-relative path of the PDF (resolved server-side against cwd), or an
   * allowlisted absolute path (e.g. inside a session's scratch workspace).
   */
  filePath: string;
  cwd: string | null | undefined;
  previewGrant?: string | null | undefined;
  /** Authenticated rendered-PDF URL for Office previews. */
  previewUrl?: string | undefined;
  documentType?: "PDF" | "DOCX" | "PPTX" | undefined;
  warnings?: ReadonlyArray<string> | undefined;
  onShowReadableText?: (() => void) | undefined;
  onToggleDetails?: (() => void) | undefined;
  detailsOpen?: boolean | undefined;
  controlsOnly?: boolean | undefined;
  /** Pre-resolved target for the "Open in editor" control in the toolbar. */
  openInTarget: string | null;
  className?: string;
}) {
  const { t } = useTranslation("workspace");
  const previewUrl = useMemo(
    () =>
      props.previewUrl ??
      buildLocalImageUrl({
        src: props.filePath,
        cwd: props.cwd ?? undefined,
        grant: props.previewGrant,
      }),
    [props.cwd, props.filePath, props.previewGrant, props.previewUrl],
  );
  const fileName = useMemo(() => basenameOfPath(props.filePath), [props.filePath]);
  const doc = usePdfDocument(previewUrl);
  const actions = usePdfViewerActions(previewUrl);

  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const containerSize = useContainerSize(scrollRoot);

  const navigation = usePdfPageNavigation({
    scrollRoot,
    numPages: doc.numPages,
    enabled: doc.status === "ready",
    resetKey: previewUrl,
  });
  const zoom = usePdfZoomController({
    firstPageSize: doc.firstPageSize,
    containerSize,
    currentPage: navigation.currentPage,
    scrollToPage: navigation.scrollToPage,
  });
  const search = usePdfSearch({
    document: doc.document,
    numPages: doc.numPages,
    onJumpToPage: navigation.jumpToPage,
  });

  const pageNumbers = useMemo(
    () => Array.from({ length: doc.numPages }, (_, index) => index + 1),
    [doc.numPages],
  );

  const outerClassName = cn(
    "flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-background-surface)]",
    actions.fullscreenClassName,
    props.className,
  );

  const readyDocument = doc.document;
  const firstPageSize = doc.firstPageSize;
  if (doc.status === "ready" && readyDocument && firstPageSize) {
    return (
      <div ref={actions.setRoot} className={outerClassName}>
        <PdfViewerToolbar
          fileName={fileName}
          currentPage={navigation.currentPage}
          numPages={doc.numPages}
          onJumpToPage={navigation.jumpToPage}
          zoomMode={zoom.zoomMode}
          scale={zoom.scale}
          onZoomIn={zoom.onZoomIn}
          onZoomOut={zoom.onZoomOut}
          onSetScale={zoom.onSetScale}
          onFitWidth={zoom.onFitWidth}
          onFitPage={zoom.onFitPage}
          openInTarget={props.openInTarget}
          documentType={props.documentType ?? "PDF"}
          {...(props.warnings ? { warnings: props.warnings } : {})}
          {...(props.onShowReadableText ? { onShowReadableText: props.onShowReadableText } : {})}
          {...(props.onToggleDetails ? { onToggleDetails: props.onToggleDetails } : {})}
          {...(typeof props.detailsOpen === "boolean" ? { detailsOpen: props.detailsOpen } : {})}
          {...(typeof props.controlsOnly === "boolean" ? { controlsOnly: props.controlsOnly } : {})}
          searchQuery={search.query}
          searchMatchIndex={search.matchIndex}
          searchMatchCount={search.matchCount}
          searchPending={search.isSearching}
          onSearchQueryChange={search.setQuery}
          onSearchPrevious={search.previousMatch}
          onSearchNext={search.nextMatch}
          onPrint={() => void actions.print()}
          onToggleFullscreen={() => void actions.toggleFullscreen().catch(() => undefined)}
          isFullscreen={actions.isFullscreen}
        />
        {actions.printError ? (
          <div
            className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-[11px]"
            role="alert"
          >
            <span>{resolvePdfUiErrorSummary(t, actions.printError)}</span>
            <pre className="mt-1 whitespace-pre-wrap text-muted-foreground">
              {actions.printError.detail}
            </pre>
          </div>
        ) : null}
        <div ref={setScrollRoot} className="pdf-viewer-scroll min-h-0 flex-1 overflow-auto">
          {containerSize
            ? pageNumbers.map((pageNumber) => (
                <PdfPageView
                  key={`${previewUrl}:${pageNumber}`}
                  document={readyDocument}
                  pageNumber={pageNumber}
                  scale={zoom.scale}
                  intrinsicSize={firstPageSize}
                  scrollRoot={scrollRoot}
                  registerElement={navigation.registerElement}
                  onJumpToPage={navigation.jumpToPage}
                />
              ))
            : null}
        </div>
      </div>
    );
  }

  if (doc.status === "error") {
    return (
      <div className={outerClassName}>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <TriangleAlertIcon className="size-5 text-destructive/80" aria-hidden="true" />
          <p className="text-[12px] font-medium text-foreground">
            {t("preview.errors.document.title")}
          </p>
          <p className="text-[12px] text-muted-foreground">
            {doc.error
              ? resolvePdfUiErrorSummary(t, doc.error)
              : t("preview.errors.document.summary")}
          </p>
          {doc.error ? (
            <pre className="max-w-full whitespace-pre-wrap text-[11px]">{doc.error.detail}</pre>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={outerClassName}>
      <div
        className="flex min-h-0 flex-1 flex-col items-center gap-5 overflow-hidden bg-muted/20 px-6 py-8"
        role="status"
        aria-label={t("preview.preparingDocument")}
      >
        {[0, 1, 2].map((page) => (
          <div
            key={page}
            className="aspect-[8.5/11] w-full max-w-[34rem] shrink-0 animate-pulse bg-background shadow-[0_1px_4px_rgba(0,0,0,0.18)] motion-reduce:animate-none"
            aria-hidden="true"
          />
        ))}
        <span className="sr-only">{t("preview.preparingDocument")}</span>
      </div>
    </div>
  );
});
