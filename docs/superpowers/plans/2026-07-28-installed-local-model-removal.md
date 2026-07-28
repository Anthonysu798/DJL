# Installed Local Model Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, visible Delete button to Ollama rows in the always-visible Installed models section and remove the hidden duplicate management list.

**Architecture:** Keep the existing `localModels.removeModel` mutation and native confirmation dialog. Build the primary row actions from the installed model and the active mutation, while LM Studio continues to delegate removal to its own app. No server or contract changes are needed.

**Tech Stack:** React 19, TypeScript, TanStack Query, react-i18next, Vitest Browser with Playwright, Electron native API.

## Global Constraints

- The always-visible **Installed models** section is the only installed-model management list.
- Ollama deletion requires the existing native confirmation dialog and exact runtime/model identifier.
- LM Studio removal remains delegated to **Manage in LM Studio**.
- The recommendation shelf does not gain destructive actions.
- Only one local-model mutation may run at a time; the target row says **Deleting…** while pending.
- Add native-quality copy to `en`, `es-419`, `fr`, `ja`, `ko`, `zh-Hans`, and `zh-Hant`.
- Do not change the local-model IPC or server removal contract.
- End-to-end deletion may target only a disposable Ollama model created specifically for the test.

---

### Task 1: Installed-model removal regression tests

**Files:**
- Create: `apps/web/src/components/settings/LocalModelsSettingsPanel.browser.tsx`
- Modify: `apps/web/src/components/settings/LocalModelsSettingsPanel.test.ts`

**Interfaces:**
- Consumes: `LocalModelsSettingsPanel`, `LocalModelsSnapshot`, Electron `nativeApi.localModels` and `nativeApi.dialogs.confirm`.
- Produces: browser coverage for visible controls and a unit-level contract for exact Ollama removal actions.

- [ ] **Step 1: Add the failing unit contract**

Import `installedModelRemovalAction` from `LocalModelsSettingsPanel` and assert:

```ts
expect(
  installedModelRemovalAction({
    runtime: "ollama",
    modelId: "qwen3.5:2b-q4_K_M",
    name: "Qwen3.5 2B",
    sizeBytes: 1.8 * 1024 ** 3,
    supportsToolCalls: true,
  }),
).toEqual({
  type: "remove",
  runtime: "ollama",
  modelId: "qwen3.5:2b-q4_K_M",
});
```

Also assert that an LM Studio model returns `null`.

- [ ] **Step 2: Add the failing browser behavior**

Render `LocalModelsSettingsPanel` inside a `QueryClientProvider` and `I18nextProvider` with one
Ollama and one LM Studio installed model. Mock the native API and verify:

```ts
await expect.element(page.getByRole("button", { name: "Delete" })).toBeVisible();
await expect.element(page.getByRole("button", { name: "Manage in LM Studio" })).toBeVisible();
await page.getByRole("button", { name: "Delete" }).click();
expect(confirm).toHaveBeenCalledWith("Remove Qwen3.5 2B from Ollama?");
expect(removeModel).toHaveBeenCalledWith({
  runtime: "ollama",
  modelId: "qwen3.5:2b-q4_K_M",
});
```

Cover confirmation cancellation, an unresolved removal promise showing **Deleting…**, disabled
duplicate submission, and absence of **Manage installed models** after opening **More options**.

- [ ] **Step 3: Run both tests and verify RED**

Run:

```bash
bun run --cwd apps/web test -- LocalModelsSettingsPanel.test.ts
bun run --cwd apps/web test:browser -- LocalModelsSettingsPanel.browser.tsx
```

Expected: failures because `installedModelRemovalAction`, the visible Delete control, and the new
localized labels do not exist yet.

### Task 2: Visible removal controls and localized pending state

**Files:**
- Modify: `apps/web/src/components/settings/LocalModelsSettingsPanel.tsx`
- Modify: `apps/web/src/i18n/locales/en.json`
- Modify: `apps/web/src/i18n/locales/es-419.json`
- Modify: `apps/web/src/i18n/locales/fr.json`
- Modify: `apps/web/src/i18n/locales/ja.json`
- Modify: `apps/web/src/i18n/locales/ko.json`
- Modify: `apps/web/src/i18n/locales/zh-Hans.json`
- Modify: `apps/web/src/i18n/locales/zh-Hant.json`

**Interfaces:**
- Consumes: existing `LocalModelAction`, `actionMutation`, native confirmation dialog, success/error toasts, and LM Studio management URL.
- Produces: `installedModelRemovalAction(model)` and primary installed-row actions.

- [ ] **Step 1: Add the minimal removal-action helper**

```ts
export function installedModelRemovalAction(
  model: LocalInstalledModel,
): Extract<LocalModelAction, { readonly type: "remove" }> | null {
  return model.runtime === "ollama"
    ? { type: "remove", runtime: "ollama", modelId: model.modelId }
    : null;
}
```

- [ ] **Step 2: Move model management into the visible list**

For each installed row, derive its key, removal action, and pending state:

```ts
const removalAction = installedModelRemovalAction(model);
const removing =
  actionMutation.isPending &&
  actionMutation.variables?.type === "remove" &&
  actionMutation.variables.runtime === model.runtime &&
  actionMutation.variables.modelId === model.modelId;
```

Render the existing Installed badge plus:

```tsx
<Button
  size="xs"
  variant="destructive-outline"
  disabled={actionMutation.isPending}
  aria-label={t("localModels.removeAriaLabel", { model: model.name })}
  onClick={async () => {
    const confirmed = await ensureNativeApi().dialogs.confirm(
      t("localModels.removeConfirmation", { model: model.name }),
    );
    if (confirmed && removalAction) actionMutation.mutate(removalAction);
  }}
>
  {removing ? <Loader2Icon className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
  {t(removing ? "localModels.removing" : "localModels.removeButton")}
</Button>
```

For LM Studio, render the existing **Manage in LM Studio** action. Remove the duplicate
`manageInstalledTitle` settings section from **More options**.

- [ ] **Step 3: Add all localized labels**

Add `localModels.removeButton` and `localModels.removing` to all seven catalogs using reviewed,
native-quality translations. Keep `removeAriaLabel` and `removeConfirmation` model interpolation.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
bun run --cwd apps/web test -- LocalModelsSettingsPanel.test.ts
bun run --cwd apps/web test:browser -- LocalModelsSettingsPanel.browser.tsx
bun run i18n:check
```

Expected: all commands exit 0 with the removal contract, browser behavior, and locale parity green.

- [ ] **Step 5: Commit the implementation**

```bash
git add apps/web/src/components/settings/LocalModelsSettingsPanel.tsx \
  apps/web/src/components/settings/LocalModelsSettingsPanel.test.ts \
  apps/web/src/components/settings/LocalModelsSettingsPanel.browser.tsx \
  apps/web/src/i18n/locales
git commit -m "feat: expose installed model removal"
```

### Task 3: Integrated and Electron end-to-end verification

**Files:**
- No production files expected.

**Interfaces:**
- Consumes: committed installed-model removal UI and existing Electron/Ollama integration.
- Produces: fresh automated and Computer Use evidence.

- [ ] **Step 1: Run static and full Desktop gates**

```bash
bun run ci:desktop:typecheck
bun run ci:desktop:lint
bun run ci:desktop:format
bun run i18n:check
bun run ci:desktop:test
bun run ci:desktop:browser
```

Expected: every command exits 0 with zero test failures, type errors, lint errors, formatting drift,
or locale parity failures.

- [ ] **Step 2: Start Electron Dev from the feature worktree**

Use the repository Electron development command with an isolated disposable profile when supported.
Wait for the server, renderer, and Electron window to report ready before interaction.

- [ ] **Step 3: Verify cancellation with Computer Use**

Open Settings → Local Models, locate a disposable Ollama model in **Installed models**, click
**Delete**, cancel the confirmation, and verify the row remains and no download/runtime state changes.

- [ ] **Step 4: Verify successful deletion with Computer Use**

Confirm deletion for the same disposable model and verify:

- the row shows **Deleting…** while the request is pending when observable;
- the row disappears after completion;
- the model no longer appears in Ollama inventory or chat model discovery;
- the rest of the Local Models settings page remains responsive.

- [ ] **Step 5: Preserve user data and record evidence**

Do not remove any pre-existing user model. If no disposable model can be created safely, complete the
cancel path against an existing model and verify successful removal using a controlled test fixture
instead of mutating user data.
