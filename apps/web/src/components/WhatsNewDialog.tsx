// FILE: WhatsNewDialog.tsx
// Purpose: Render the one-time "What's new" release-notes dialog shown after
// an update. Two views: a default "What's new?" card stack anchored on the
// installed release, and a secondary "Complete changelog" accordion spanning
// every curated release. Open/close state and the underlying data are owned
// by `useWhatsNew`; this component is pure presentation.
// Layer: Chat shell overlay (mounted once from the root route).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ArrowLeftIcon, ArrowRightIcon } from "~/lib/icons";
import { DjlLogo } from "~/components/DjlLogo";

import { ChangelogAccordion } from "../whatsNew/ChangelogAccordion";
import { FeatureSection } from "../whatsNew/FeatureSection";
import { localizeWhatsNewEntry, type WhatsNewEntry } from "../whatsNew/logic";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

type View = "current" | "changelog";

export interface WhatsNewDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * The entry matching the installed build. `null` means "nothing to show" —
   * the hook only flips `open=true` when we have an entry, so normally this is
   * non-null while the dialog is visible. We still guard against the null
   * case to keep the UI tolerant of mid-transition re-renders.
   */
  readonly currentEntry: WhatsNewEntry | null;
  /** Full curated history, newest-first, for the changelog accordion. */
  readonly allEntries: readonly WhatsNewEntry[];
  readonly currentVersion: string;
}

export default function WhatsNewDialog({
  open,
  onOpenChange,
  currentEntry,
  allEntries,
  currentVersion,
}: WhatsNewDialogProps) {
  const { t, i18n } = useTranslation("whatsNew");
  const [view, setView] = useState<View>("current");

  // Reset back to the primary view whenever the dialog re-opens so the next
  // release doesn't boot into the secondary "Complete changelog" screen just
  // because the user left it there on a previous open.
  useEffect(() => {
    if (open) {
      setView("current");
    }
  }, [open]);

  // Guard against a race where the hook has already reset but base-ui is
  // still transitioning — rendering an empty card would briefly flash a
  // confusing empty state.
  if (!currentEntry) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogPopup className="max-w-md" />
      </Dialog>
    );
  }
  const localizedCurrentEntry = localizeWhatsNewEntry(
    currentEntry,
    t,
    true,
    i18n.resolvedLanguage ?? i18n.language,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg gap-0 p-0" showCloseButton={false}>
        <DialogHeader className="gap-1 p-4 pr-12">
          {view === "current" ? (
            <CurrentHeader entry={localizedCurrentEntry} currentVersion={currentVersion} />
          ) : (
            <ChangelogHeader onBack={() => setView("current")} />
          )}
        </DialogHeader>

        <DialogPanel className="max-h-[min(62vh,520px)] px-4 py-3">
          {view === "current" ? (
            <div className="flex flex-col gap-8 py-1">
              {localizedCurrentEntry.features.map((feature) => (
                <FeatureSection key={feature.id} feature={feature} />
              ))}
            </div>
          ) : (
            <ChangelogAccordion
              entries={allEntries}
              defaultExpandedVersion={currentEntry.version}
              currentVersion={currentVersion}
            />
          )}
        </DialogPanel>

        {view === "current" && (
          <DialogFooter className="sm:justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
              onClick={() => setView("changelog")}
            >
              {t("actions.viewChangelog")}
              <ArrowRightIcon className="size-3" />
            </Button>
            <Button size="sm" onClick={() => onOpenChange(false)}>
              {t("actions.gotIt")}
            </Button>
          </DialogFooter>
        )}
      </DialogPopup>
    </Dialog>
  );
}

function CurrentHeader({
  entry,
  currentVersion,
}: {
  readonly entry: WhatsNewEntry;
  readonly currentVersion: string;
}) {
  const { t } = useTranslation("whatsNew");
  return (
    <div className="flex items-center gap-3">
      <DjlLogo aria-hidden className="size-8 shrink-0 text-foreground" />
      <div className="flex min-w-0 flex-col">
        <DialogTitle className="text-base">{t("titleQuestion")}</DialogTitle>
        <DialogDescription className="text-xs">
          v{currentVersion}
          <span aria-hidden="true"> · </span>
          {entry.date}
        </DialogDescription>
      </div>
    </div>
  );
}

function ChangelogHeader({ onBack }: { readonly onBack: () => void }) {
  const { t } = useTranslation("whatsNew");
  return (
    <div className="flex items-center gap-3">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={t("actions.backAriaLabel")}
        onClick={onBack}
      >
        <ArrowLeftIcon className="size-4" />
      </Button>
      <div className="flex min-w-0 flex-col">
        <DialogTitle className="text-base">{t("history.completeTitle")}</DialogTitle>
        <DialogDescription className="text-xs">{t("history.description")}</DialogDescription>
      </div>
    </div>
  );
}
