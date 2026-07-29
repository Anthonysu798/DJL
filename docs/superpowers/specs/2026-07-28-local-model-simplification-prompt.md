# Implementation prompt — local model simplification

Paste the block below into a fresh Claude Code session in `/Users/toni798/Documents/Production_DJL`.

Run **one phase per session**. Each phase ships independently and leaves the app working. Phase 1
delivers the largest correctness win on its own and touches no UI.

---

## The prompt

> Read `docs/superpowers/specs/2026-07-28-local-model-simplification-design.md` first. It is the
> authoritative spec for this work — follow it, and tell me if you disagree with any part of it
> rather than silently deviating.
>
> **Context.** DJL is an Electron desktop app. Users can run local models through Ollama or LM
> Studio. The install pipeline already works end to end: `LocalModelManager.startSetup()` installs
> Ollama without an admin password, pulls a model, writes it into the managed `opencode.json`, and
> the composer auto-selects it. **Do not rebuild any of that.**
>
> The problem is that the model *recommendation* is blind to actual hardware, the settings page
> presents a five-card catalog instead of one decision, and models too small to drive the agent
> harness are presented as equals. Users with no technical background cannot get a fast local model
> running.
>
> **Two decisions are already made. Do not reopen them.**
> 1. LM Studio moves behind an "Advanced" disclosure. Keep detection and support for existing
>    installs; remove it from the main surface. Delete the duplicate "LM Studio models" list.
> 2. Model selection favors **speed over capability**. Target ≥15 tokens/sec, accepting a less
>    capable model to get there.
>
> **Implement Phase N only** (see phases below). Stop when that phase is complete and verified.
>
> ### Working agreement
>
> - Follow `CLAUDE.md`. In particular: state assumptions before implementing, write the minimum code
>   that solves the problem, and keep changes surgical — every changed line must trace to this task.
>   Do not refactor adjacent code, do not "improve" comments or formatting you did not need to
>   touch, and do not delete pre-existing dead code (flag it instead).
> - Test-driven where it fits: the selection algorithm, the platform probes, and the parsing changes
>   are all pure functions with table-driven tests. Write the failing test first.
> - Match the existing style. This codebase uses Effect, `#private` class fields, `readonly`
>   interfaces, and Schema-based contracts in `packages/contracts`.
> - If you hit something genuinely ambiguous, do everything that does not depend on the answer
>   first, then ask one specific question.
>
> ### Verify before claiming done
>
> Run these and paste the actual output — do not infer results:
>
> ```
> bun run typecheck
> bun run lint
> bun run test
> bun run i18n:check     # required if you touched any UI string
> ```
>
> There are 7 locale files in `apps/web/src/i18n/locales/` (en, es-419, fr, ja, ko, zh-Hans,
> zh-Hant). Any new UI string must be added to all of them or `i18n:check` fails.
>
> Do not commit unless I ask.

---

## Phase 1 — Hardware profile and budget-based selection

**Backend only. No UI changes. Largest correctness win.**

Today `recommendLocalModel` (`apps/server/src/localModels/catalog.ts:77`) picks the largest model
whose `minimumMemoryBytes` fits `os.totalmem()`. There is no GPU, VRAM, CPU, or architecture
detection anywhere in the codebase, so a 32 GB Intel Mac and a 32 GB M4 Max get the identical 19 GB
recommendation.

Build:

1. A new `apps/server/src/localModels/hardwareProfile.ts` exporting `LocalHardwareProfile` detection
   per the spec — Apple unified memory via `platform`/`arch`, Windows VRAM via the registry
   `qwMemorySize` (**not** WMI `AdapterRAM`, which is wrong above 4 GB), Linux via `nvidia-smi` with
   a `/sys/class/drm` fallback. Every probe is best-effort with a short timeout; any failure
   degrades to `cpu_only`, which is the safe direction.
2. Replace the selection rule in `catalog.ts` with the budget formula from the spec, comparing
   against quantized weight size (`source.estimatedDownloadBytes`), not `minimumMemoryBytes`.
   Retain `minimumMemoryBytes` for display copy only.
3. Add one 7–8B coder tier (~4.7 GB quantized) to `LOCAL_MODEL_RECOMMENDATIONS`. The curated list
   currently jumps from 2.1 GB to 13 GB, and 16 GB Macs plus 8 GB-VRAM PCs land in that gap.
4. Surface the profile on `LocalModelsSnapshot` (`packages/contracts/src/localModels.ts:155`) so the
   UI can display "Detected: Apple M4 Pro · 48 GB memory" in Phase 2.
5. Wire it through `LocalModelManager` (which currently takes `totalMemoryBytes` in its options) and
   `LocalModelsLive.ts`.

Tests: extend `catalog.test.ts` with a table covering each acceleration mode at each memory tier,
including the boundaries where a tier flips. Add `hardwareProfile.test.ts` driving each platform
probe from captured fixture output, and assert every failure path yields `cpu_only`.

**Done when:** an Apple-silicon profile, a discrete-GPU profile, and a CPU-only profile at the same
total RAM select three different models, proven by tests.

---

## Phase 2 — Single-hero settings page

**UI only. Reuses the existing `startSetup` call — no backend changes.**

Replace the horizontal card shelf in `apps/web/src/components/settings/LocalModelsSettingsPanel.tsx`
(747 lines) and `LocalModelCardShelf.tsx` (375 lines) with one decision:

```
Run AI privately on this Mac
Detected: Apple M4 Pro · 48 GB memory
Recommended: Qwen3 Coder 30B — fast on your hardware · 19 GB download

        [  Set up local AI  ]           Show other models ⌄
```

- One primary button, bound to the existing
  `actionMutation.mutate({ type: "start-setup", recommendationId })`.
- Progress renders inline in the same hero from the existing setup-job states, in plain language:
  "Installing Ollama…" → "Downloading Qwen3 Coder — 4.2 of 19 GB, about 6 minutes left" →
  "Almost ready…".
- On completion: "**Qwen3 Coder is ready.** [Start a chat →]". Auto-selection already happens in
  `apps/web/src/localModelSetupCoordinator.tsx:80` — do not duplicate it.
- "Show other models" reveals the remaining tiers, installed models, custom install, and LM Studio.
- **Delete** the duplicate "LM Studio models" section that lists the same five models with a second
  install path. Move the LM Studio runtime row inside the disclosure. Keep runtime detection and the
  existing install path intact for users who already have it.

These files are large and doing too much. Splitting the hero into its own component is in scope;
broader refactoring of unrelated panels is not.

**Done when:** the page shows exactly one recommendation and one primary button above the fold, and
no LM Studio content renders until the disclosure is opened.

---

## Phase 3 — Speed verification

Add `"verifying"` to `LocalModelSetupJobState` (`packages/contracts/src/localModels.ts:129`),
between `downloading_model` and `synchronizing`, and add `tokensPerSecond: number | null` to
`LocalInstalledModel`.

In `LocalModelManager.#runSetup` (`apps/server/src/localModels/LocalModelManager.ts:370`), after the
download completes, run one throwaway ~50-token generation and compute tokens/sec from
`eval_count` and `eval_duration` in the Ollama response. Branch per the spec:

| Result | Behavior |
|---|---|
| ≥ 15 tok/s | "Ready · about 28 tokens per second on your Mac" |
| 5–15 tok/s | Ready, plus an offer to switch to the next tier down |
| < 5 tok/s | "Too slow on this computer" with one-click switch to the next tier down |

This also warms the model into memory so the first real chat has no cold-start delay.

Tests: `LocalModelManager.test.ts` — the new state transition and all three branches.

**Done when:** a completed setup reports a real measured tokens/sec, and a deliberately slow result
offers a smaller model.

---

## Phase 4 — Dropdown honesty

All in `apps/server/src/localModels/openCodeConfig.ts` plus the Ollama parser in
`LocalModelManager.ts:853`.

1. **Parameter-aware tool gating.** opencode defaults `tool_call ?? true`
   (`vendor/opencode/packages/opencode/src/provider/provider.ts:1319`), so DJL currently tells the
   harness that `llama3.2:1b` supports tool calls — and the agent stalls silently when a user picks
   it. Ollama's `/api/tags` returns `details.parameter_size`; this was verified against a live
   instance and the field carries **both `M` and `B` suffixes** (`"7.6B"`, `"494.03M"`), so
   normalize units and tolerate the field being absent on Modelfile-imported models. Write
   `tool_call: false` below 3B instead of leaving it `null`, and label those models "Chat only —
   too small for coding tasks" in the installed list.
2. **Human names.** Write `name: "Qwen3 Coder 30B (local)"` rather than the raw tag. The dropdown
   reads this field, so the picker needs no change.
3. **Group label.** Rename `"Ollama (local)"` → `"On this computer"` in `RUNTIME_CONFIG`
   (`openCodeConfig.ts:9`).
4. **Entry point.** When no local models are installed, add a footer row to the chat model dropdown
   — "⚙ Set up local AI…" — routing to the settings hero. This is currently the only discovery path
   that does not exist outside Settings.

Tests: `openCodeConfig.test.ts` for the threshold and for `parameter_size` parsing including
malformed, absent, and `M`-suffixed values.

**Done when:** a sub-3B model is marked chat-only and cannot be silently handed tool calls, and a
user with no local models can reach setup from the dropdown.

---

## Out of scope — do not do these

- **Do not bundle Ollama in the installer.** It adds ~300 MB to every download for a feature most
  users skip, and the managed installer already works without admin rights.
- **Do not build hardware fingerprinting or an HWID.** Recommendation needs *capability* (RAM, VRAM,
  arch), not *identity*. A stable hardware ID adds privacy exposure and improves nothing here.
- **Do not expand the visible catalog.** The UI shows one recommendation. The only catalog change is
  the single 7–8B tier that fills the selection gap.
- **Do not rebuild the install pipeline.** `startSetup`, `OllamaInstaller`, the opencode config sync,
  and the composer auto-select all work today.

## Known loose end

`localModels.quick.*` is dead across all 7 locale files — nothing has referenced it since the card
shelf replaced the quick-setup component. It is not part of this work. Flag it, do not delete it as
a side effect.
