// Focused slide viewer for rendered PPTX previews with a collapsible-on-narrow filmstrip.

import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { TriangleAlertIcon } from "~/lib/icons";
import { useContainerSize } from "~/lib/pdf/useContainerSize";
import { usePdfDocument } from "~/lib/pdf/usePdfDocument";
import { usePdfSearch } from "~/lib/pdf/usePdfSearch";
import { resolvePdfUiErrorSummary, usePdfViewerActions } from "~/lib/pdf/usePdfViewerActions";
import { usePdfZoomController } from "~/lib/pdf/usePdfZoomController";
import { cn } from "~/lib/utils";
import { PdfPageView } from "./pdf/PdfPageView";
import { PdfViewerToolbar } from "./pdf/PdfViewerToolbar";

export const PresentationFilePreview = memo(function PresentationFilePreview(props: {
  fileName: string;
  previewUrl: string;
  openInTarget: string | null;
  warnings?: ReadonlyArray<string>;
  onShowReadableText?: () => void;
  onToggleDetails?: () => void;
  detailsOpen?: boolean;
  controlsOnly?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("workspace");
  const doc = usePdfDocument(props.previewUrl);
  const actions = usePdfViewerActions(props.previewUrl);
  const [selectedSlide, setSelectedSlide] = useState(1);
  const [mainRoot, setMainRoot] = useState<HTMLDivElement | null>(null);
  const [filmstripRoot, setFilmstripRoot] = useState<HTMLDivElement | null>(null);
  const containerSize = useContainerSize(mainRoot);
  const noRegister = useCallback(() => undefined, []);
  const zoom = usePdfZoomController({
    firstPageSize: doc.firstPageSize,
    containerSize,
    currentPage: selectedSlide,
    scrollToPage: () => undefined,
  });
  const slideNumbers = useMemo(
    () => Array.from({ length: doc.numPages }, (_, index) => index + 1),
    [doc.numPages],
  );
  const jumpToSlide = useCallback(
    (slide: number) => setSelectedSlide(Math.min(Math.max(slide, 1), Math.max(doc.numPages, 1))),
    [doc.numPages],
  );
  const search = usePdfSearch({
    document: doc.document,
    numPages: doc.numPages,
    onJumpToPage: jumpToSlide,
  });
  const outerClassName = cn(
    "flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-background-surface)]",
    actions.fullscreenClassName,
    props.className,
  );

  if (doc.status === "ready" && doc.document && doc.firstPageSize) {
    return (
      <div ref={actions.setRoot} className={outerClassName}>
        <PdfViewerToolbar
          fileName={props.fileName}
          currentPage={selectedSlide}
          numPages={doc.numPages}
          onJumpToPage={jumpToSlide}
          zoomMode={zoom.zoomMode}
          scale={zoom.scale}
          onZoomIn={zoom.onZoomIn}
          onZoomOut={zoom.onZoomOut}
          onSetScale={zoom.onSetScale}
          onFitWidth={zoom.onFitWidth}
          onFitPage={zoom.onFitPage}
          openInTarget={props.openInTarget}
          documentType="PPTX"
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
        <div className="flex min-h-0 flex-1 bg-muted/20">
          <div
            ref={setFilmstripRoot}
            className="hidden w-40 shrink-0 overflow-y-auto border-r border-border/60 px-3 py-3 @xl:block"
            aria-label={t("preview.slideThumbnails")}
          >
            <div className="space-y-3">
              {slideNumbers.map((slideNumber) => (
                <button
                  key={slideNumber}
                  type="button"
                  className={cn(
                    "block w-full border bg-background p-1 text-left shadow-sm outline-none transition-colors motion-reduce:transition-none",
                    selectedSlide === slideNumber
                      ? "border-[color:var(--color-border-focus)] ring-1 ring-[color:var(--color-border-focus)]"
                      : "border-border/60 hover:border-border",
                  )}
                  aria-label={t("preview.slide", { number: slideNumber })}
                  aria-current={selectedSlide === slideNumber ? "page" : undefined}
                  onClick={() => jumpToSlide(slideNumber)}
                >
                  <PdfPageView
                    document={doc.document!}
                    pageNumber={slideNumber}
                    scale={0.18}
                    intrinsicSize={doc.firstPageSize!}
                    scrollRoot={filmstripRoot}
                    registerElement={noRegister}
                    onJumpToPage={jumpToSlide}
                  />
                  <span className="mt-1 block text-center text-[10px] tabular-nums text-muted-foreground">
                    {slideNumber}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div
            ref={setMainRoot}
            className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto p-5 outline-none"
            tabIndex={0}
            aria-label={t("preview.slidePosition", {
              current: selectedSlide,
              total: doc.numPages,
            })}
            onKeyDown={(event) => {
              if (["ArrowRight", "ArrowDown", "PageDown"].includes(event.key)) {
                event.preventDefault();
                jumpToSlide(selectedSlide + 1);
              } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
                event.preventDefault();
                jumpToSlide(selectedSlide - 1);
              }
            }}
          >
            {containerSize ? (
              <PdfPageView
                key={`${props.previewUrl}:${selectedSlide}`}
                document={doc.document}
                pageNumber={selectedSlide}
                scale={zoom.scale}
                intrinsicSize={doc.firstPageSize}
                scrollRoot={mainRoot}
                registerElement={noRegister}
                onJumpToPage={jumpToSlide}
              />
            ) : null}
          </div>
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
    <div className={outerClassName} role="status" aria-label={t("preview.preparingPresentation")}>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/20 p-8">
        <div className="aspect-video w-full max-w-4xl animate-pulse bg-background shadow-[0_1px_5px_rgba(0,0,0,0.22)] motion-reduce:animate-none" />
      </div>
    </div>
  );
});
