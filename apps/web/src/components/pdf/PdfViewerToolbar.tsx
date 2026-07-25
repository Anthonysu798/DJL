// FILE: PdfViewerToolbar.tsx
// Purpose: Top chrome bar for the in-app PDF viewer. Mirrors the reference UI:
//          file name + "PDF" label on the left, centered page navigation, and
//          zoom controls + the shared "Open in editor" split button on the right.
// Layer: Web PDF viewer chrome
// Exports: PdfViewerToolbar

import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Maximize2,
  Minimize2,
  MinusIcon,
  PlusIcon,
  PrinterIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon,
} from "~/lib/icons";
import { formatZoomPercent, PDF_ZOOM_PRESETS, type PdfZoomMode } from "~/lib/pdf/pdfZoom";
import { cn } from "~/lib/utils";
import { ComposerPickerMenuPopup } from "../chat/ComposerPickerMenuPopup";
import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  ChatHeaderButton,
  ChatHeaderIconButton,
} from "../chat/chatHeaderControls";
import { OpenInPicker } from "../chat/OpenInPicker";
import { Badge } from "../ui/badge";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { Menu, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "../ui/menu";

interface PdfViewerToolbarProps {
  fileName: string;
  currentPage: number;
  numPages: number;
  onJumpToPage: (pageNumber: number) => void;
  zoomMode: PdfZoomMode;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetScale: (scale: number) => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  openInTarget: string | null;
  documentType?: "PDF" | "DOCX" | "PPTX";
  warnings?: ReadonlyArray<string>;
  onShowReadableText?: () => void;
  onToggleDetails?: () => void;
  detailsOpen?: boolean;
  controlsOnly?: boolean;
  searchQuery?: string;
  searchMatchIndex?: number;
  searchMatchCount?: number;
  searchPending?: boolean;
  onSearchQueryChange?: (query: string) => void;
  onSearchPrevious?: () => void;
  onSearchNext?: () => void;
  onPrint?: () => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
}

function zoomSelectionValue(mode: PdfZoomMode, scale: number): string {
  if (mode.type === "fit-width") {
    return "fit-width";
  }
  if (mode.type === "fit-page") {
    return "fit-page";
  }
  return String(Math.round(scale * 100));
}

export const PdfViewerToolbar = memo(function PdfViewerToolbar(props: PdfViewerToolbarProps) {
  const { t } = useTranslation("workspace");
  const selectionValue = zoomSelectionValue(props.zoomMode, props.scale);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  return (
    <div
      className={cn(
        // Match the breadcrumb file-preview header height (h-10) so swapping
        // between a PDF and a text file in the same pane doesn't jump the chrome.
        "flex h-10 shrink-0 items-center gap-2 px-3",
        CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {!props.controlsOnly ? (
          <>
            <span
              className="truncate text-[12px] font-medium text-foreground"
              title={props.fileName}
            >
              {props.fileName}
            </span>
            <Badge variant="outline" size="sm" className="text-muted-foreground/80">
              {props.documentType ?? "PDF"}
            </Badge>
            {props.warnings && props.warnings.length > 0 ? (
              <span
                className="inline-flex items-center text-amber-500"
                title={props.warnings.join("\n")}
                aria-label={t("preview.warningCount", { count: props.warnings.length })}
              >
                <TriangleAlertIcon className="size-3.5" aria-hidden="true" />
              </span>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <ChatHeaderIconButton
          label={t("preview.actions.previousPage")}
          tone="plain"
          disabled={props.currentPage <= 1}
          onClick={() => props.onJumpToPage(props.currentPage - 1)}
        >
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
        </ChatHeaderIconButton>
        <PdfPageIndicator
          currentPage={props.currentPage}
          numPages={props.numPages}
          onJumpToPage={props.onJumpToPage}
        />
        <ChatHeaderIconButton
          label={t("preview.actions.nextPage")}
          tone="plain"
          disabled={props.currentPage >= props.numPages}
          onClick={() => props.onJumpToPage(props.currentPage + 1)}
        >
          <ChevronRightIcon aria-hidden="true" className="size-4" />
        </ChatHeaderIconButton>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        {props.onSearchQueryChange ? (
          <div className="relative">
            <ChatHeaderIconButton
              label={t("preview.actions.searchDocument")}
              tone="plain"
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((open) => !open)}
            >
              <SearchIcon aria-hidden="true" className="size-3.5" />
            </ChatHeaderIconButton>
            <div className="absolute right-0 top-full z-50 mt-1 w-72">
              <DisclosureRegion open={searchOpen}>
                <div className="flex items-center gap-1 rounded-md border border-border/70 bg-popover p-1.5 shadow-lg">
                  <SearchIcon
                    aria-hidden="true"
                    className="ml-1 size-3.5 shrink-0 text-muted-foreground"
                  />
                  <input
                    ref={searchInputRef}
                    value={props.searchQuery ?? ""}
                    aria-label={t("preview.actions.searchDocument")}
                    placeholder={t("preview.actions.searchPlaceholder")}
                    className="h-7 min-w-0 flex-1 bg-transparent px-1 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/70"
                    onChange={(event) => props.onSearchQueryChange?.(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (event.shiftKey) props.onSearchPrevious?.();
                        else props.onSearchNext?.();
                      } else if (event.key === "Escape") {
                        setSearchOpen(false);
                      }
                    }}
                  />
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {props.searchPending
                      ? "…"
                      : props.searchMatchCount
                        ? `${(props.searchMatchIndex ?? 0) + 1}/${props.searchMatchCount}`
                        : "0/0"}
                  </span>
                  <ChatHeaderIconButton
                    label={t("preview.actions.previousResult")}
                    tone="plain"
                    disabled={!props.searchMatchCount}
                    onClick={props.onSearchPrevious}
                  >
                    <ChevronLeftIcon aria-hidden="true" className="size-3.5" />
                  </ChatHeaderIconButton>
                  <ChatHeaderIconButton
                    label={t("preview.actions.nextResult")}
                    tone="plain"
                    disabled={!props.searchMatchCount}
                    onClick={props.onSearchNext}
                  >
                    <ChevronRightIcon aria-hidden="true" className="size-3.5" />
                  </ChatHeaderIconButton>
                  <ChatHeaderIconButton
                    label={t("preview.actions.closeSearch")}
                    tone="plain"
                    onClick={() => setSearchOpen(false)}
                  >
                    <XIcon aria-hidden="true" className="size-3.5" />
                  </ChatHeaderIconButton>
                </div>
              </DisclosureRegion>
            </div>
          </div>
        ) : null}
        {props.onShowReadableText ? (
          <ChatHeaderButton tone="plain" onClick={props.onShowReadableText}>
            {t("preview.actions.readableText")}
          </ChatHeaderButton>
        ) : null}
        {props.onToggleDetails ? (
          <ChatHeaderButton
            tone="plain"
            aria-expanded={props.detailsOpen}
            onClick={props.onToggleDetails}
          >
            {t("preview.actions.details")}
          </ChatHeaderButton>
        ) : null}
        <div className="flex items-center gap-0.5">
          <ChatHeaderIconButton
            label={t("preview.actions.zoomOut")}
            tone="plain"
            onClick={props.onZoomOut}
          >
            <MinusIcon aria-hidden="true" className="size-4" />
          </ChatHeaderIconButton>
          <Menu>
            <MenuTrigger
              render={
                <ChatHeaderButton tone="plain" className="min-w-16 justify-center gap-1 px-2" />
              }
            >
              <span className="tabular-nums">{formatZoomPercent(props.scale)}</span>
              <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-70" />
            </MenuTrigger>
            <ComposerPickerMenuPopup align="end" side="bottom" className="w-40 min-w-40">
              <MenuRadioGroup
                value={selectionValue}
                onValueChange={(value) => {
                  if (value === "fit-width") {
                    props.onFitWidth();
                  } else if (value === "fit-page") {
                    props.onFitPage();
                  } else {
                    const percent = Number(value);
                    if (Number.isFinite(percent)) {
                      props.onSetScale(percent / 100);
                    }
                  }
                }}
              >
                <MenuRadioItem value="fit-width">{t("preview.actions.fitWidth")}</MenuRadioItem>
                <MenuRadioItem value="fit-page">{t("preview.actions.fitPage")}</MenuRadioItem>
                <MenuSeparator className="mx-1" />
                {PDF_ZOOM_PRESETS.map((preset) => {
                  const percent = String(Math.round(preset * 100));
                  return (
                    <MenuRadioItem key={percent} value={percent}>
                      {percent}%
                    </MenuRadioItem>
                  );
                })}
              </MenuRadioGroup>
            </ComposerPickerMenuPopup>
          </Menu>
          <ChatHeaderIconButton
            label={t("preview.actions.zoomIn")}
            tone="plain"
            onClick={props.onZoomIn}
          >
            <PlusIcon aria-hidden="true" className="size-4" />
          </ChatHeaderIconButton>
        </div>

        {props.onPrint ? (
          <ChatHeaderIconButton
            label={t("preview.actions.print")}
            tone="plain"
            onClick={props.onPrint}
          >
            <PrinterIcon aria-hidden="true" className="size-3.5" />
          </ChatHeaderIconButton>
        ) : null}
        {props.onToggleFullscreen ? (
          <ChatHeaderIconButton
            label={
              props.isFullscreen
                ? t("preview.actions.exitFullscreen")
                : t("preview.actions.enterFullscreen")
            }
            tone="plain"
            onClick={props.onToggleFullscreen}
          >
            {props.isFullscreen ? (
              <Minimize2 aria-hidden="true" className="size-3.5" />
            ) : (
              <Maximize2 aria-hidden="true" className="size-3.5" />
            )}
          </ChatHeaderIconButton>
        ) : null}

        {!props.controlsOnly ? (
          <OpenInPicker
            openInTarget={props.openInTarget}
            labelMode="always"
            defaultEditor="system-default"
          />
        ) : null}
      </div>
    </div>
  );
});

function PdfPageIndicator({
  currentPage,
  numPages,
  onJumpToPage,
}: {
  currentPage: number;
  numPages: number;
  onJumpToPage: (pageNumber: number) => void;
}) {
  const { t } = useTranslation("workspace");
  const [draft, setDraft] = useState(String(currentPage));
  useEffect(() => {
    setDraft(String(currentPage));
  }, [currentPage]);

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (Number.isFinite(parsed)) {
      onJumpToPage(Math.min(Math.max(parsed, 1), Math.max(numPages, 1)));
    } else {
      setDraft(String(currentPage));
    }
  };

  return (
    <span className="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
      <input
        value={draft}
        inputMode="numeric"
        aria-label={t("preview.currentPage")}
        className="h-6 w-8 rounded-sm border border-border/60 bg-transparent text-center text-[11px] text-foreground tabular-nums outline-none focus-visible:border-[color:var(--color-border-focus)]"
        onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
      <span className="opacity-70">/ {numPages}</span>
    </span>
  );
}
