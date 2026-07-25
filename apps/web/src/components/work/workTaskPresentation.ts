// FILE: workTaskPresentation.ts
// Purpose: Single source for user-facing Work lifecycle labels and visual tones.

import type { WorkTaskStatus } from "@synara/contracts";

export const WORK_TASK_STATUS_TONES: Record<WorkTaskStatus, string> = {
  planning: "border-sky-500/25 bg-sky-500/8 text-sky-700 dark:text-sky-300",
  working: "border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-300",
  needs_input: "border-violet-500/25 bg-violet-500/8 text-violet-700 dark:text-violet-300",
  needs_review: "border-blue-500/25 bg-blue-500/8 text-blue-700 dark:text-blue-300",
  complete: "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300",
  failed: "border-destructive/25 bg-destructive/8 text-destructive",
  cancelled: "border-border bg-muted/40 text-muted-foreground",
};
