# LM Studio Effective Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DJL's managed LM Studio path reliably run OpenCode chat and tools by loading the selected model with a sufficient context window and advertising that same effective limit to OpenCode.

**Architecture:** Treat LM Studio's advertised model maximum, its currently loaded context, and DJL's effective OpenCode context as separate values. Keep LM Studio's global defaults untouched; before OpenCode starts a session, explicitly load or reload a DJL-managed, tool-capable model through `POST /api/v1/models/load` at the smallest supported agent-compatible window. Synchronize the verified load result into OpenCode so its token accounting and compaction use the real runtime limit.

**Tech Stack:** TypeScript, Effect, LM Studio native REST API v1, OpenCode SDK, Vitest, React, i18next, Electron

## Global Constraints

- Keep LM Studio and Ollama bound to their existing loopback endpoints: `127.0.0.1:1234` and `127.0.0.1:11434`.
- Do not edit `.lmstudio/settings.json`; it is LM Studio-owned state and its current `8192` default is not a reliable model capability.
- Do not automatically load a model at `max_context_length`; Granite advertises `131072`, which can allocate an unnecessarily large KV cache.
- Use `16_384` only as the OpenCode tool-compatibility floor. It is the smallest standard context bucket above the observed `8_391`-token tool prompt with useful response headroom, not a global LM Studio default.
- A model whose maximum context is below `16_384` must remain usable as chat-only and must not receive DJL/OpenCode tools.
- Automatically unload and reload an undersized instance only when DJL owns the managed LM Studio home. Never evict an instance from a user's external LM Studio installation without an explicit future UI action.
- An external LM Studio model already loaded below the tool floor remains chat-only until the user reloads it with at least `16_384`.
- Preserve Ollama behavior, including its runtime-selected context defaults and the existing chat-only tool gate.
- Keep LM Studio v0 behavior unchanged: inventory may be displayed, but the runtime remains `update_required` because model load management requires v1.
- Deduplicate concurrent readiness calls for the same LM Studio model so two sends cannot race an unload/load cycle.
- Use the LM Studio v1 list, load, and unload contracts documented at:
  - `https://lmstudio.ai/docs/developer/rest/list`
  - `https://lmstudio.ai/docs/developer/rest/load`
  - `https://lmstudio.ai/docs/developer/rest/unload`

---

## File Structure

- Create `apps/server/src/localModels/lmStudioContext.ts`: pure parsing and context-policy functions.
- Create `apps/server/src/localModels/lmStudioContext.test.ts`: table-driven policy coverage.
- Modify `packages/contracts/src/localModels.ts`: expose optional maximum, loaded, and tool-context readiness diagnostics while retaining `contextWindowTokens` as the effective OpenCode limit.
- Modify `packages/contracts/src/localModels.test.ts`: decode coverage for the new optional diagnostics.
- Modify `apps/server/src/localModels/LocalModelManager.ts`: retain LM Studio v1 metadata, prepare managed models, verify load results, and resynchronize OpenCode configuration.
- Modify `apps/server/src/localModels/LocalModelManager.test.ts`: fake-v1 REST tests for discovery, loading, reloading, ownership, and concurrency.
- Modify `apps/server/src/localModels/openCodeConfig.ts`: emit a context/output pair derived from the verified effective context.
- Modify `apps/server/src/localModels/catalog.test.ts`: OpenCode configuration regression coverage.
- Modify `apps/server/src/provider/Layers/OpenCodeAdapter.ts`: prepare the selected local runtime before starting OpenCode.
- Modify `apps/server/src/provider/Layers/OpenCodeAdapter.test.ts`: ordering and failure propagation coverage.
- Modify `apps/web/src/components/settings/LocalModelsSettingsPanel.tsx`: show active versus maximum LM Studio context and why an undersized external instance is chat-only.
- Modify `apps/web/src/components/settings/LocalModelsSettingsPanel.test.ts`: rendering coverage.
- Modify `apps/web/src/components/settings/LocalModelsSettingsPanel.browser.tsx`: browser-level status coverage.
- Modify all seven files in `apps/web/src/i18n/locales/*.json`: localized context diagnostics.
- Create `docs/e2e/lm-studio-effective-context.md`: reproducible Ollama and LM Studio acceptance procedure with verbatim-response requirements.

---

### Task 1: Represent LM Studio Maximum, Loaded, and Effective Context Separately

**Files:**

- Create: `apps/server/src/localModels/lmStudioContext.ts`
- Create: `apps/server/src/localModels/lmStudioContext.test.ts`
- Modify: `packages/contracts/src/localModels.ts:95-106`
- Modify: `packages/contracts/src/localModels.test.ts`
- Modify: `apps/server/src/localModels/LocalModelManager.ts:1181-1201`
- Test: `apps/server/src/localModels/LocalModelManager.test.ts:265-305`

**Interfaces:**

- Produces: `LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS = 16_384`.
- Produces: `resolveLmStudioContext(input): LmStudioContextResolution`.
- Produces: optional `maxContextWindowTokens`, `loadedContextWindowTokens`, and `toolContextWindowReady` fields on `LocalInstalledModel`.
- Preserves: `contextWindowTokens` as the effective limit written to OpenCode.

- [ ] **Step 1: Add failing policy tests**

Create table-driven cases with this shape:

```ts
import { describe, expect, it } from "vitest";

import { LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS, resolveLmStudioContext } from "./lmStudioContext";

describe("resolveLmStudioContext", () => {
  it("prepares a managed tool model at the agent floor", () => {
    expect(
      resolveLmStudioContext({
        managed: true,
        supportsToolCalls: true,
        maxContextWindowTokens: 131_072,
        loadedContextWindowTokens: 8_192,
      }),
    ).toEqual({
      effectiveContextWindowTokens: LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS,
      requiredLoadContextWindowTokens: LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS,
      toolsUsable: true,
    });
  });

  it("uses a larger verified loaded context without shrinking it", () => {
    expect(
      resolveLmStudioContext({
        managed: true,
        supportsToolCalls: true,
        maxContextWindowTokens: 131_072,
        loadedContextWindowTokens: 32_768,
      }),
    ).toEqual({
      effectiveContextWindowTokens: 32_768,
      requiredLoadContextWindowTokens: null,
      toolsUsable: true,
    });
  });

  it("does not evict an undersized external instance", () => {
    expect(
      resolveLmStudioContext({
        managed: false,
        supportsToolCalls: true,
        maxContextWindowTokens: 131_072,
        loadedContextWindowTokens: 8_192,
      }),
    ).toEqual({
      effectiveContextWindowTokens: 8_192,
      requiredLoadContextWindowTokens: null,
      toolsUsable: false,
    });
  });

  it("keeps a model whose maximum is too small available as chat-only", () => {
    expect(
      resolveLmStudioContext({
        managed: true,
        supportsToolCalls: true,
        maxContextWindowTokens: 8_192,
        loadedContextWindowTokens: null,
      }),
    ).toEqual({
      effectiveContextWindowTokens: null,
      requiredLoadContextWindowTokens: null,
      toolsUsable: false,
    });
  });

  it("does not force-load a model already classified as chat-only", () => {
    expect(
      resolveLmStudioContext({
        managed: true,
        supportsToolCalls: false,
        maxContextWindowTokens: 40_960,
        loadedContextWindowTokens: null,
      }),
    ).toEqual({
      effectiveContextWindowTokens: null,
      requiredLoadContextWindowTokens: null,
      toolsUsable: false,
    });
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
bun run --cwd apps/server test -- lmStudioContext.test.ts
```

Expected: FAIL because `lmStudioContext.ts` does not exist.

- [ ] **Step 3: Implement the pure policy**

Create these exact public types and function:

```ts
export const LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS = 16_384;

export interface LmStudioContextResolutionInput {
  readonly managed: boolean;
  readonly supportsToolCalls: boolean | null;
  readonly maxContextWindowTokens: number | null;
  readonly loadedContextWindowTokens: number | null;
}

export interface LmStudioContextResolution {
  readonly effectiveContextWindowTokens: number | null;
  readonly requiredLoadContextWindowTokens: number | null;
  readonly toolsUsable: boolean;
}

export function resolveLmStudioContext(
  input: LmStudioContextResolutionInput,
): LmStudioContextResolution {
  if (input.supportsToolCalls !== true) {
    return {
      effectiveContextWindowTokens: input.loadedContextWindowTokens,
      requiredLoadContextWindowTokens: null,
      toolsUsable: false,
    };
  }
  if (
    input.maxContextWindowTokens === null ||
    input.maxContextWindowTokens < LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS
  ) {
    return {
      effectiveContextWindowTokens: input.loadedContextWindowTokens,
      requiredLoadContextWindowTokens: null,
      toolsUsable: false,
    };
  }
  if (
    input.loadedContextWindowTokens !== null &&
    input.loadedContextWindowTokens >= LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS
  ) {
    return {
      effectiveContextWindowTokens: input.loadedContextWindowTokens,
      requiredLoadContextWindowTokens: null,
      toolsUsable: true,
    };
  }
  if (!input.managed) {
    return {
      effectiveContextWindowTokens: input.loadedContextWindowTokens,
      requiredLoadContextWindowTokens: null,
      toolsUsable: false,
    };
  }
  return {
    effectiveContextWindowTokens: LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS,
    requiredLoadContextWindowTokens: LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS,
    toolsUsable: true,
  };
}
```

- [ ] **Step 4: Extend the contract without breaking cached snapshots**

Add optional diagnostic fields:

```ts
export const LocalInstalledModel = Schema.Struct({
  runtime: LocalModelRuntime,
  modelId: ModelIdentifier,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  sizeBytes: NonNegativeInt,
  contextWindowTokens: Schema.NullOr(PositiveInt),
  maxContextWindowTokens: Schema.optional(Schema.NullOr(PositiveInt)),
  loadedContextWindowTokens: Schema.optional(Schema.NullOr(PositiveInt)),
  toolContextWindowReady: Schema.optional(Schema.NullOr(Schema.Boolean)),
  supportsToolCalls: Schema.NullOr(Schema.Boolean),
  tokensPerSecond: Schema.optional(Schema.NullOr(NonNegativeInt)),
});
```

Add a decoder test with:

```ts
{
  runtime: "lmstudio",
  modelId: "ibm/granite-4.1-3b",
  name: "Granite 4.1 3B",
  sizeBytes: 2_099_546_710,
  contextWindowTokens: 16_384,
  maxContextWindowTokens: 131_072,
  loadedContextWindowTokens: 8_192,
  toolContextWindowReady: false,
  supportsToolCalls: false
}
```

- [ ] **Step 5: Parse v1 inventory into the three context values**

In `#probeLmStudio`, read:

```ts
const maxContextWindowTokens = finitePositive(model.max_context_length);
const loadedInstances = Array.isArray(model.loaded_instances) ? model.loaded_instances : [];
const exactInstance =
  loadedInstances.map(record).find((instance) => instance?.id === modelId) ??
  record(loadedInstances[0]);
const loadedContextWindowTokens = finitePositive(record(exactInstance?.config)?.context_length);
```

Add `finitePositive(value: unknown): number | null` beside `finiteNonNegative`.
Resolve intrinsic tool capability in this order:

```ts
const reportedToolSupport = record(model.capabilities)?.trained_for_tool_use;
const intrinsicToolSupport =
  curatedToolSupport("lmstudio", modelId) ??
  (typeof reportedToolSupport === "boolean"
    ? reportedToolSupport
    : toolCallSupportForParameterSize(model.params_string));
```

The curated result remains first because it records DJL's real reliability measurements. Pass the
result to `resolveLmStudioContext`, then map:

```ts
{
  contextWindowTokens: resolution.effectiveContextWindowTokens,
  maxContextWindowTokens,
  loadedContextWindowTokens,
  toolContextWindowReady:
    intrinsicToolSupport === true ? resolution.toolsUsable : null,
  supportsToolCalls:
    intrinsicToolSupport === true ? resolution.toolsUsable : intrinsicToolSupport,
}
```

Determine `managed` once per probe from `#runtimeInstallationKind("lmstudio") === "managed"`;
do not perform filesystem resolution once per model.

- [ ] **Step 6: Verify discovery tests pass**

Run:

```bash
bun run --cwd apps/server test -- lmStudioContext.test.ts LocalModelManager.test.ts
bun run --cwd packages/contracts test -- localModels.test.ts
```

Expected: PASS, including an assertion that Granite reports:

```ts
{
  contextWindowTokens: 16_384,
  maxContextWindowTokens: 131_072,
  loadedContextWindowTokens: 8_192,
  toolContextWindowReady: true,
  supportsToolCalls: true
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/localModels/lmStudioContext.ts apps/server/src/localModels/lmStudioContext.test.ts apps/server/src/localModels/LocalModelManager.ts apps/server/src/localModels/LocalModelManager.test.ts packages/contracts/src/localModels.ts packages/contracts/src/localModels.test.ts
git commit -m "fix(local-models): track effective LM Studio context"
```

---

### Task 2: Prepare the Selected Managed LM Studio Model

**Files:**

- Modify: `apps/server/src/localModels/LocalModelManager.ts:195-220`
- Modify: `apps/server/src/localModels/LocalModelManager.ts:304-322`
- Modify: `apps/server/src/localModels/LocalModelManager.ts:1144-1214`
- Test: `apps/server/src/localModels/LocalModelManager.test.ts`

**Interfaces:**

- Consumes: `resolveLmStudioContext` and `LM_STUDIO_TOOL_CONTEXT_FLOOR_TOKENS`.
- Produces: `#ensureLmStudioModelContext(modelId: string): Promise<void>`.
- Produces: verified `contextWindowTokens` in the synchronized OpenCode configuration.

- [ ] **Step 1: Add failing REST orchestration tests**

Use the existing fetch mock style to cover these exact cases:

1. Managed Granite is unloaded: one `POST /api/v1/models/load` with
   `{ model: "ibm/granite-4.1-3b", context_length: 16384, echo_load_config: true }`.
2. Managed Granite is loaded at `8192`: unload instance
   `ibm/granite-4.1-3b`, then load at `16384`.
3. Managed Granite is loaded at `32768`: no load or unload call.
4. External Granite is loaded at `8192`: no unload call and tools remain disabled.
5. LM Studio echoes a load context below `16384`: reject with
   `LM Studio loaded Granite 4.1 3B with an 8192-token context; DJL tools require at least 16384.`
6. Two simultaneous `ensureRuntimeForModel("lmstudio/ibm/granite-4.1-3b")` calls share one load.
7. Ollama readiness makes no LM Studio load/unload calls.

The successful fake load response must be:

```ts
json({
  type: "llm",
  instance_id: "ibm/granite-4.1-3b",
  load_time_seconds: 1.2,
  status: "loaded",
  load_config: { context_length: 16_384 },
});
```

- [ ] **Step 2: Run the focused manager tests and verify they fail**

Run:

```bash
bun run --cwd apps/server test -- LocalModelManager.test.ts
```

Expected: FAIL because readiness only starts the server and does not manage model context.

- [ ] **Step 3: Retain private LM Studio runtime metadata**

Add:

```ts
interface LmStudioRuntimeModel {
  readonly modelId: string;
  readonly name: string;
  readonly managed: boolean;
  readonly maxContextWindowTokens: number | null;
  readonly loadedInstanceId: string | null;
  readonly loadedContextWindowTokens: number | null;
  readonly requiredLoadContextWindowTokens: number | null;
}
```

Add these fields to `LocalModelManager`:

```ts
readonly #lmStudioRuntimeModels = new Map<string, LmStudioRuntimeModel>();
readonly #lmStudioContextLoads = new Map<string, Promise<void>>();
```

Refresh the map during every successful v1 probe and remove entries no longer returned by LM Studio.

- [ ] **Step 4: Implement verified unload/load calls**

Implement:

```ts
async #ensureLmStudioModelContext(modelId: string): Promise<void>
```

Required behavior:

- Return when metadata has no required load context.
- Return when the runtime is external.
- If an undersized managed instance exists, call `POST /api/v1/models/unload` with
  `{ instance_id: loadedInstanceId }` and require a successful response.
- Call `POST /api/v1/models/load` with the exact body from Step 1 and use
  `WARM_UP_TIMEOUT_MS` because model loading can exceed the normal `2_500 ms` probe timeout.
- Require `status === "loaded"` and an echoed `load_config.context_length` greater than or equal
  to the requested value.
- Probe LM Studio again after loading, replace `#knownModels`, and call
  `#synchronizeOpenCodeConfig()`.
- Wrap the operation in `#lmStudioContextLoads` and remove it in `finally`.
- Convert HTTP and malformed-response failures into `LocalModelManagerError` with operation
  `ensureRuntimeForModel`.

- [ ] **Step 5: Invoke context preparation from readiness**

After `ensureRuntimeForModel` has established a running LM Studio server, call:

```ts
if (runtime === "lmstudio") {
  await this.#ensureLmStudioModelContext(modelId);
}
```

If the server was already running, do not return before this call.

- [ ] **Step 6: Verify the OpenCode config changes after the load**

Extend the managed `8192 -> 16384` test to read:

```text
<stateDir>/opencode/config/opencode/opencode.json
```

and assert:

```ts
expect(config.provider.lmstudio.models["ibm/granite-4.1-3b"].limit.context).toBe(16_384);
```

- [ ] **Step 7: Run manager and type tests**

Run:

```bash
bun run --cwd apps/server test -- LocalModelManager.test.ts lmStudioContext.test.ts
bun run --cwd apps/server typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/localModels/LocalModelManager.ts apps/server/src/localModels/LocalModelManager.test.ts
git commit -m "fix(local-models): prepare LM Studio agent context"
```

---

### Task 3: Keep OpenCode's Context Limit Consistent with LM Studio

**Files:**

- Modify: `apps/server/src/localModels/openCodeConfig.ts:42-52`
- Modify: `apps/server/src/localModels/LocalModelManager.ts:1675-1715`
- Modify: `apps/server/src/localModels/catalog.test.ts:168-230`
- Modify: `apps/server/src/provider/Layers/OpenCodeAdapter.ts:3798-3885`
- Modify: `apps/server/src/provider/Layers/OpenCodeAdapter.test.ts`

**Interfaces:**

- Consumes: `LocalInstalledModel.contextWindowTokens` as the effective, verified limit.
- Preserves: `OpenCodeAdapterLiveOptions.ensureLocalRuntime(modelSlug)`.
- Produces: OpenCode startup ordering in which local readiness completes before the OpenCode server reads its provider config.

- [ ] **Step 1: Add failing OpenCode configuration tests**

Add:

```ts
it("uses the effective LM Studio context and leaves response headroom", () => {
  const config = buildOpenCodeLocalProviderConfig({}, [
    {
      runtime: "lmstudio",
      modelId: "ibm/granite-4.1-3b",
      name: "Granite 4.1 3B",
      sizeBytes: 2_099_546_710,
      contextWindowTokens: 16_384,
      maxContextWindowTokens: 131_072,
      loadedContextWindowTokens: 16_384,
      toolContextWindowReady: true,
      supportsToolCalls: true,
    },
  ]);

  expect(config.provider.lmstudio.models["ibm/granite-4.1-3b"]).toMatchObject({
    limit: { context: 16_384, output: 4_096 },
    tool_call: true,
  });
});
```

Also test `32_768 -> output 8_192` and `null -> no limit`.

- [ ] **Step 2: Run the configuration test and verify it fails**

Run:

```bash
bun run --cwd apps/server test -- catalog.test.ts
```

Expected: FAIL because a `16_384` context currently advertises an `8_192` output limit.

- [ ] **Step 3: Derive the local output limit from the effective context**

Add:

```ts
function localOutputLimit(contextWindowTokens: number): number {
  return Math.min(8_192, Math.max(1_024, Math.floor(contextWindowTokens / 4)));
}
```

Emit:

```ts
limit: {
  context: model.contextWindowTokens,
  output: localOutputLimit(model.contextWindowTokens),
}
```

This reserves at least three quarters of a small local context for the system prompt, tools,
history, and current user input.

- [ ] **Step 4: Make configuration fingerprints capability-aware**

Replace the inventory fingerprint entry with:

```ts
[model.runtime, model.modelId, model.contextWindowTokens ?? "", model.supportsToolCalls ?? ""].join(
  ":",
);
```

Add a manager test proving an `8192 -> 16384` context change rewrites the file even when the
installed model IDs do not change.

- [ ] **Step 5: Add failing adapter ordering tests**

Instrument the fake runtime and readiness hook with an ordered array. Assert:

```ts
expect(order).toEqual(["ensure:lmstudio/ibm/granite-4.1-3b", "connect-opencode", "create-session"]);
```

Add a second test in which readiness fails and assert that `connectToOpenCodeServer` is never
called and the returned error contains the readiness message.

- [ ] **Step 6: Prepare the selected model before connecting OpenCode**

In `startSession`, after deriving `initialParsedModel` and before
`connectToOpenCodeServer`, call:

```ts
if (options?.ensureLocalRuntime && input.modelSelection) {
  yield *
    options.ensureLocalRuntime(input.modelSelection.model).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterValidationError({
            provider,
            operation: "startSession",
            issue:
              cause instanceof Error
                ? cause.message
                : "The selected local model runtime could not be prepared.",
          }),
      ),
    );
}
```

Keep the existing `sendTurn` readiness call because a user can change models inside an existing
thread.

- [ ] **Step 7: Run focused adapter and manager tests**

Run:

```bash
bun run --cwd apps/server test -- catalog.test.ts LocalModelManager.test.ts OpenCodeAdapter.test.ts
bun run --cwd apps/server typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/localModels/openCodeConfig.ts apps/server/src/localModels/catalog.test.ts apps/server/src/localModels/LocalModelManager.ts apps/server/src/localModels/LocalModelManager.test.ts apps/server/src/provider/Layers/OpenCodeAdapter.ts apps/server/src/provider/Layers/OpenCodeAdapter.test.ts
git commit -m "fix(opencode): align local context with LM Studio"
```

---

### Task 4: Surface Context Diagnostics Without Raw Engine Errors

**Files:**

- Modify: `apps/web/src/components/settings/LocalModelsSettingsPanel.tsx:384-460`
- Modify: `apps/web/src/components/settings/LocalModelsSettingsPanel.test.ts`
- Modify: `apps/web/src/components/settings/LocalModelsSettingsPanel.browser.tsx`
- Modify: `apps/web/src/i18n/locales/en.json`
- Modify: `apps/web/src/i18n/locales/es-419.json`
- Modify: `apps/web/src/i18n/locales/fr.json`
- Modify: `apps/web/src/i18n/locales/ja.json`
- Modify: `apps/web/src/i18n/locales/ko.json`
- Modify: `apps/web/src/i18n/locales/zh-Hans.json`
- Modify: `apps/web/src/i18n/locales/zh-Hant.json`

**Interfaces:**

- Consumes: `maxContextWindowTokens`, `loadedContextWindowTokens`, and `toolContextWindowReady`.
- Produces: a visible active/max context line and an actionable external-runtime explanation.

- [ ] **Step 1: Add failing component assertions**

For an LM Studio fixture loaded at `8192` with a `131072` maximum, assert the rendered card
contains:

```text
Loaded context: 8K / model maximum: 128K
Chat only at the current 8K context. Reload the model with at least 16K to use tools.
```

For a managed fixture loaded at `16384`, assert:

```text
Loaded context: 16K / model maximum: 128K
Installed
```

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```bash
bun run --cwd apps/web test -- LocalModelsSettingsPanel.test.ts
```

Expected: FAIL because the context diagnostics are not rendered.

- [ ] **Step 3: Add exact translation keys**

Add these keys beneath `localModels` in each locale:

| Locale    | `contextLoaded`                                                    | `contextTooSmallForTools`                                                                                                            |
| --------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `en`      | `Loaded context: {{loaded}}K / model maximum: {{maximum}}K`        | `Chat only at the current {{loaded}}K context. Reload the model with at least {{required}}K to use tools.`                           |
| `es-419`  | `Contexto cargado: {{loaded}}K / máximo del modelo: {{maximum}}K`  | `Solo chat con el contexto actual de {{loaded}}K. Vuelve a cargar el modelo con al menos {{required}}K para usar herramientas.`      |
| `fr`      | `Contexte chargé : {{loaded}}K / maximum du modèle : {{maximum}}K` | `Chat uniquement avec le contexte actuel de {{loaded}}K. Rechargez le modèle avec au moins {{required}}K pour utiliser les outils.`  |
| `ja`      | `読み込み済みコンテキスト：{{loaded}}K / モデル上限：{{maximum}}K` | `現在の {{loaded}}K コンテキストではチャット専用です。ツールを使うには、少なくとも {{required}}K でモデルを再読み込みしてください。` |
| `ko`      | `로드된 컨텍스트: {{loaded}}K / 모델 최대: {{maximum}}K`           | `현재 {{loaded}}K 컨텍스트에서는 채팅만 사용할 수 있습니다. 도구를 사용하려면 모델을 최소 {{required}}K로 다시 로드하세요.`          |
| `zh-Hans` | `已加载上下文：{{loaded}}K / 模型上限：{{maximum}}K`               | `当前 {{loaded}}K 上下文仅支持聊天。请至少以 {{required}}K 重新加载模型以使用工具。`                                                 |
| `zh-Hant` | `已載入上下文：{{loaded}}K / 模型上限：{{maximum}}K`               | `目前 {{loaded}}K 上下文僅支援聊天。請至少以 {{required}}K 重新載入模型以使用工具。`                                                 |

- [ ] **Step 4: Render diagnostics only when LM Studio reports both values**

Format token values as integer kibitoken labels with:

```ts
function formatContextK(tokens: number): number {
  return Math.round(tokens / 1_024);
}
```

Do not show the line for Ollama or for cached snapshots lacking the optional fields.
Show `contextTooSmallForTools` only when `toolContextWindowReady === false`. This prevents an
intrinsically chat-only model from being mislabeled as fixable by increasing context.

- [ ] **Step 5: Run UI and localization checks**

Run:

```bash
bun run --cwd apps/web test -- LocalModelsSettingsPanel.test.ts
bun run --cwd apps/web test:browser -- LocalModelsSettingsPanel.browser.tsx
bun run i18n:check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/settings/LocalModelsSettingsPanel.tsx apps/web/src/components/settings/LocalModelsSettingsPanel.test.ts apps/web/src/components/settings/LocalModelsSettingsPanel.browser.tsx apps/web/src/i18n/locales
git commit -m "feat(local-models): show LM Studio context readiness"
```

---

### Task 5: Lock the Fix with Automated and Live End-to-End Evidence

**Files:**

- Create: `docs/e2e/lm-studio-effective-context.md`
- Modify: `apps/server/src/provider/Layers/OpenCodeAdapter.test.ts`

**Interfaces:**

- Consumes: the managed LM Studio installer, v1 context preparation, OpenCode configuration, and the existing chat-only tool gate.
- Produces: repeatable acceptance evidence for both Ollama and LM Studio.

- [ ] **Step 1: Write the acceptance document**

The document must require:

1. The date, macOS architecture, DJL commit, OpenCode binary path, LM Studio version, and Ollama
   version.
2. The exact `GET /api/v1/models` model record before and after the LM Studio turn.
3. The exact user prompt and verbatim assistant reply for every test.
4. A PASS/FAIL line based on observed behavior, not expected behavior.
5. A clean isolated DJL home such as `.djl/e2e-lmstudio-context`; never delete or reuse
   `.djl/electron-dev`.

- [ ] **Step 2: Run the complete automated gate**

Run:

```bash
bun run --cwd packages/contracts test -- localModels.test.ts
bun run --cwd apps/server test -- lmStudioContext.test.ts LocalModelManager.test.ts catalog.test.ts OpenCodeAdapter.test.ts
bun run --cwd apps/web test -- LocalModelsSettingsPanel.test.ts
bun run i18n:check
bun run ci:desktop:typecheck
```

Expected: every command exits `0`.

- [ ] **Step 3: Rebuild the exact vendored OpenCode runtime**

Run:

```bash
bun run scripts/prepare-vendored-opencode.ts
```

Expected: the platform OpenCode executable is rebuilt under `.cache/djl/opencode/...`.

- [ ] **Step 4: Verify Ollama chat-only behavior through the runtime**

With Ollama serving `llama3.2:1b`, run:

```bash
R="$HOME/.djl/userdata/opencode"
XDG_DATA_HOME="$R/data" XDG_CONFIG_HOME="$R/config" \
XDG_CACHE_HOME="$R/cache" XDG_STATE_HOME="$R/state" \
.cache/djl/opencode/darwin-arm64/opencode run --model ollama/llama3.2:1b "hi"
```

PASS:

- The reply is plain conversational text.
- The reply does not contain a tool schema such as `{function <nil> {read`.

Record the complete assistant reply verbatim.

- [ ] **Step 5: Verify Ollama tool behavior through DJL**

Start DJL with the isolated E2E home:

```bash
node scripts/dev-runner.ts dev:desktop --home-dir ./.djl/e2e-lmstudio-context
```

Create a new thread with a tool-capable Ollama model of at least 3B and ask:

```text
Read the file /Users/toni798/Documents/Production_DJL/package.json and tell me its name field.
```

PASS:

- A Read tool call is visible.
- The returned content includes `"name": "@synara/monorepo"`.

Record the complete assistant reply verbatim.

- [ ] **Step 6: Verify managed LM Studio loading and chat**

Use DJL's one-click LM Studio install/start path in the isolated home. Install or select
`ibm/granite-4.1-3b`, create a new thread, and send:

```text
hi
```

Immediately read:

```bash
curl -sS http://127.0.0.1:1234/api/v1/models
```

PASS:

- Granite's loaded instance reports `context_length` greater than or equal to `16384`.
- The assistant gives a plain conversational reply.
- No `exceed_context_size_error` appears.

Record the complete assistant reply verbatim.

- [ ] **Step 7: Verify managed LM Studio tool execution**

In a new Granite thread, send:

```text
Read the file /Users/toni798/Documents/Production_DJL/package.json and tell me its name field.
```

PASS:

- A Read tool call runs.
- The returned content includes `"name": "@synara/monorepo"`.
- No raw function schema appears in assistant text.

Record the complete assistant reply verbatim.

- [ ] **Step 8: Verify external undersized LM Studio safety**

Run an external LM Studio instance with Granite loaded at `8192`, refresh Local Models, and verify:

- DJL does not call `/api/v1/models/unload`.
- The model card shows `8K / 128K`.
- The model is labeled chat-only with instructions to reload at `16K`.
- Sending `hi` returns conversational text without tools.

- [ ] **Step 9: Commit the observed evidence**

Fill the acceptance document with the actual replies and API records, then run:

```bash
git add docs/e2e/lm-studio-effective-context.md
git commit -m "test(local-models): document LM Studio context E2E"
```

---

## Self-Review

- Spec coverage: the plan covers LM Studio one-click startup, v1 model discovery, managed loading,
  external-runtime ownership, OpenCode limits, chat-only gating, Ollama regression protection, GUI
  diagnostics, and verbatim E2E evidence.
- Placeholder scan: the plan contains no deferred implementation steps; every behavior, endpoint,
  payload, error message, test command, and acceptance condition is specified.
- Type consistency: `contextWindowTokens` is always the effective OpenCode limit;
  `maxContextWindowTokens` is the model capability; `loadedContextWindowTokens` is LM Studio's
  current instance setting; `toolContextWindowReady` distinguishes intrinsic capability from
  current runtime readiness; `requiredLoadContextWindowTokens` remains server-private.
- Risk boundary: this plan deliberately does not implement transparent retry after an oversized
  single user attachment. OpenCode compaction handles normal conversation growth once it receives
  the correct effective limit; a single input that cannot fit must return an actionable size error
  rather than silently allocating the model maximum.
