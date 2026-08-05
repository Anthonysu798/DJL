// FILE: whatsNew/ChangelogAccordion.tsx
// Purpose: Collapsible release-history accordion used by both the Settings
// "Release history" surface and the `WhatsNewDialog` "Complete changelog"
// secondary view. Each row summarises a release; expanding reveals the
// parsed GitHub notes for that version.
// Layer: presentational — it assumes the caller has already sorted entries
// newest-first (see `sortEntriesByVersionDesc`).

import { useState } from "react";

import { useTranslation } from "react-i18next";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { cn } from "~/lib/utils";

import { formatReleaseDate, type WhatsNewEntry } from "./logic";

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
}

export function ChangelogAccordion({
  entries,
  defaultExpandedVersion = null,
  className,
}: ChangelogAccordionProps) {
  const { i18n, t } = useTranslation("whatsNew");
  if (entries.length === 0) {
    return <p className={cn("text-xs text-muted-foreground", className)}>{t("history.empty")}</p>;
  }

  const showLanguageNotice = !i18n.resolvedLanguage?.startsWith("en");

  return (
    <div className={className}>
      {showLanguageNotice ? (
        <p className="mb-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {t("history.githubLanguageNotice")}
        </p>
      ) : null}
      <ul className="flex flex-col">
        {entries.map((entry, index) => (
          <ChangelogAccordionRow
            key={entry.version}
            entry={entry}
            defaultOpen={entry.version === defaultExpandedVersion}
            isLast={index === entries.length - 1}
            locale={i18n.resolvedLanguage ?? i18n.language}
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
  locale,
}: {
  readonly entry: WhatsNewEntry;
  readonly defaultOpen: boolean;
  readonly isLast: boolean;
  readonly locale: string;
}) {
  const { t } = useTranslation("whatsNew");
  const [open, setOpen] = useState(defaultOpen);

  const updateCount = entry.sections.reduce((count, section) => count + section.items.length, 0);
  const updateLabel = t("history.updateCount", { count: updateCount });

  return (
    <li className={cn(!isLast && "border-b border-border/40")}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex w-full items-center gap-3 py-3 text-left">
          <DisclosureChevron open={open} />
          <span className="flex flex-1 items-baseline gap-2">
            <span className="text-xs text-muted-foreground">
              {formatReleaseDate(entry.publishedAt, locale)}
            </span>
            <span className="text-sm font-semibold text-foreground">
              {t("history.version", { version: entry.version })}
            </span>
            {entry.prerelease ? (
              <span className="text-xs text-muted-foreground/70">{t("history.prerelease")}</span>
            ) : null}
            <span className="text-xs text-muted-foreground/70">({updateLabel})</span>
          </span>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <ReleaseNoteContent entry={entry} className="pb-4 pl-6 pr-1" />
        </CollapsiblePanel>
      </Collapsible>
    </li>
  );
}

export function ReleaseNoteContent({
  entry,
  className,
}: {
  readonly entry: WhatsNewEntry;
  readonly className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-5", className)}>
      {entry.intro.map((paragraph) => (
        <p key={paragraph} className="text-sm leading-6 text-muted-foreground">
          {paragraph}
        </p>
      ))}
      {entry.sections.map((section) => (
        <section key={section.heading} className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{section.heading}</h3>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
      <a
        href={entry.htmlUrl}
        target="_blank"
        rel="noreferrer"
        className="w-fit text-xs font-medium text-primary hover:underline"
      >
        GitHub
      </a>
    </div>
  );
}
