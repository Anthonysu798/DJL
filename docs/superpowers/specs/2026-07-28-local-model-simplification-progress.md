# Local model simplification — implementation progress

Spec: `2026-07-28-local-model-simplification-design.md`
Prompt: `2026-07-28-local-model-simplification-prompt.md`
Started: 2026-07-28

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Hardware profile + budget-based selection | **Done** — typecheck, lint, tests green |
| 2 | Single-hero settings page | **Done** |
| 3 | Speed verification | **Done** |
| 4 | Dropdown honesty | **Done** |
| 5 | Auto-start an installed Ollama at launch | **Done** |
| 6 | Chat-only signal in the dropdown; actionable speed verdict | **Done** |
| 7 | Speed persistence + lazy measurement; hero chat link; dead-key cleanup | **Done** |

### Phase 5 — auto-start an installed Ollama at launch

Not in the original spec; added after seeing the running app.

**What already existed:** start-on-use. `OpenCodeAdapter.ts:4062` calls `ensureLocalRuntime` before a
turn, reaching `LocalModelManager.ensureRuntimeForModel`, which starts a stopped Ollama. So sending
a message with a local model selected already booted the runtime.

**What was missing:** anything at launch. The desktop loop in `LocalModelsLive.ts` only *probed*
every 15s. The consequence is worse than a missing convenience: `#probeOllama` returns
`models: null` when the server is down, so at launch with Ollama stopped **the user's installed
models are absent from the chat model picker entirely** — they look deleted, and nothing points at
the start button buried in settings.

`LocalModelManager.startInstalledRuntimes()` now runs once at desktop startup, forked so a slow or
failed start cannot delay launch. Deliberately narrow:

- **Ollama only.** It is the runtime DJL installs and manages, serves on loopback, and costs nothing
  until a model is loaded. LM Studio is a user-owned GUI app and is left alone.
- **Never installs.** Only transitions an already-installed runtime from `stopped` to `running`.
- **Never rejects.** On failure the runtime stays stopped and the manual start button remains.

Five tests cover: starts a stopped runtime and surfaces its models; no spawn when not installed; no
respawn when already running; no throw when the spawn refuses; LM Studio untouched.

Second environment-leak caught, same class as the Phase 1 one: the tests first used
`platform: "linux"`, whose resolver falls back to `/usr/local/bin/ollama` — which exists on any
developer Mac. "Not installed" therefore depended on the test host, and the case burned the full
90-second readiness poll before failing. Now sandboxed to `win32` with a controlled `PATH` /
`LOCALAPPDATA`, matching the existing suite's approach.

### Phase 6 — chat-only in the dropdown, actionable speed verdict

**Correction to Phase 4.** I claimed writing `tool_call: false` stops OpenCode handing the agent a
model that stalls. That was wrong: `capabilities.toolcall` is written but **never read** in the
request path — `llm.ts:327` sends `prepared.tools` unconditionally, decided by the agent, not by
model capability. Setting it changes no harness behaviour.

What it *does* do is propagate a signal. `OpenCodeAdapter.ts:1513` maps it onto the model descriptor
as `supportsToolCalls`, which reaches the web app — where the picker was ignoring it. So the original
complaint was still live at the exact point users choose a model. Since OpenCode will not gate, DJL's
picker is the only place this can be enforced.

**P1 — chat-only reaches the dropdown.** `supportsToolCalls` now threads through
`mergeDynamicModelOptions` into `ProviderModelOption`; `groupProviderModelOptions` sinks
known-too-small models to the bottom of their group; `ProviderModelOptionGroupList` renders the same
amber "Chat only" tag as settings. Models stay selectable — deliberate chat-only use is legitimate —
but never sit above a model that can do the work.

**P2 — the speed verdict is actionable and visible.** `nextSmallerRecommendation` walks one step down
the weight-ascending catalog. `LocalModelSetupJob` gained `tokensPerSecond` and `suggestedFallbackId`,
set only when a real measurement came back below the comfortable threshold *and* a smaller tier
exists — a null measurement is not evidence of slowness. The hero renders a **"Switch to X"** button
wired to `startSetup`, and installed rows now show the measured rate. Previously `tokensPerSecond`
was populated by the server and read by nothing.

Two things caught while testing:

- The downgrade block rendered the job message a second time, so the browser selector matched two
  elements. The existing block already showed it; the new block now adds only the button.
- That existing block is gated on `!ready`, but a completed setup *is* installed — so the speed
  complaint would have vanished exactly when the downgrade button appeared, leaving an unexplained
  button. Now shown when `!ready || fallback`.

Also tightened: the speed-verification tests still used `platform: "linux"`, whose resolver finds
`/usr/local/bin/ollama` on any developer Mac. Sandboxed to `win32`, the same leak fixed in Phases 1
and 5 — three occurrences of one root cause.

### Phase 7 — the deferred P3/P4 items

Run as two parallel subagents partitioned by **file ownership**, not by task: persistence and lazy
measurement both live in `LocalModelManager.ts`, and the hero link and dead-key cleanup both touch
all 7 locale files. Splitting any finer would have had them overwriting each other.

**Speeds persist across restarts.** `#measuredSpeeds` now round-trips through the existing
`setup-state.json` atomic write rather than a second write path. The test restarts the manager
against the same state dir and asserts both that the speed survives *and* that no new generation was
issued — proving it was read from disk, not silently re-measured. A malformed `speeds` block does not
prevent startup.

**Models outside the setup flow finally get measured.** Previously `#measureTokensPerSecond` was
called from exactly one place inside `#runSetup`, so anyone with pre-existing models — the common
case — saw the speed feature do nothing at all.

The design constraint mattered more than the feature: **never load a model just to benchmark it.**
Backgrounding a 13 GB load would spike memory and evict whatever the user is working with. So
measurement now reads Ollama's `/api/ps`, which lists models *already resident*; timing one of those
costs a single short generation. It runs detached from the existing 15s refresh, one model per tick,
with an attempted-key set so an untimeable model is not retried forever. The agent also caught a case
I had not specified: a concurrent setup verification would understate both measurements, producing
exactly the false "slower than ideal" alarm this feature exists to prevent — so it skips while a
setup is running.

**Hero "installed" is no longer a dead end** — it offers "Start a chat".

**11 dead `quick.*` keys removed** across all 7 locales (3081 → 3070 leaves, exactly −11).

One thing I corrected on review: the hero first navigated via `appHistory.push("/")` imported
directly into the presentational component. But `appHistory` appears nowhere else except `main.tsx`,
where it *constructs* the router — and this component already receives all four other actions as
callback props. Navigation is now an `onStartChat` callback supplied by the panel, which keeps the
component pure and let the browser test assert the click actually navigates rather than merely that
the button is enabled.

## Bug found by testing against real hardware

The mocked tests passed while the warm-up was measuring the wrong thing. Run against a live Ollama:

```
prompt "Reply with the single word: ready."   → eval_count=2   →   9 tok/s
prompt "Count from 1 to 60, separated by spaces." → eval_count=48 →  92 tok/s
```

`num_predict` is a **ceiling, not a target**. The original prompt asked for one word, so the model
stopped after two tokens, and dividing by that sample measured call overhead rather than throughput.
An M1 Max doing 92 tok/s would have been labelled "slower than ideal" — the precise false alarm this
phase exists to prevent.

Two fixes, both regression-tested:

1. The warm-up prompt now counts to 60 — deterministic, needs no creativity, and runs to the cap on
   every model.
2. `eval_count` below 16 returns `null` instead of a number. Too short a sample is worse than no
   measurement, because it understates a fast machine badly enough to warn about a healthy model.

Verified across three real installed models on the M1 Max: qwen2.5:3b 95 tok/s, qwen2.5:7b 48 tok/s,
llama3.2:1b 136 tok/s — all reaching the 48-token cap and all classified "comfortable".

## Catalog tags verified against the live Ollama registry

All six tags resolve, and every size estimate is at or slightly above actual — the safe direction
for the disk-space guard:

| Tag | Catalog | Actual |
|---|---|---|
| `qwen3:1.7b` | 1.4 GiB | 1.27 GiB |
| `qwen3.5:2b-q4_K_M` | 1.9 GiB | 1.81 GiB |
| `granite4.1:3b` | 2.1 GiB | 1.96 GiB |
| `qwen2.5-coder:7b` | 4.36 GiB | 4.36 GiB |
| `gpt-oss:20b` | 13 GiB | 12.85 GiB |
| `qwen3-coder:30b` | 19 GiB | 17.28 GiB |

The 30B over-estimate does not change the pick on any real Mac memory configuration, so the
estimates are left conservative.

## Proof on real hardware

Detection run against this development machine:

```
cpu: Apple M1 Max · 10 cores · 32 GiB
acceleration: apple_unified
budget: 13.4 GiB
recommended: GPT-OSS 20B (13 GiB)
```

The same machine previously received **Qwen3 Coder 30B (19 GiB)** — the largest model that fits
32 GB of RAM on paper, leaving roughly 13 GB for macOS and Electron. This is the regression the
budget rule was built to stop, confirmed end to end.

## Final verification

| Check | Result |
|---|---|
| `bun run typecheck` | 10/10 packages |
| `bun run lint` | 0 errors; 359 warnings (**−1** vs HEAD — changed files went 5 → 4, all 4 pre-existing) |
| `bun run test` | contracts 154 · web 2731 · desktop · shared · scripts · effect-acp · remote-protocol · remote-relay |
| `apps/server` tests | 2030 passed, 7 skipped |
| `apps/web` browser tests | 38 files, 212 tests passed |
| `bun run i18n:check` | 7 locales, 3078 leaves each, 0 residual English |
| `apps/remote-gateway` | 666 pass / 0 fail (flakes only under turbo parallelism; pre-existing, no dependency on changed packages) |

## Verification gate

Every phase must end green on:

```
bun run typecheck
bun run lint
bun run test
bun run i18n:check     # when UI strings changed
```

## Log

### Phase 1 — done

**Added** `apps/server/src/localModels/hardwareProfile.ts` — acceleration detection (Apple unified /
discrete GPU / CPU-only) and the weight budget. Windows VRAM reads the registry `qwMemorySize`, not
WMI `AdapterRAM`. Every probe failure degrades to `cpu_only`.

**Changed** `catalog.ts` — `recommendLocalModel` now takes the weight budget and selects on quantized
weight size instead of installed RAM.

**Added** the `qwen2.5-coder-7b` tier (4.36 GiB, verified against the live Ollama registry) filling
the 4–7 GB gap where 16 GB Macs and 8 GB-VRAM cards land.

**Contract** — `LocalHardwareProfile` / `LocalHardwareAcceleration`; `hardware` on
`LocalModelsSnapshot`.

Two findings worth recording:

1. **Catalog ordering was load-bearing and wrong.** `.at(-1)` means "largest that fits" only if the
   array is weight-ascending, but `granite-4.1-3b` (2.1 GiB) sat before `qwen3.5-2b` (1.9 GiB).
   Reordered, and `catalog.test.ts` now asserts the invariant so it cannot silently regress.
2. **A test encoded the bug.** `LocalModelManager.test.ts` asserted a 16 GB CPU-only Linux box should
   get `gpt-oss-20b` (13 GiB). Updated to `granite-4.1-3b`, with an explicit injected profile so the
   result no longer depends on whether the test host happens to have a GPU.

Verification: `typecheck` 10/10 packages, `lint` 0 errors, `test` green
(server 49, contracts 154, web 245, desktop 37, shared 35, scripts 19).

Pre-existing flake, unrelated: `@synara/remote-gateway` intermittently exits 1 under turbo's parallel
load while reporting 666 pass / 0 fail. Two direct runs pass with exit 0. It does not depend on
`@synara/contracts` or any changed package.

### Phase 2 — done

`LocalModelCardShelf.{tsx,test.ts,browser.tsx}` renamed to `LocalModelHero.*` (the tested view-model
builder is unchanged). The five-card horizontal shelf is replaced by:

- `LocalModelHero` — detected hardware line, one recommendation, one button, inline progress.
- `LocalModelAlternatives` — everything else, as a plain list inside the disclosure.

The duplicate "LM Studio models" section is deleted, and the LM Studio runtime row now lives inside
the disclosure. `moreOptions` relabelled "Show other models".

New browser tests assert the actual UX claim: the hero renders exactly one button, no competing
model names, and the GPU name when one is detected.

**Removing the shelf orphaned production code**, which the linter caught: `installedKeys`,
`localizedRecommendationDescription`, and the exported `isRecommendationBestFit` /
`recommendationSourceForRuntime` / `recommendationInstallInputForRuntime` were left with no callers
except their own tests. Removed both. Four i18n keys my change orphaned (`bestFit`, `installWith`,
`lmStudioModelsTitle`, `memoryTier`) removed across all 7 locales; pre-existing dead keys
(`quick.*`, `ollamaDescription`, and others) left alone.

Note: locale files must be written through the repo's own `canonicalCatalogJson` — the checker uses
locale-aware collation, so a plain code-point sort fails on the CJK catalogs.

### Phase 3 — done

`verifying` state added between `downloading_model` and `synchronizing`. After the download, one
~48-token generation is timed via `eval_count` / `eval_duration`, and the result is reported plainly:
comfortable at ≥15 tok/s, "slower than ideal" at 5–15, "too slow" below 5. A failed or untimeable
warm-up still reaches `ready` with `tokensPerSecond: null` — the model works, the label is just
unavailable.

The warm-up needs its own timeout: loading a cold model far exceeds the 2.5s probe budget, so
`#request` took an optional override (180s here).

### Phase 4 — done

- `parseParameterCount` handles both suffixes Ollama emits (`"7.6B"`, `"494.03M"`) and returns null
  for anything it cannot trust. Models under 3B now get `tool_call: false` instead of `null`, so
  OpenCode's `tool_call ?? true` default can no longer hand the agent a model that stalls silently.
- Curated models get their catalog display name instead of the raw tag.
- Provider groups renamed to "On this computer" / "On this computer (LM Studio)".
- Installed models that cannot take tool calls show a "Chat only" badge.
- The composer model picker gains a "Set up local AI…" entry when no local models are installed —
  read from the app-wide snapshot cache, so an absent or stale-schema entry correctly reads as
  "none installed".

Deviation from the spec, deliberate: model names omit the `(local)` suffix the spec suggested,
because the group heading now says "On this computer" and the suffix would repeat it.

Caught during review: the picker's setup entry was first written as `useMemo(..., [])`, which
computes once at mount and would have kept offering setup after the first model installed. It now
reads the cache at render time, matching how `LocalModelsSettingsPanel` already uses it.
