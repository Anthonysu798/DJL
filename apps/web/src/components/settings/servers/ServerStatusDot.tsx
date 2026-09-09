// FILE: ServerStatusDot.tsx
// Purpose: Small status indicator for a registered server (breathes while busy).
// Layer: Settings UI components (servers)

import { cn } from "~/lib/utils";

export type ServerStatusTone = "neutral" | "success" | "warning" | "danger";

const TONE_CLASS: Record<ServerStatusTone, string> = {
  neutral: "bg-[var(--color-text-foreground-secondary)]/40",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

export function ServerStatusDot({
  tone,
  busy,
  label,
}: {
  tone: ServerStatusTone;
  busy: boolean;
  label: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-tone={tone}
      data-busy={busy ? "true" : undefined}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        TONE_CLASS[tone],
        busy && "servers-dot-breathe",
      )}
    />
  );
}
