# Hide the Work Plan Checklist

## Goal

Remove the duplicated `PLAN` checklist from the Work task status panel. The task list shown above the composer remains the single visible checklist.

## Scope

- Stop deriving checklist rows from `turn.tasks.updated` activities inside `WorkTaskPanel`.
- Remove the `PLAN` heading and checklist markup from the panel.
- Continue rendering captured deliverables independently when they exist.
- Preserve the task status, progress bar, phase labels, document preparation UI, activity disclosure, and composer task panel.

## Implementation

Delete the panel-local checklist extraction helper, memoized checklist value, and checklist branch. Simplify the summary area so it is rendered only when captured deliverables exist.

## Verification

Update the focused `WorkTaskPanel` test to assert that checklist task text is absent while deliverables and review actions remain visible. Run the focused Vitest test file with `bun run test`.
