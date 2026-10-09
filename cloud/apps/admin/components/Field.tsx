import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";

/**
 * Label + control + inline error. The error is rendered in red under the
 * control and announced to screen readers; the control gets `aria-invalid`
 * through the `invalid` helper so its border turns red too.
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Props to spread on the control inside a Field. */
export function invalid(id: string, error: string | null | undefined) {
  return error
    ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` }
    : { "aria-invalid": false as const };
}

/** A form-level error banner, for API failures that are not about one field. */
export function FormError({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive"
    >
      {error}
    </p>
  );
}
