// FILE: SegmentedControl.tsx
// Purpose: Compact single-select segmented control used by the server editor.
// Layer: Settings UI components (servers)

import { cn } from "~/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex w-full rounded-lg border border-[color:var(--color-border)] bg-[var(--color-background-elevated-secondary)] p-0.5"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "servers-press flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-150",
              selected
                ? "bg-[var(--color-background-elevated-primary-opaque)] text-[var(--color-text-foreground)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                : "text-muted-foreground hover:text-[var(--color-text-foreground)]",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
