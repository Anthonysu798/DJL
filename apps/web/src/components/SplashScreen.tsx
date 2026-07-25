// FILE: SplashScreen.tsx
// Purpose: Keep route recovery visually quiet while preserving actionable failure feedback.
// Layer: Shared app loading presentation

import { useTranslation } from "react-i18next";

export function SplashScreen({
  errorMessage,
  errorDetail,
  onRetry,
}: {
  errorMessage?: string | null;
  errorDetail?: string | null;
  onRetry?: (() => void) | null;
}) {
  const { t } = useTranslation("shell");

  if (!errorMessage) {
    return null;
  }

  return (
    <div className="m-auto flex max-w-sm flex-col items-center gap-3 px-6 text-center">
      <span className="text-sm text-muted-foreground/75">{errorMessage}</span>
      {errorDetail ? (
        <span className="break-words text-xs text-muted-foreground/60">{errorDetail}</span>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          className="rounded-md border border-border/70 px-3 py-1.5 text-sm text-foreground/85 transition-colors hover:bg-[var(--sidebar-accent)]"
          onClick={onRetry}
        >
          {t("recovery.retry")}
        </button>
      ) : null}
    </div>
  );
}
