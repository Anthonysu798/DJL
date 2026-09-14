import type { ReactNode } from "react";

/** A titled white panel. The dot before the title echoes the reference and marks the section. */
export function PageCard({
  title,
  action,
  children,
  className = "",
}: {
  title?: string | undefined;
  action?: ReactNode | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel p-6 ${className}`}>
      {title || action ? (
        <div className="mb-5 flex items-center justify-between gap-3">
          {title ? (
            <h2 className="flex items-center gap-3 text-lg font-medium">
              <span className="size-2.5 rounded-full bg-primary ring-4 ring-primary/15" />
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export const rowClass = "border-border/70";
export const headRowClass = "border-border hover:bg-transparent";

export function StatusPill({
  tone,
  children,
}: {
  tone: "success" | "danger" | "neutral";
  children: ReactNode;
}) {
  const cls =
    tone === "success"
      ? "bg-success-bg text-success-fg"
      : tone === "danger"
        ? "bg-danger-bg text-danger-fg"
        : "bg-secondary text-secondary-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

/** Initials avatar used in user tables. */
export function Initials({ name, className = "" }: { name: string; className?: string }) {
  const parts = name
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean);
  const text = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
  return (
    <span
      className={`grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-sm font-medium text-secondary-foreground ${className}`}
    >
      {text}
    </span>
  );
}
