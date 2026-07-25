import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export function settingsLoadErrorDetail(error: unknown, localizedFallback: string): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : localizedFallback;
}

export function SettingsLoadError({
  summary,
  detail,
  actionLabel,
  onAction,
  className,
}: {
  summary: string;
  detail: string;
  actionLabel: string;
  onAction: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn("flex items-start justify-between gap-4 px-4 py-3.5", className)}
    >
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium text-destructive">{summary}</p>
        <p className="break-words text-xs text-muted-foreground">{detail}</p>
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}
