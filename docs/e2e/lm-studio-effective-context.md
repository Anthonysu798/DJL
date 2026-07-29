# Local Model Inventory, Identity, Context, and Tools E2E

Date: 2026-07-29

DJL home: `.djl/electron-dev`

OpenCode runtime: `.cache/djl/opencode/darwin-arm64/opencode`

## Result

PASS after a final LM Studio load-request compatibility fix.

DJL now reconciles the picker and generated OpenCode providers against live local-runtime
inventories, keeps Ollama and LM Studio separate, rejects missing or mismatched LM Studio model
identities, and preserves the OpenCode tool gate.

The GUI acceptance run used Computer Use against `bun run electron:dev`. Local APIs, the OpenCode
database, and the managed LM Studio server log were used only as supporting evidence.

## Automated verification

```text
apps/server focused suite: 6 files, 176 tests passed
apps/web focused unit suite: 3 files, 8 tests passed
apps/web LocalModelsSettingsPanel browser suite: 1 file, 8 tests passed
packages/contracts localModels.test.ts: 7 tests passed
vendored OpenCode chat-only-model-tools.test.ts: 2 tests passed
bun typecheck: 10 tasks successful
git diff --check: passed
bun run scripts/prepare-vendored-opencode.ts: passed
bun run electron:dev: built and launched successfully
```

The first browser-suite attempt was blocked by the command sandbox from binding a temporary
localhost port. The unsandboxed rerun exposed an ambiguous `Installed` locator. After scoping that
assertion, the suite passed 8/8.

## Live inventory

Before the unloaded-model acceptance test, `GET http://127.0.0.1:1234/api/v1/models` returned these
LLMs:

```text
ibm/granite-4.1-3b
  display: Granite 4.1 3B
  loaded instances: none
  maximum context: 131072
  trained_for_tool_use: true

qwen/qwen3-1.7b
  display: Qwen3 1.7B
  loaded instances: none
  maximum context: 40960
```

It also returned the non-chat embedding model `text-embedding-nomic-embed-text-v1.5`, which was not
presented as a selectable chat model.

After the GUI selected and started Qwen3 1.7B, the live record contained:

```json
{
  "key": "qwen/qwen3-1.7b",
  "loaded_instances": [
    {
      "id": "qwen/qwen3-1.7b",
      "config": {
        "context_length": 8192,
        "parallel": 4
      }
    }
  ],
  "max_context_length": 40960
}
```

## E2E A — LM Studio startup

1. Stopped the server.
2. Refreshed Settings → Local Models.
3. DJL displayed LM Studio as installed and ready to start.
4. Clicked `Start server`.
5. The action completed and DJL displayed LM Studio as running on `127.0.0.1:1234`.
6. The live API responded.
7. A later navigation/refresh still showed the live installed and loaded state.

The first attempt followed a deliberately stale daemon state and surfaced an error instead of
spinning forever. After starting a clean supported daemon state, stopping only the HTTP server, and
retrying the exact GUI flow, the button started the server successfully.

PASS

## E2E B — stale model removal and provider grouping

The picker displayed:

```text
LM Studio (2)
  Granite 4.1 3B
  Qwen3 1.7B

Ollama (7)
  djl-qwen:3b
  djl-qwen:7b
  qwen2.5:3b
  qwen2.5:7b
  llama3.2:1b
  qwen2.5-coder:0.5b
  Qwen3 1.7B
```

The two selectable LM Studio models exactly matched the live LM Studio LLM inventory. Stale
`openai/gpt-oss-20b` and Qwen 30B entries were absent. Ollama models appeared only under `Ollama`;
LM Studio models appeared only under `LM Studio`.

PASS

## E2E C — installed, unloaded LM Studio model

Model: `lmstudio/qwen/qwen3-1.7b`

Starting state: installed and present in the live inventory, with no loaded instance.

Computer Use started from Local Models settings, used the chat action, selected `Qwen3 1.7B`,
confirmed the chat-only notice, and sent:

```text
hi
```

During the first run DJL exposed an HTTP 400 from LM Studio. The response identified the exact
cause: the load request contained unsupported key `identifier`. DJL now sends the supported body
using exact field `model`, then verifies both the returned and live `instance_id`. The model was
unloaded again and the entire task flow was rerun after rebuilding/relaunching DJL.

The final run automatically loaded exact instance `qwen/qwen3-1.7b` at 8192 tokens, completed
without an indefinite spinner, and kept the model visible under the LM Studio group without an app
restart.

Tool definitions: absent because DJL classified this selection as chat-only.

Verbatim assistant reply:

```text
Hello! How can I assist you today? 😊
```

PASS

## E2E D — LM Studio tool-capable model

Provider/model selected in OpenCode:

```text
lmstudio / ibm/granite-4.1-3b
```

LM Studio resolved model:

```text
ibm/granite-4.1-3b
```

Prompt:

```text
Read /private/tmp/djl-e2e.txt exactly.
```

Request evidence:

```text
model: ibm/granite-4.1-3b
tool_choice: auto
read tool definition: present
```

Observed tool call:

```text
tool: read
filePath: /private/tmp/djl-e2e.txt
status: completed
```

Exact tool output:

```text
DJL_LOCAL_MODEL_E2E_2026_07_29
LM Studio and Ollama both reached this file through the OpenCode Read tool.
```

Verbatim assistant reply:

````text
Here is the exact content of **/private/tmp/djl-​e2e.txt**:

```
1: DJL_LOCAL_ MODEL_ E2E_ 2026_07_29
2: LM Studio and Ollama both reached this file through the OpenCode Read tool.
```
````

The real Read card contained the exact bytes. Granite inserted a zero-width character in the path
and spaces in the first line when restating the successful tool result; this is a model-output
formatting limitation, not a missing tool call or model substitution.

PASS for identity, tool delivery, tool execution, and exact tool result.

## E2E E — Ollama chat-only model

Provider/model:

```text
ollama / llama3.2:1b
```

The GUI displayed and required confirmation of:

```text
llama3.2:1b 太小，无法调用工具，不能执行编程任务。仅用于聊天吗？
```

Prompt:

```text
hi
```

Tool definitions: absent.

Tool call: none. The OpenCode session contained only `step-start`, `text`, and `step-finish`.

Verbatim assistant reply:

```text
It seems like we haven't started our conversation yet. Can you please specify what topic or code you'd like to discuss, and I'll do my best to assist you?
```

No raw or malformed tool schema appeared.

PASS

## E2E F — Ollama tool-capable model

Provider/model:

```text
ollama / qwen2.5:3b
```

Prompt:

```text
Read /private/tmp/djl-e2e.txt exactly.
```

Tool definitions: present.

Observed tool call:

```text
tool: read
filePath: /private/tmp/djl-e2e.txt
status: completed
```

Exact tool output:

```text
DJL_LOCAL_MODEL_E2E_2026_07_29
LM Studio and Ollama both reached this file through the OpenCode Read tool.
```

Verbatim assistant reply:

````text
The content at `/private/tmp/djl-e2e.txt` is as follows:

```
1: DJL_LOCAL_MODEL_E2E_2026_07_29
2: LM Studio and Ollama both reached this file through the OpenCode Read tool.

(End of file - total 2 lines)
```

Here are the first two lines:
- Line 1: **DJL_LOCAL_MODEL_E2E_2026_07_29**
- Line 2: **LM Studio and Ollama both reached this file through the OpenCode Read tool. (End of file - total 2 lines)**

Would you like to proceed with any specific actions on this content?
````

PASS

## Files changed

Server and contracts:

```text
apps/server/src/localModels/LmStudioInstaller.test.ts
apps/server/src/localModels/LmStudioInstaller.ts
apps/server/src/localModels/LocalModelManager.test.ts
apps/server/src/localModels/LocalModelManager.ts
apps/server/src/localModels/catalog.test.ts
apps/server/src/localModels/lmStudioContext.test.ts
apps/server/src/localModels/lmStudioContext.ts
apps/server/src/localModels/openCodeConfig.ts
apps/server/src/provider/Layers/OpenCodeAdapter.test.ts
apps/server/src/provider/Layers/OpenCodeAdapter.ts
apps/server/src/provider/runtimeLayer.ts
packages/contracts/src/localModels.test.ts
packages/contracts/src/localModels.ts
```

Web:

```text
apps/web/src/components/settings/LocalModelsSettingsPanel.browser.tsx
apps/web/src/components/settings/LocalModelsSettingsPanel.test.ts
apps/web/src/components/settings/LocalModelsSettingsPanel.tsx
apps/web/src/lib/providerDiscoveryReactQuery.test.ts
apps/web/src/lib/providerDiscoveryReactQuery.ts
apps/web/src/localModelSetupCoordinator.test.ts
apps/web/src/localModelSetupCoordinator.tsx
apps/web/src/i18n/locales/en.json
apps/web/src/i18n/locales/es-419.json
apps/web/src/i18n/locales/fr.json
apps/web/src/i18n/locales/ja.json
apps/web/src/i18n/locales/ko.json
apps/web/src/i18n/locales/zh-Hans.json
apps/web/src/i18n/locales/zh-Hant.json
```

Vendored OpenCode and documentation:

```text
vendor/opencode/packages/opencode/src/session/llm/request.ts
vendor/opencode/packages/opencode/test/session/chat-only-model-tools.test.ts
docs/superpowers/plans/2026-07-29-lm-studio-effective-context.md
docs/e2e/lm-studio-effective-context.md
```

No commit, push, release, or unrelated cleanup was performed.

## Remaining limitations

- LM Studio capability metadata currently reports Qwen3 1.7B as trained for tool use, while DJL's
  conservative small-model policy presents it as chat-only. This run therefore did not use that
  model to validate tools; installed Granite was used for the LM Studio tool acceptance test.
- Small local models may restate an exact tool result with altered whitespace or punctuation even
  though the Read tool card contains the exact file bytes.
- The LM Studio CLI can report a stale daemon identity even while its HTTP listener is healthy.
  DJL runtime status is based on the live HTTP endpoint, not that CLI status string.
