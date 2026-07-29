# Local model simplification — design

Date: 2026-07-28
Status: Proposed

## Goal

A user with zero technical experience opens DJL, presses one button, and ends up chatting with a
local model that is genuinely fast on their machine — without choosing a runtime, a model, or a
quantization, and without ever seeing a terminal.

## What already exists

The install pipeline is built and works. `LocalModelManager.startSetup()`
(`apps/server/src/localModels/LocalModelManager.ts:238`) drives the full sequence:

```
detecting → installing_runtime → starting_runtime → downloading_model → synchronizing → ready
```

- `OllamaInstaller.ts` downloads the official GitHub release, verifies SHA-256, and installs into
  the DJL state dir. No admin password, no terminal, no PATH mutation.
- `openCodeConfig.ts:17` writes `provider.ollama` into the managed `opencode.json`, so installed
  models reach the chat dropdown automatically.
- Setup jobs persist to `setup-state.json` and resume after a restart
  (`LocalModelManager.ts:1192`).
- `LocalModelSetupCoordinator.tsx:80` auto-selects the model in the composer when setup completes.

**No new install machinery is required.** Every change below is recommendation quality, presentation,
and honesty about what a model can do.

## Problems

### P1 — The recommendation cannot predict speed

`recommendLocalModel` (`catalog.ts:77`) selects the largest model whose `minimumMemoryBytes` fits in
`os.totalmem()`. There is no GPU, VRAM, CPU, or architecture detection anywhere in the codebase.

Consequences: a 32 GB Intel Mac and a 32 GB M4 Max receive the identical recommendation (Qwen3 Coder
30B, 19 GB). A Windows laptop with 32 GB RAM and 8 GB of VRAM receives it too and offloads most
layers to CPU. The rule optimizes for *largest*, which is the direct inverse of the stated goal.

### P2 — The page is a catalog, not an answer

Five horizontally-scrolling cards with five identical primary buttons, followed by the same five
models again under "LM Studio models" with a second install path. One page, two runtimes, ten
install buttons. LM Studio installs additionally cannot be cancelled or deleted from DJL
(`canCancelInstall` / `canDeleteModels` are Ollama-only, `LocalModelManager.ts:104`).

### P3 — Unusable models are presented as equals

`supportsToolCalls` is `null` for any non-curated model, and opencode defaults `tool_call ?? true`
(`vendor/opencode/packages/opencode/src/provider/provider.ts:1319`). DJL therefore tells the harness
that `qwen2.5-coder:0.5b` and `llama3.2:1b` support tool calls. A user selects one, asks for a file
edit, and gets a silent stall. This — not the install — is where users actually get stuck.

### P4 — Local models are undiscoverable and unlabeled

No onboarding exists. The dropdown renders a bare `Ollama (local)` group of raw tags with no size,
no speed, no fitness signal, and no route to setup.

## Decisions

| Decision | Choice |
|---|---|
| LM Studio | Behind Advanced. Keep detection and support for existing installs; remove from the main surface. |
| Recommendation bias | Favor speed. Target ≥15 tok/s; accept a less capable model to get it. |

## Design

### 1. Hardware profile

Detect once at server start, cache in the snapshot, refresh only on explicit user refresh.

```ts
LocalHardwareProfile = {
  totalMemoryBytes: number
  freeDiskBytes: number | null
  cpuModel: string | null
  cpuCores: number
  platform: NodeJS.Platform
  arch: NodeJS.Architecture
  acceleration: "apple_unified" | "discrete_gpu" | "cpu_only"
  gpuName: string | null
  vramBytes: number | null
  usableModelBytes: number      // the budget, derived below
}
```

Detection per platform:

- **macOS arm64** — `acceleration: "apple_unified"`. No probing needed; unified memory is implied by
  `platform === "darwin" && arch === "arm64"`.
- **Windows** — `Get-CimInstance Win32_VideoController` for the adapter name; read true VRAM from
  registry `HardwareInformation.qwMemorySize`. The WMI `AdapterRAM` field is a signed 32-bit value
  and is wrong above 4 GB — do not use it.
- **Linux** — `nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits`, falling back to
  `/sys/class/drm/card*/device/mem_info_vram_total`.
- **Fallback and cross-check** — once Ollama is running, `GET /api/ps` reports `size` and
  `size_vram` for a loaded model. `size_vram / size < 0.9` means layers are spilling to CPU. This is
  a direct measurement of the condition that causes lag and needs no platform-specific code.

Every probe is best-effort with a short timeout. Failure degrades to `cpu_only`, which is the safe
direction (smaller model).

### 2. Budget-based selection

Replace the capacity rule with a budget rule. Selection compares against **quantized weight size**
(`source.estimatedDownloadBytes`), not `minimumMemoryBytes`.

```
rawBudget =
  apple_unified  → totalMemoryBytes * 0.60
  discrete_gpu   → vramBytes * 0.90
  cpu_only       → totalMemoryBytes * 0.35

usableModelBytes = rawBudget * 0.70    // headroom for the 8K KV cache and context
```

Pick the largest curated model whose weights fit `usableModelBytes`. The 0.70 factor is what
implements "favor speed" — it biases one tier down without a separate step-down rule.

Worked examples:

| Machine | Budget | Selected |
|---|---|---|
| M4 Pro, 48 GB | 20.2 GB | Qwen3 Coder 30B (19 GB) |
| M-series, 32 GB | 13.4 GB | GPT-OSS 20B (13 GB) |
| M-series, 16 GB | 6.7 GB | *gap — see below* |
| RTX 4060, 8 GB VRAM | 5.0 GB | *gap — see below* |
| CPU-only, 16 GB | 3.9 GB | Granite 4.1 3B (2.1 GB) |
| CPU-only, 8 GB | 2.0 GB | Qwen3 1.7B (1.4 GB) |

**Catalog gap.** The curated list jumps from 2.1 GB to 13 GB. The 4–7 GB band is exactly where 16 GB
Macs and 8 GB-VRAM PCs land — likely the most common hardware in the user base. Add one 7–8B coder
tier (~4.7 GB quantized) to fill it. This is not "more models to show": the UI displays one
recommendation, so catalog entries are selection candidates, not menu items.

`minimumMemoryBytes` is retained for display copy only ("needs 8 GB") and is no longer a selector.

### 3. Single-hero settings page

Replace the card shelf with one decision:

```
Run AI privately on this Mac
Detected: Apple M4 Pro · 48 GB memory
Recommended: Qwen3 Coder 30B — fast on your hardware · 19 GB download

        [  Set up local AI  ]           Show other models ⌄
```

- One primary action, bound to the existing `startSetup({ recommendationId })`.
- Progress renders inline in the same hero from existing setup-job states, with plain copy:
  "Installing Ollama…" → "Downloading Qwen3 Coder — 4.2 of 19 GB, about 6 minutes left" →
  "Almost ready…".
- On completion: "**Qwen3 Coder is ready.** [Start a chat →]". Auto-selection already happens via
  `LocalModelSetupCoordinator`.
- "Show other models" reveals: remaining tiers, installed models, custom install, and LM Studio.

LM Studio moves entirely inside that disclosure. The duplicate "LM Studio models" list is deleted —
it offered the same five models through a path that cannot cancel or delete. Runtime detection and
the existing install path are unchanged for users who already have it.

### 4. Speed verification

Add `"verifying"` to `LocalModelSetupJobState`, between `downloading_model` and `synchronizing`.

Run one throwaway ~50-token generation against the new model and read `eval_count` and
`eval_duration` from the Ollama response to compute tokens/sec.

| Result | Behavior |
|---|---|
| ≥ 15 tok/s | "Ready · about 28 tokens per second on your Mac" |
| 5–15 tok/s | Ready, plus an offer: "Slower than ideal. Try the smaller Qwen3 4B?" |
| < 5 tok/s | "Too slow on this computer" with a one-click switch to the next tier down |

This converts a prediction into a measurement, gives a concrete answer to "why is it laggy", and
warms the model into memory so the first real chat has no cold-start delay.

Contract additions: `"verifying"` in `LocalModelSetupJobState`; `tokensPerSecond: number | null` on
`LocalInstalledModel`.

### 5. Dropdown honesty

DJL fully controls what opencode sees, so these are cheap changes in `openCodeConfig.ts`.

- **Parameter-aware tool gating.** Ollama's `/api/tags` returns `details.parameter_size` and
  `details.quantization_level`. Verified against a live Ollama
  (`qwen2.5:7b → "7.6B"`, `qwen2.5-coder:0.5b → "494.03M"`) — note the field carries **both `M` and
  `B` suffixes**, so the parser must normalize units, and must tolerate the field being absent on
  models imported from a Modelfile. The current parser reads only `name` and `size`
  (`LocalModelManager.ts:853`). Parse `parameter_size`, and write `tool_call: false` for models
  under 3B instead of leaving it `null`. Small models then surface as "Chat only — too small for
  coding tasks" rather than failing silently inside the harness.
- **Human names.** Write `name: "Qwen3 Coder 30B (local)"` rather than the raw tag. The dropdown
  reads this field, so no picker change is needed.
- **Group label.** Rename `"Ollama (local)"` → `"On this computer"` in `RUNTIME_CONFIG`.
- **Entry point.** When no local models are installed, add a footer row to the dropdown —
  "⚙ Set up local AI…" — routing to the settings hero. This is the only discovery path that exists
  outside Settings.

## Explicitly out of scope

- **Bundling Ollama in the installer.** Adds ~300 MB to every download for a feature most users skip.
  The managed installer already works without admin rights.
- **Hardware fingerprinting / HWID.** Recommendation needs *capability* (RAM, VRAM, arch), not
  *identity*. A stable hardware ID adds privacy exposure and improves nothing here.
- **Expanding the visible catalog.** One recommendation is shown. The only catalog change is filling
  the 4–7 GB selection gap.

## Testing

- `catalog.test.ts` — budget selection across a table of profiles (Apple unified, discrete VRAM,
  CPU-only) at each memory tier, including the boundary where a tier flips.
- New `hardwareProfile.test.ts` — each platform probe against captured fixture output; every failure
  path degrades to `cpu_only`.
- `LocalModelManager.test.ts` — the `verifying` state transitions, and each of the three tok/s
  branches.
- `openCodeConfig.test.ts` — `tool_call: false` below the 3B threshold; `parameter_size` parsing
  including malformed and absent values.
- `LocalModelsSettingsPanel.test.ts` — hero renders the single recommendation; LM Studio content is
  absent until the disclosure is opened.

## Sequencing

Each step ships independently and improves the product on its own.

1. **Hardware profile + budget selection.** Backend only, fully unit-testable, no UI change. Largest
   correctness win — it stops recommending 30B models to machines that cannot run them.
2. **Single-hero UI, LM Studio behind Advanced.** UI only; reuses the existing `startSetup` call.
3. **Speed verification** and `tokensPerSecond` in the snapshot.
4. **Dropdown honesty** — names, tool-call gating, group label, setup entry point.

## Known loose end

The `localModels.quick.*` i18n block is dead across all locale files — nothing references it since
the card shelf replaced the quick-setup component. Not touched by this design; worth removing
separately.
