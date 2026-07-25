# Hide the Work Plan Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the duplicated plan checklist from the Work task status panel while preserving deliverables and the composer task panel.

**Architecture:** Keep `WorkTaskPanel` responsible for task lifecycle status and captured outputs, but stop projecting `turn.tasks.updated` events into a second checklist. The component will render the deliverables summary directly when captured files exist.

**Tech Stack:** React, TypeScript, React DOM server rendering, Vitest, Bun

## Global Constraints

- Preserve the task status, progress bar, phase labels, document preparation UI, activity disclosure, and composer task panel.
- Continue rendering captured deliverables independently when they exist.
- Run focused tests with `bun run test`; never use `bun test`.
- Do not run `bun fmt`, `bun lint`, or `bun typecheck` because the user did not explicitly request those heavyweight checks.

---

### Task 1: Remove the duplicated Work checklist

**Files:**

- Modify: `apps/web/src/components/work/WorkTaskPanel.tsx`
- Test: `apps/web/src/components/work/WorkTaskPanel.test.tsx`

**Interfaces:**

- Consumes: `WorkTaskPanelProps.activities` for captured deliverables, recent activity, and document-preparation state.
- Produces: `WorkTaskPanel`, whose rendered status panel omits checklist task text while retaining captured deliverable links.

- [x] **Step 1: Change the focused rendering test to describe the desired UI**

Rename the main test and replace the checklist-presence assertion with absence assertions:

```tsx
it("shows status, progress, deliverables, and review actions without a duplicate plan", () => {
  const markup = renderLocalized(
    <WorkTaskPanel
      task={task}
      activities={activities}
      busy={false}
      onComplete={() => undefined}
      onRequestChanges={() => undefined}
      onRetry={() => undefined}
      onReopen={() => undefined}
      onCancel={() => undefined}
      onProvideInput={() => undefined}
    />,
  );

  expect(markup).toContain("Needs review");
  expect(markup).toContain('aria-valuenow="90"');
  expect(markup).toContain('aria-current="step"');
  expect(markup).not.toContain("Read source workbook");
  expect(markup).not.toContain(">Plan<");
  expect(markup).toContain("Outbox/Q2-report.docx");
  expect(markup).toContain("Request changes");
  expect(markup).toContain("Complete task");
});
```

- [x] **Step 2: Run the focused test and verify the new assertion fails**

Run:

```bash
bun run test apps/web/src/components/work/WorkTaskPanel.test.tsx
```

Expected: the updated test fails because `Read source workbook` and the `Plan` heading are still present in the rendered markup.

- [x] **Step 3: Remove checklist derivation and render deliverables independently**

Delete `latestChecklist`, delete the memoized `checklist` value, and replace the combined checklist/deliverables branch with a deliverables-only branch:

```tsx
{
  deliverables.length > 0 ? (
    <div className="border-t border-border/50 pt-3">
      <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("task.deliverables", { ns: "work" })}
      </h3>
      <ul className="space-y-1 text-xs">
        {deliverables.map((path) => (
          <li key={path}>
            <button
              type="button"
              onClick={() => void openDeliverable(path)}
              className="block w-full truncate rounded px-1 py-0.5 text-left font-mono text-[11px] text-foreground/85 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring/60"
              title={t("documents.openNamed", { ns: "work", name: path })}
            >
              {path}
            </button>
          </li>
        ))}
      </ul>
      {deliverableError ? (
        <WorkErrorMessage error={deliverableError} className="mt-1 text-[11px] text-destructive" />
      ) : null}
    </div>
  ) : null;
}
```

- [x] **Step 4: Run the focused test and verify it passes**

Run:

```bash
bun run test apps/web/src/components/work/WorkTaskPanel.test.tsx
```

Expected: all tests in `WorkTaskPanel.test.tsx` pass, including absence of the duplicated plan and continued presence of the deliverable.

- [x] **Step 5: Review the scoped diff**

Run:

```bash
git diff --check -- apps/web/src/components/work/WorkTaskPanel.tsx apps/web/src/components/work/WorkTaskPanel.test.tsx
git diff -- apps/web/src/components/work/WorkTaskPanel.tsx apps/web/src/components/work/WorkTaskPanel.test.tsx
```

Expected: no whitespace errors; the diff contains only checklist removal, deliverables-only rendering, and the focused test update.
