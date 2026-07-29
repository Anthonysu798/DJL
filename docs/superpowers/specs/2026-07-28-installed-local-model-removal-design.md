# Installed Local Model Removal

## Goal

Make local-model removal obvious by placing the removal control directly in the always-visible
**Installed models** section shown beneath active downloads.

## Interaction

- Every installed Ollama model row shows its existing **Installed** badge and a
  destructive-outline **Delete** button.
- Selecting **Delete** opens the existing native confirmation dialog with the model name.
- Confirming removes the model through `localModels.removeModel`; cancelling leaves it untouched.
- While any local-model mutation is running, removal controls are disabled. The model being removed
  displays **Deleting…** so the user has immediate feedback and cannot submit the action twice.
- Success refreshes the local-model snapshot, removes the row, refreshes provider discovery through
  the existing inventory-change effect, and shows the existing success toast.
- Failure keeps the row visible, restores the button, and shows the existing detailed failure toast.
- LM Studio rows show **Manage in LM Studio** instead of **Delete**, because the server deliberately
  delegates LM Studio file removal to the LM Studio application.

## Information Architecture

The always-visible **Installed models** section is the single model-management surface. The duplicate
**Manage installed models** list is removed from **More options**. The recommendation shelf remains
focused on choosing, installing, and reporting model readiness; it does not gain destructive actions.

## Localization and Accessibility

- Add concise localized labels for **Delete model** and **Deleting…** to all seven production locale
  catalogs: English, Simplified Chinese, Traditional Chinese, Japanese, Korean, Latin American
  Spanish, and French.
- Keep the existing localized confirmation and screen-reader label, including the model name.
- The text button remains keyboard accessible and has a sufficiently large target compared with the
  previous icon-only control.

## Verification

- A settings-panel source/contract test proves that the visible installed-model section owns the
  confirmation and removal action and that the advanced duplicate is gone.
- A browser test renders Ollama and LM Studio installed rows, verifies the primary controls, confirms
  Ollama removal forwards the exact runtime and model ID, verifies cancellation, and checks the
  pending state.
- Run focused web tests, localization parity, typecheck, lint, formatting, and the full Desktop test
  gate.
- Start Electron Dev and use Computer Use to confirm the visible button, cancellation behavior, and
  successful removal of a disposable Ollama test model. Do not delete a user model without first
  creating or selecting a disposable model specifically for the test.

## Non-goals

- Direct LM Studio file deletion.
- Removal controls on recommendation cards.
- Bulk removal, undo, or automatic model cleanup.
- Changes to the local-model IPC or server removal contract.
