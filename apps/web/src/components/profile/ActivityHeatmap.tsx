// FILE: ActivityHeatmap.tsx
// Purpose: GitHub-style contribution heatmap shared by the Profile page and the
// shareable card. Renders columns of week × weekday cells with pre-bucketed
// intensity. Sizing uses inline px so html-to-image reproduces it exactly.
// Layer: web profile feature.

import { type CSSProperties, useMemo } from "react";
import type { ProfileHeatmapCell } from "@synara/contracts";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { formatCompact, formatShortDate } from "./profileFormatting";
import { formatLocaleDateTime, formatLocaleNumber } from "~/i18n/intl";

// Single-hue ramp built from the theme accent (`--info`, defaults to blue-500) for the
// in-app page (level 0 → 4). Mixes toward transparent so it sits well on light/dark.
export const APP_HEATMAP_INTENSITY_CLASSES: readonly string[] = [
  "bg-muted/70 dark:bg-white/[0.06]",
  "bg-[color-mix(in_srgb,var(--info)_24%,transparent)]",
  "bg-[color-mix(in_srgb,var(--info)_46%,transparent)]",
  "bg-[color-mix(in_srgb,var(--info)_72%,transparent)]",
  "bg-[var(--info)]",
];

// Accent ramp for the exported card. Mixes toward white so the steps stay opaque on the
// card's white background and reproduce identically via html-to-image. Level 0 mirrors the
// in-app heatmap's empty cell (`bg-muted/70`, i.e. black ~2.8%) flattened to an opaque color
// on white, so the exported image matches the empty-box color shown in the app.
export const CARD_HEATMAP_INTENSITY_CLASSES: readonly string[] = [
  "bg-[color-mix(in_srgb,black_2.8%,white)]",
  "bg-[color-mix(in_srgb,var(--info)_22%,white)]",
  "bg-[color-mix(in_srgb,var(--info)_45%,white)]",
  "bg-[color-mix(in_srgb,var(--info)_70%,white)]",
  "bg-[var(--info)]",
];

interface ActivityHeatmapProps {
  readonly cells: ReadonlyArray<ProfileHeatmapCell>;
  readonly cellSize?: number;
  readonly gap?: number;
  readonly radius?: number;
  readonly intensityClasses?: readonly string[];
  readonly showMonths?: boolean;
  readonly monthsPosition?: "top" | "bottom";
  readonly monthLabelClassName?: string;
  /**
   * Stretch columns to fill the container width (responsive square cells) instead
   * of using a fixed `cellSize`. Used by the in-app panel so the grid never scrolls
   * horizontally; the exported card keeps fixed px so html-to-image is exact.
   */
  readonly fill?: boolean;
  /**
   * In `fill` mode, stretch week columns across the container. When set, `maxCellSize`
   * caps each square cell's maximum size; columns shrink below that cap if needed so the
   * grid never overflows horizontally.
   */
  readonly maxCellSize?: number;
  /** Show a styled tooltip on hover. Leave off for the exported card (html-to-image). */
  readonly tooltip?: boolean;
  /** Metric used in the localized tooltip. */
  readonly tooltipUnit?: "prompts" | "tokens";
  readonly className?: string;
}

function heatmapTooltipText(
  cell: ProfileHeatmapCell,
  unit: "prompts" | "tokens",
  locale: string,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const date = formatShortDate(cell.day, locale) ?? cell.day;
  const localizedUnit = t(`profileActivity.units.${unit}`, {
    count: cell.count > 0 ? cell.count : 2,
  });
  if (cell.count <= 0) {
    return t("profileActivity.tooltipNone", { unit: localizedUnit, date });
  }
  return t("profileActivity.tooltipCount", {
    value: formatCompact(cell.count, locale),
    unit: localizedUnit,
    date,
  });
}

type Slot =
  | { readonly kind: "cell"; readonly cell: ProfileHeatmapCell }
  | { readonly kind: "pad"; readonly id: string };

interface Column {
  readonly key: string;
  readonly slots: ReadonlyArray<Slot>;
}

export function ActivityHeatmap({
  cells,
  cellSize = 13,
  gap = 3,
  radius = 4,
  intensityClasses = APP_HEATMAP_INTENSITY_CLASSES,
  showMonths = false,
  monthsPosition = "top",
  monthLabelClassName,
  fill = false,
  maxCellSize,
  tooltip = false,
  tooltipUnit = "prompts",
  className,
}: ActivityHeatmapProps) {
  const { t, i18n } = useTranslation("settings");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const columns = useMemo<Column[]>(() => {
    if (cells.length === 0) {
      return [];
    }
    const slots: Slot[] = [];
    for (let index = 0; index < cells[0]!.weekday; index += 1) {
      slots.push({ kind: "pad", id: `pad-lead-${index}` });
    }
    for (const cell of cells) {
      slots.push({ kind: "cell", cell });
    }
    while (slots.length % 7 !== 0) {
      slots.push({ kind: "pad", id: `pad-tail-${slots.length}` });
    }

    const result: Column[] = [];
    for (let index = 0; index < slots.length; index += 7) {
      const week = slots.slice(index, index + 7);
      const firstCell = week.find(
        (slot): slot is Extract<Slot, { kind: "cell" }> => slot.kind === "cell",
      );
      result.push({ key: firstCell ? firstCell.cell.day : `col-${index}`, slots: week });
    }
    return result;
  }, [cells]);

  const monthByColumn = useMemo<(string | null)[]>(() => {
    let previousMonth = -1;
    return columns.map((column) => {
      const firstCell = column.slots.find(
        (slot): slot is Extract<Slot, { kind: "cell" }> => slot.kind === "cell",
      );
      if (!firstCell) {
        return null;
      }
      const monthIndex = Number(firstCell.cell.day.split("-")[1]) - 1;
      if (monthIndex === previousMonth || monthIndex < 0) {
        return null;
      }
      previousMonth = monthIndex;
      return formatLocaleDateTime(new Date(Date.UTC(2020, monthIndex, 1)), locale, {
        month: "short",
        timeZone: "UTC",
      });
    });
  }, [columns, locale]);

  const columnCount = columns.length;
  const responsiveFill = fill && maxCellSize != null;
  const resolvedCellSize = fill ? (maxCellSize ?? cellSize) : cellSize;

  const columnStyle: CSSProperties = { gap: `${gap}px` };
  const cellStyle: CSSProperties = fill
    ? { borderRadius: `${radius}px` }
    : {
        width: `${resolvedCellSize}px`,
        height: `${resolvedCellSize}px`,
        borderRadius: `${radius}px`,
      };
  const cellClass = fill ? "aspect-square w-full min-w-0" : "shrink-0";
  const fillColumnStyle: CSSProperties = responsiveFill
    ? { ...columnStyle, flex: "1 1 0%", maxWidth: `${maxCellSize}px`, minWidth: 0 }
    : columnStyle;
  const columnClass = fill ? "flex min-w-0 flex-1 flex-col" : "flex shrink-0 flex-col";
  const monthLabelWidth: CSSProperties | undefined = fill
    ? responsiveFill
      ? { flex: "1 1 0%", maxWidth: `${maxCellSize}px`, minWidth: 0 }
      : undefined
    : { width: `${resolvedCellSize}px` };
  const monthLabelClass = fill ? "min-w-0 flex-1" : "shrink-0";
  const rowClass = fill ? "flex w-full min-w-0" : "flex w-max";
  const gridWidth =
    !fill && columnCount > 0
      ? columnCount * resolvedCellSize + Math.max(0, columnCount - 1) * gap
      : 0;
  const rowStyle: CSSProperties = {
    ...columnStyle,
    ...(gridWidth > 0 ? { width: `${gridWidth}px` } : {}),
  };

  const monthRow = showMonths ? (
    <div className={rowClass} style={rowStyle}>
      {columns.map((column, index) => (
        <div
          key={column.key}
          className={cn(
            "overflow-visible whitespace-nowrap text-[10px] font-medium leading-none text-muted-foreground",
            monthLabelClass,
            monthLabelClassName,
          )}
          style={monthLabelWidth}
        >
          {monthByColumn[index] ?? ""}
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div
      className={cn(fill ? "flex w-full min-w-0 flex-col" : "inline-flex flex-col", className)}
      style={{ gap: `${gap}px` }}
    >
      {showMonths && monthsPosition === "top" ? monthRow : null}
      <div className={rowClass} style={rowStyle}>
        {columns.map((column) => (
          <div key={column.key} className={columnClass} style={fillColumnStyle}>
            {column.slots.map((slot) => {
              if (slot.kind !== "cell") {
                return (
                  <div
                    key={slot.id}
                    className={cn(cellClass, "bg-transparent")}
                    style={cellStyle}
                  />
                );
              }
              const cellClassName = cn(
                cellClass,
                intensityClasses[slot.cell.intensity] ?? intensityClasses[0],
              );
              if (!tooltip) {
                return (
                  <div
                    key={slot.cell.day}
                    className={cellClassName}
                    style={cellStyle}
                    title={`${slot.cell.day} · ${formatLocaleNumber(slot.cell.count, locale)}`}
                  />
                );
              }
              return (
                <Tooltip key={slot.cell.day}>
                  {/* delay={0}: heatmap tooltips open instantly on hover (no Base UI 600ms default). */}
                  <TooltipTrigger
                    delay={0}
                    render={<div className={cellClassName} style={cellStyle} />}
                  />
                  <TooltipPopup side="top" sideOffset={6}>
                    {heatmapTooltipText(slot.cell, tooltipUnit, locale, t)}
                  </TooltipPopup>
                </Tooltip>
              );
            })}
          </div>
        ))}
      </div>
      {showMonths && monthsPosition === "bottom" ? monthRow : null}
    </div>
  );
}
