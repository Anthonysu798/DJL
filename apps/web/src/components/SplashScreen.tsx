// FILE: SplashScreen.tsx
// Purpose: Show startup progress and actionable route recovery failures.
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
    return (
      <div role="status" aria-live="polite" className="flex min-h-0 flex-1 flex-col p-6">
        <div aria-hidden="true" className="h-4 w-40 rounded bg-muted" />
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-current motion-safe:animate-pulse"
          />
          {t("common:loading")}
        </div>
        <div
          aria-hidden="true"
          className="mx-auto h-24 w-full max-w-3xl rounded-2xl border border-border/60 bg-muted/30"
        />
      </div>
    );
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
