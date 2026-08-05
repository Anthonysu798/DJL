// FILE: ReleaseHistoryDialog.tsx
// Purpose: Standalone dialog that shows the full curated release history. Used
// by the Settings > About row so users can revisit any past release notes on
// demand — mirrors the "Complete changelog" view of the post-update dialog
// without the "current release" anchor.
// Layer: Settings overlay — mounted lazily from the settings panel when the
// user asks to view history.

import { ChangelogAccordion } from "../whatsNew/ChangelogAccordion";
import { useTranslation } from "react-i18next";
import {
  resolveDefaultReleaseVersion,
  sortEntriesByVersionDesc,
  type WhatsNewEntry,
} from "../whatsNew/logic";
import { useGithubReleases } from "../whatsNew/useGithubReleases";
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

export interface ReleaseHistoryDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Entries to display. Defaults to the full curated list; callers can
   * override in tests or storybook scenarios without poking at module state.
   */
  readonly entries?: readonly WhatsNewEntry[];
  /**
   * Version to expand by default (usually the installed build). `null`
   * leaves every row collapsed so the user scans dates-first.
   */
  readonly defaultExpandedVersion?: string | null;
  readonly currentVersion?: string | null;
}

export default function ReleaseHistoryDialog({
  open,
  onOpenChange,
  entries,
  defaultExpandedVersion,
  currentVersion = null,
}: ReleaseHistoryDialogProps) {
  const { t } = useTranslation("whatsNew");
  const releaseFeed = useGithubReleases();
  const resolvedEntries = entries ?? releaseFeed.releases;
  const sorted = sortEntriesByVersionDesc(resolvedEntries);
  const resolvedExpandedVersion =
    defaultExpandedVersion !== undefined
      ? defaultExpandedVersion
      : resolveDefaultReleaseVersion(sorted, currentVersion);
  const showLoading =
    entries === undefined && releaseFeed.status === "loading" && sorted.length === 0;
  const showError = entries === undefined && releaseFeed.status === "error" && sorted.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg gap-0 p-0">
        <DialogHeader className="gap-1 p-4 pr-12">
          <DialogTitle className="text-base">{t("history.releaseTitle")}</DialogTitle>
          <DialogDescription className="text-xs">{t("history.description")}</DialogDescription>
        </DialogHeader>

        <DialogPanel className="max-h-[min(62vh,520px)] px-4 py-3">
          {showLoading ? (
            <p className="text-xs text-muted-foreground">{t("history.loading")}</p>
          ) : showError ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">{t("history.unavailable")}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={releaseFeed.retry}>
                  {t("actions.retry")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  render={<a href={releaseFeed.releasesUrl} target="_blank" rel="noreferrer" />}
                >
                  {t("actions.viewOnGithub")}
                </Button>
              </div>
            </div>
          ) : (
            <ChangelogAccordion entries={sorted} defaultExpandedVersion={resolvedExpandedVersion} />
          )}
        </DialogPanel>

        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            {t("actions.close")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
