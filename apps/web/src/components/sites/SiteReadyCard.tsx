// FILE: SiteReadyCard.tsx
// Purpose: Transcript card the Website tool leaves when a site is built and checked. Shows
//          what will be published and opens the Publish dialog; nothing goes online without it.
// Layer: Chat transcript UI

import type { ThreadId } from "@djl/contracts";
import { createContext, memo, useContext, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "~/components/ui/button";
import { GlobeIcon } from "~/lib/icons";
import type { WorkLogSiteReady } from "~/session-logic";

import { PublishSiteDialog } from "./PublishSiteDialog";

/** The chat whose transcript is showing; the card publishes that chat's project. */
export const SiteThreadContext = createContext<ThreadId | null>(null);

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const SiteReadyCard = memo(function SiteReadyCard({
  site,
  textFontSizePx,
  metaFontSizePx,
}: {
  readonly site: WorkLogSiteReady;
  readonly textFontSizePx?: number;
  readonly metaFontSizePx?: number;
}) {
  const { t } = useTranslation("chat");
  const threadId = useContext(SiteThreadContext);
  const [open, setOpen] = useState(false);
  const address = site.linkedSiteUrl?.replace(/^https:\/\//, "") ?? null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-primary)] px-3 py-2.5">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-secondary)] text-[var(--color-text-foreground)]">
        <GlobeIcon className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className="truncate font-medium text-[var(--color-text-foreground)]"
          style={textFontSizePx ? { fontSize: `${textFontSizePx}px` } : undefined}
        >
          {address ? t("sites.cardUpdateTitle", { address }) : t("sites.cardTitle")}
        </p>
        <p
          className="truncate text-[var(--color-text-foreground-secondary)] tabular-nums"
          style={metaFontSizePx ? { fontSize: `${metaFontSizePx}px` } : undefined}
        >
          {t("sites.cardMeta", { count: site.fileCount, size: formatBytes(site.bytes) })}
        </p>
      </div>
      {threadId ? (
        <>
          <Button type="button" size="sm" className="shrink-0" onClick={() => setOpen(true)}>
            {address ? t("sites.republish") : t("sites.publish")}
          </Button>
          <PublishSiteDialog threadId={threadId} open={open} onOpenChange={setOpen} />
        </>
      ) : null}
    </div>
  );
});
