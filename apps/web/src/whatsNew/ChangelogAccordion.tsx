// FILE: whatsNew/ChangelogAccordion.tsx
// Purpose: Collapsible release-history accordion used by both the Settings
// "Release history" surface and the `WhatsNewDialog` "Complete changelog"
// secondary view. Each row summarises a release; expanding reveals the
// FeatureSection cards for that version.
// Layer: presentational — it assumes the caller has already sorted entries
// newest-first (see `sortEntriesByVersionDesc`).

import { useState } from "react";

import { useTranslation } from "react-i18next";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { cn } from "~/lib/utils";

import { FeatureSection } from "./FeatureSection";
import { localizeWhatsNewEntry, type WhatsNewEntry } from "./logic";

export interface ChangelogAccordionProps {
  readonly entries: readonly WhatsNewEntry[];
  /**
   * The version to expand by default. When set, the matching row is open on
   * mount; all other rows start collapsed. Useful in the dialog, where we
   * want the installed build's notes front-and-center even in the changelog
   * view.
   */
  readonly defaultExpandedVersion?: string | null;
  readonly className?: string;
  readonly currentVersion?: string | null;
}

export function ChangelogAccordion({
  entries,
  defaultExpandedVersion = null,
  className,
  currentVersion = import.meta.env.APP_VERSION,
}: ChangelogAccordionProps) {
  const { i18n, t } = useTranslation("whatsNew");
  if (entries.length === 0) {
    return <p className={cn("text-xs text-muted-foreground", className)}>{t("history.empty")}</p>;
  }

  const showOlderEntriesNotice =
    !i18n.resolvedLanguage?.startsWith("en") &&
    entries.some((entry) => entry.version !== currentVersion);

  return (
    <div className={className}>
      {showOlderEntriesNotice ? (
        <p className="mb-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {t("history.olderEntriesNotice")}
        </p>
      ) : null}
      <ul className="flex flex-col">
        {entries.map((entry, index) => (
          <ChangelogAccordionRow
            key={entry.version}
            entry={localizeWhatsNewEntry(
              entry,
              t,
              entry.version === currentVersion,
              i18n.resolvedLanguage ?? i18n.language,
            )}
            defaultOpen={entry.version === defaultExpandedVersion}
            isLast={index === entries.length - 1}
          />
        ))}
      </ul>
    </div>
  );
}

function ChangelogAccordionRow({
  entry,
  defaultOpen,
  isLast,
}: {
  readonly entry: WhatsNewEntry;
  readonly defaultOpen: boolean;
  readonly isLast: boolean;
}) {
  const { t } = useTranslation("whatsNew");
  const [open, setOpen] = useState(defaultOpen);

  const featureCount = entry.features.length;
  const featureLabel = t("history.updateCount", { count: featureCount });

  return (
    <li className={cn(!isLast && "border-b border-border/40")}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex w-full items-center gap-3 py-3 text-left">
          <DisclosureChevron open={open} />
          <span className="flex flex-1 items-baseline gap-2">
            <span className="text-xs text-muted-foreground">{entry.date}</span>
            <span className="text-sm font-semibold text-foreground">
              {t("history.version", { version: entry.version })}
            </span>
            <span className="text-xs text-muted-foreground/70">({featureLabel})</span>
          </span>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="flex flex-col gap-6 pb-4 pl-6 pr-1">
            {entry.features.map((feature) => (
              <FeatureSection key={feature.id} feature={feature} />
            ))}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </li>
  );
}
