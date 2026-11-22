// FILE: stepper.tsx
// Purpose: A vertical list of steps for guided flows: a numbered marker per step that
//          turns into a spinner, a check or a warning, joined by a rail.
// Layer: UI primitive
// Exports: Stepper, StepperItem, StepperTitle, StepperDescription
// The parts follow the shape of Origin UI's stepper so it reads like the rest of the kit.

import type { ComponentProps, ReactNode } from "react";

import { CheckIcon, Loader2Icon, TriangleAlertIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";

export type StepState = "pending" | "active" | "loading" | "done" | "success" | "error";

const MARKER_CLASS_NAME: Record<StepState, string> = {
  pending: "border border-border text-muted-foreground",
  active: "border border-foreground/70 text-foreground",
  loading: "border border-foreground/25 text-foreground",
  done: "bg-foreground text-background",
  success: "bg-emerald-600 text-white",
  error: "bg-destructive/15 text-destructive",
};

export function Stepper({ className, ...props }: ComponentProps<"ol">) {
  return <ol className={cn("flex flex-col", className)} data-slot="stepper" {...props} />;
}

export function StepperItem({
  step,
  state,
  className,
  children,
  ...props
}: Omit<ComponentProps<"li">, "children"> & {
  step: number;
  state: StepState;
  children: ReactNode;
}) {
  const current = state === "active" || state === "loading" || state === "error";
  return (
    <li
      className={cn("group/step relative flex gap-3 pb-5 last:pb-0", className)}
      data-slot="stepper-item"
      data-state={state}
      aria-current={current ? "step" : undefined}
      {...props}
    >
      {/* The rail to the next step; it darkens once this step is behind the user. */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-7 bottom-1 left-3 w-px -translate-x-1/2 group-last/step:hidden",
          "transition-colors duration-200 motion-reduce:transition-none",
          state === "done" || state === "success" ? "bg-foreground/40" : "bg-border",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium tabular-nums",
          "transition-colors duration-200 motion-reduce:transition-none",
          MARKER_CLASS_NAME[state],
        )}
      >
        {state === "loading" ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : state === "done" || state === "success" ? (
          <CheckIcon className="size-3.5" />
        ) : state === "error" ? (
          <TriangleAlertIcon className="size-3.5" />
        ) : (
          step
        )}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
    </li>
  );
}

export function StepperTitle({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "text-sm leading-5 font-medium text-foreground",
        "group-data-[state=pending]/step:text-muted-foreground",
        className,
      )}
      data-slot="stepper-title"
      {...props}
    />
  );
}

export function StepperDescription({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-1 text-sm leading-snug text-muted-foreground", className)}
      data-slot="stepper-description"
      {...props}
    />
  );
}
