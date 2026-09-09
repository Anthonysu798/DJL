// FILE: ServerImportDialog.tsx
// Purpose: Preview and import hosts from ~/.ssh/config.
// Layer: Settings UI components (servers)

import type { ServerImportPreviewResult } from "@synara/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { LoaderCircleIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

export interface ServerImportDialogProps {
  open: boolean;
  preview: ServerImportPreviewResult | null;
  loading: boolean;
  importing: boolean;
  onClose: () => void;
  onImport: (aliases: string[]) => void;
}

export function ServerImportDialog({
  open,
  preview,
  loading,
  importing,
  onClose,
  onImport,
}: ServerImportDialogProps) {
  const { t } = useTranslation("settings");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!preview) return;
    setSelected(new Set(preview.candidates.filter((c) => !c.alreadyImported).map((c) => c.alias)));
  }, [preview]);

  const toggle = (alias: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(alias);
      else next.delete(alias);
      return next;
    });

  const importable = preview?.candidates.filter((c) => !c.alreadyImported) ?? [];

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : undefined)}>
      <DialogPopup className="max-w-lg gap-0 p-0">
        <DialogHeader className="gap-1 p-4 pr-12">
          <DialogTitle className="text-base">{t("servers.import.title")}</DialogTitle>
          <DialogDescription className="text-xs">
            {preview
              ? preview.candidates.length > 0
                ? t("servers.import.body", {
                    count: preview.candidates.length,
                    path: preview.configPath,
                  })
                : t("servers.import.none", { path: preview.configPath })
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="max-h-[min(60vh,480px)] px-4 py-3">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircleIcon className="animate-spin" />
              {t("servers.status.testing")}
            </div>
          ) : (
            <ul className="divide-y divide-[color:var(--color-border)]">
              {preview?.candidates.map((candidate, index) => {
                const checked = selected.has(candidate.alias);
                return (
                  <li
                    key={candidate.alias}
                    className="servers-row-enter flex items-center gap-3 py-2"
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={candidate.alreadyImported}
                      aria-label={candidate.alias}
                      onCheckedChange={(value) => toggle(candidate.alias, value === true)}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "truncate text-xs font-medium",
                          candidate.alreadyImported && "text-muted-foreground",
                        )}
                      >
                        {candidate.alias}
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {candidate.username ? `${candidate.username}@` : ""}
                        {candidate.host}
                        {candidate.port === 22 ? "" : `:${candidate.port}`}
                      </div>
                    </div>
                    {candidate.alreadyImported ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {t("servers.import.alreadyAdded")}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            className="servers-press"
            onClick={onClose}
            disabled={importing}
          >
            {t("servers.actions.cancel")}
          </Button>
          <Button
            size="sm"
            className="servers-press"
            disabled={importing || loading || selected.size === 0 || importable.length === 0}
            onClick={() => onImport([...selected])}
          >
            {importing ? <LoaderCircleIcon className="animate-spin" /> : null}
            {t("servers.actions.importSelected", { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
