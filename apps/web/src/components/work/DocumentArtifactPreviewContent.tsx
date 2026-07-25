// FILE: DocumentArtifactPreviewContent.tsx
// Purpose: Shared bounded rendering for normalized Work document previews.

import type { DocumentArtifactPreview, DocumentLocator } from "@synara/contracts";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { cn } from "~/lib/utils";

export function documentLocatorLabel(locator: DocumentLocator, translate?: TFunction): string {
  const tr = (key: string, options?: Record<string, unknown>) =>
    translate?.(key, { ns: "work", ...options }) ?? String(options?.defaultValue ?? key);
  const parts: string[] = [];
  if (locator.page !== undefined)
    parts.push(
      tr("documents.locator.page", { number: locator.page, defaultValue: `Page ${locator.page}` }),
    );
  if (locator.sheet !== undefined)
    parts.push(
      tr("documents.locator.sheet", {
        name: locator.sheet,
        defaultValue: `Sheet ${locator.sheet}`,
      }),
    );
  if (locator.cellRange !== undefined)
    parts.push(
      tr("documents.locator.cells", {
        range: locator.cellRange,
        defaultValue: `Cells ${locator.cellRange}`,
      }),
    );
  if (locator.slide !== undefined)
    parts.push(
      tr("documents.locator.slide", {
        number: locator.slide,
        defaultValue: `Slide ${locator.slide}`,
      }),
    );
  if (locator.paragraph !== undefined)
    parts.push(
      tr("documents.locator.paragraph", {
        number: locator.paragraph,
        defaultValue: `Paragraph ${locator.paragraph}`,
      }),
    );
  return parts.length > 0
    ? parts.join(" · ")
    : tr("documents.locator.extractedContent", { defaultValue: "Extracted content" });
}

export function needsDocumentReview(artifact: DocumentArtifactPreview): boolean {
  return (
    artifact.blocks.some((block) => block.confidence < 0.8) ||
    artifact.warnings.some((warning) => /low[- ]confidence|uncertain/i.test(warning))
  );
}

export function DocumentArtifactPreviewContent(props: {
  readonly artifact: DocumentArtifactPreview;
  readonly showTitle?: boolean;
  readonly maxBlocks?: number;
  readonly compact?: boolean;
  readonly className?: string;
}) {
  const { t } = useTranslation("work");
  const { artifact } = props;
  const reviewRecommended = needsDocumentReview(artifact);
  const visibleBlocks = artifact.blocks.slice(0, props.maxBlocks ?? 100);

  return (
    <article
      className={cn("space-y-3", props.className)}
      aria-label={props.showTitle === false ? t("documents.previewLabel") : artifact.originalName}
    >
      {props.showTitle === false ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {artifact.originalName}
          </h4>
          <span className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {artifact.extractionMethod}
          </span>
        </div>
      )}
      {reviewRecommended ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-300" role="status">
          {t("documents.reviewRecommendedDetail")}
        </p>
      ) : null}
      {artifact.warnings.length > 0 ? (
        <ul className="space-y-1 rounded-md border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2 text-[11px] text-muted-foreground">
          {artifact.warnings.slice(0, 100).map((warning, index) => (
            <li key={`${artifact.id}:warning:${index}`}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <ol className="space-y-3">
        {visibleBlocks.map((block) => (
          <li
            key={block.id}
            className={cn(
              "rounded-md border border-border/45 bg-background/45",
              props.compact ? "px-2.5 py-2" : "px-4 py-3",
            )}
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <span>{documentLocatorLabel(block.locator, t)}</span>
              <span
                aria-label={t("documents.confidence", {
                  percent: Math.round(block.confidence * 100),
                })}
              >
                {t("documents.confidence", { percent: Math.round(block.confidence * 100) })}
              </span>
            </div>
            <p
              className={cn(
                "whitespace-pre-wrap break-words text-foreground/90",
                props.compact
                  ? "max-h-28 overflow-hidden text-[11px] leading-relaxed"
                  : "text-sm leading-6",
              )}
            >
              {block.text}
            </p>
          </li>
        ))}
      </ol>
      {artifact.blocks.length > visibleBlocks.length ? (
        <p className="text-[10px] text-muted-foreground">
          {t("documents.moreExcerpts", {
            count: artifact.blocks.length - visibleBlocks.length,
          })}
        </p>
      ) : null}
      {artifact.blocks.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("documents.noReadableText")}</p>
      ) : null}
    </article>
  );
}
