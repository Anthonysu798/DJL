// FILE: KanbanOverview.tsx
// Purpose: Cross-project command center ordered by attention state.
// Layer: UI component (read-only; drag & drop lives in the project board)
// Exports: KanbanOverview

import type { ProjectId } from "@synara/contracts";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { useSelectedLocale } from "~/i18n/intl";
import {
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  EyeIcon,
  LoaderIcon,
  MessageCircleIcon,
  TerminalIcon,
} from "~/lib/icons";
import { disclosureChevronClassName } from "~/lib/disclosureMotion";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";
import { RAISED_SURFACE_CHROME_CLASS_NAME } from "../chat/composerPickerStyles";
import {
  buildKanbanCommandCenter,
  type KanbanBoard,
  type KanbanCard,
  type KanbanCommandCenterItem,
  type KanbanCommandStatus,
} from "./kanban.logic";

const LANE_RENDER_CAP = 24;

const STATUS_PRESENTATION: Record<
  KanbanCommandStatus,
  { icon: typeof LoaderIcon; iconClassName: string; accentClassName: string }
> = {
  waiting: {
    icon: MessageCircleIcon,
    iconClassName: "text-violet-600 dark:text-violet-300",
    accentClassName: "bg-violet-500/70",
  },
  failed: {
    icon: CircleAlertIcon,
    iconClassName: "text-destructive",
    accentClassName: "bg-destructive/70",
  },
  running: {
    icon: LoaderIcon,
    iconClassName: "text-sky-600 dark:text-sky-300",
    accentClassName: "bg-sky-500/70",
  },
  reviewReady: {
    icon: EyeIcon,
    iconClassName: "text-blue-600 dark:text-blue-300",
    accentClassName: "bg-blue-500/70",
  },
  done: {
    icon: CircleCheckIcon,
    iconClassName: "text-emerald-600 dark:text-emerald-300",
    accentClassName: "bg-emerald-500/70",
  },
};

export function KanbanCommandStatusIcon({
  status,
  className,
}: {
  status: KanbanCommandStatus;
  className?: string;
}) {
  const presentation = STATUS_PRESENTATION[status];
  const Icon = presentation.icon;
  return (
    <Icon
      className={cn(
        "size-3.5 shrink-0",
        presentation.iconClassName,
        status === "running" && "animate-spin",
        className,
      )}
      aria-hidden
    />
  );
}

const CommandCenterCard = memo(function CommandCenterCard({
  item,
  onOpenCard,
  onOpenProject,
  onCardContextMenu,
}: {
  item: KanbanCommandCenterItem;
  onOpenCard: (card: KanbanCard) => void;
  onOpenProject: (projectId: ProjectId) => void;
  onCardContextMenu?: ((card: KanbanCard, event: React.MouseEvent) => void) | undefined;
}) {
  const { t } = useTranslation("work");
  const locale = useSelectedLocale();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const presentation = STATUS_PRESENTATION[item.status];
  const timestamp = item.card.timestamp;

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-lg bg-card/70",
        RAISED_SURFACE_CHROME_CLASS_NAME,
        "dark:border dark:border-white/[0.05]",
      )}
    >
      <span
        className={cn("absolute inset-y-0 left-0 w-0.5", presentation.accentClassName)}
        aria-hidden
      />
      <button
        type="button"
        onClick={() => onOpenCard(item.card)}
        onContextMenu={
          onCardContextMenu ? (event) => onCardContextMenu(item.card, event) : undefined
        }
        className="flex w-full flex-col gap-1.5 px-3 py-2.5 pl-3.5 text-left transition-colors hover:bg-card focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={t("kanban.commandCenter.openThread", { title: item.card.title })}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          {item.card.isTerminal ? (
            <TerminalIcon className="size-3.5 shrink-0 text-muted-foreground/80" aria-hidden />
          ) : null}
          <span className="line-clamp-2 min-w-0 flex-1 text-[13px] leading-snug font-medium text-foreground/90">
            {item.card.title}
          </span>
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/45" aria-hidden />
        </span>
        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {t(`kanban.commandCenter.statuses.${item.status}.explanation`)}
        </span>
      </button>
      <div className="flex min-w-0 items-center gap-2 px-3 pb-2.5 pl-3.5 text-[11px] text-muted-foreground/70">
        <button
          type="button"
          onClick={() => onOpenProject(item.projectId)}
          className="min-w-0 truncate rounded-sm text-left hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
        >
          {item.projectName}
        </button>
        {timestamp ? (
          <span className="ml-auto shrink-0">{formatRelativeTime(timestamp, locale)}</span>
        ) : null}
      </div>
      {item.status === "failed" && item.technicalDetail ? (
        <div className="border-t border-border/55 px-3 py-2 pl-3.5">
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            aria-expanded={detailsOpen}
          >
            <ChevronRightIcon className={disclosureChevronClassName(detailsOpen, "size-3")} />
            {detailsOpen
              ? t("kanban.commandCenter.hideTechnicalDetails")
              : t("kanban.commandCenter.showTechnicalDetails")}
          </button>
          <DisclosureRegion open={detailsOpen}>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted/55 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {item.technicalDetail}
            </pre>
          </DisclosureRegion>
        </div>
      ) : null}
    </article>
  );
});

function CommandCenterLane({
  status,
  items,
  onOpenCard,
  onOpenProject,
  onCardContextMenu,
}: {
  status: KanbanCommandStatus;
  items: KanbanCommandCenterItem[];
  onOpenCard: (card: KanbanCard) => void;
  onOpenProject: (projectId: ProjectId) => void;
  onCardContextMenu?: ((card: KanbanCard, event: React.MouseEvent) => void) | undefined;
}) {
  const { t } = useTranslation("work");
  const [showAll, setShowAll] = useState(false);
  const visibleItems = showAll ? items : items.slice(0, LANE_RENDER_CAP);
  const hiddenCount = items.length - visibleItems.length;

  return (
    <section className="flex min-h-0 min-w-32 flex-1 flex-col xl:min-w-52">
      <header className="shrink-0 px-1.5 pb-2">
        <div className="flex items-center gap-2">
          <KanbanCommandStatusIcon status={status} />
          <h2 className="text-[13px] font-semibold text-foreground/90">
            {t(`kanban.commandCenter.statuses.${status}.title`)}
          </h2>
          <span className="rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {items.length}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground/75">
          {t(`kanban.commandCenter.statuses.${status}.explanation`)}
        </p>
      </header>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-1">
        {visibleItems.map((item) => (
          <li key={item.card.cardId} className="list-none">
            <CommandCenterCard
              item={item}
              onOpenCard={onOpenCard}
              onOpenProject={onOpenProject}
              onCardContextMenu={onCardContextMenu}
            />
          </li>
        ))}
        {items.length === 0 ? (
          <li className="list-none rounded-lg border border-dashed border-border/60 px-3 py-5 text-center text-xs text-muted-foreground/60">
            {t(`kanban.commandCenter.statuses.${status}.empty`)}
          </li>
        ) : null}
        {hiddenCount > 0 ? (
          <li className="list-none">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full rounded-lg px-3 py-1.5 text-center text-xs text-muted-foreground/80 transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              {t("kanban.showMore", { count: hiddenCount })}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

export function KanbanOverview({
  board,
  onOpenProject,
  onOpenCard,
  onCardContextMenu,
}: {
  board: KanbanBoard;
  onOpenProject: (projectId: ProjectId) => void;
  onOpenCard: (card: KanbanCard) => void;
  onCardContextMenu?: ((card: KanbanCard, event: React.MouseEvent) => void) | undefined;
  onNewTask: (projectId: ProjectId) => void;
  nowMs?: number;
}) {
  const { t } = useTranslation("work");
  const commandCenter = useMemo(() => buildKanbanCommandCenter(board), [board]);
  const newestDraftProject = board.projects.find((project) => project.draft.length > 0) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {commandCenter.draftCount > 0 && newestDraftProject ? (
        <div className="mx-5 mb-3 flex shrink-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
          <span>{t("kanban.commandCenter.drafts", { count: commandCenter.draftCount })}</span>
          <button
            type="button"
            onClick={() => onOpenProject(newestDraftProject.projectId)}
            className="ml-auto shrink-0 font-medium text-foreground/80 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t("kanban.commandCenter.reviewDrafts")}
          </button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4">
        {commandCenter.lanes.map((lane) => (
          <CommandCenterLane
            key={lane.status}
            status={lane.status}
            items={lane.items}
            onOpenCard={onOpenCard}
            onOpenProject={onOpenProject}
            onCardContextMenu={onCardContextMenu}
          />
        ))}
      </div>
    </div>
  );
}
