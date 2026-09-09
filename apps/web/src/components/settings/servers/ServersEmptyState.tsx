// FILE: ServersEmptyState.tsx
// Purpose: Empty state for the Servers settings section with a self-drawing prompt glyph.
// Layer: Settings UI components (servers)

import { useTranslation } from "react-i18next";

import { Button } from "~/components/ui/button";

function PromptGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 48"
      className="size-12 shrink-0 text-[var(--color-text-foreground-secondary)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path className="servers-stroke-draw" d="M10 14l10 10-10 10" />
      <path className="servers-stroke-draw" style={{ animationDelay: "180ms" }} d="M24 34h14" />
      <rect
        className="servers-cursor-blink"
        x="40"
        y="30"
        width="2"
        height="8"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

export function ServersEmptyState({
  onAdd,
  onImport,
}: {
  onAdd: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <span className="inline-flex size-16 items-center justify-center rounded-full bg-[var(--color-background-elevated-secondary)]">
        <PromptGlyph />
      </span>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-[var(--color-text-foreground)]">
          {t("servers.empty.title")}
        </h3>
        <p className="max-w-[44ch] text-xs leading-relaxed text-muted-foreground">
          {t("servers.empty.body")}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        <Button size="sm" className="servers-press" onClick={onAdd}>
          {t("servers.actions.add")}
        </Button>
        <Button size="sm" variant="outline" className="servers-press" onClick={onImport}>
          {t("servers.actions.import")}
        </Button>
      </div>
    </div>
  );
}
