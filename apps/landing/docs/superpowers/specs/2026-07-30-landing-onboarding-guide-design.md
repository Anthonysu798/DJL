# Landing onboarding guide — design

Date: 2026-07-30

## Problem

The landing site sells DJL but never tells a visitor how to use it. Two questions go unanswered:
how do you actually drive the agent, and how do you get a model running locally? Today the site has
no answer and nowhere to put one — the only links anywhere on it are `?lang=en`, `?lang=zh`,
`/download/mac/arm64`, `/download/mac/x64`, `#start`, and `#top`.

## Constraints discovered

1. **The home page is a pinned, wheel-driven experience.** `Site.tsx` renders `SiteNav`, `DjlHero`,
   `HeroRailGateway`, and `ContextRailField`; `ContextRailField` calls `preventDefault()` on wheel
   events to drive its own capability rail. Long instructional prose cannot live inside that scroll
   without fighting it.
2. **Chinese is the default locale.** `page.tsx:11` — `params.lang === "en" ? "en" : "zh"`. Every new
   surface must follow the same convention, not invent an English-first default.
3. **All copy is centralised in `app/content.ts`** as mirrored `en` / `zh` objects. `workflow`,
   `stack`, `cta`, `footer`, and `console` are already written in both languages but are not
   rendered by any component. The agent-loop copy this guide needs already exists.
4. **No jsdom and no vitest config in `apps/landing`.** CI runs `bunx vitest run --root apps/landing`
   and the only existing tests are colocated route tests. Component-rendering tests are out of scope;
   pure helpers are testable.
5. **Local model management is desktop-only** — `settings.localModels.desktopOnly`: "Local model
   management is available in the DJL desktop app."

## The instructions must match what DJL actually does

This is the crux. DJL does not ask users to run terminal commands, and a guide that told them to
would both misrepresent the product and be worse than the truth. From
`apps/server/src/localModels/`:

- `detectHardwareProfile()` probes processor, GPU, and memory on macOS, Windows, and Linux.
- `usableModelBytes()` derives a weight budget and deliberately biases the pick one tier down,
  because "a machine can hold a model it cannot run quickly, and speed is what users judge a local
  model on" (`catalog.ts:108-109`).
- `installLmStudioRuntime()` downloads LM Studio itself; `OllamaInstaller.ts` does the same for
  Ollama. The app's own copy: **"DJL installs, starts, and connects Ollama for you. No terminal or
  admin password needed."**
- LM Studio differs: **"Install LM Studio once, then DJL can start and manage its local server."**

### The single most important thing to communicate

`catalog.ts` marks `supportsToolCalls: false` on **Qwen3 1.7B** and **Qwen3.5 2B**, and warns that a
model below 3B parameters "cannot hold a tool-calling loop together well enough to drive the agent.
Handing such a model tool definitions produces a silent stall, not an error" (`catalog.ts:121-123`).

A visitor on an 8 GB laptop who installs a chat-only model and expects file edits will hit a dead
end that looks like a hang. The guide states this in plain language, up front, next to the model
table — not in a footnote. The related in-app failure mode gets the same treatment:
`contextTooSmallForTools` — "Chat only at the current {{loaded}}K context. Reload the model with at
least {{required}}K to use tools."

### Curated catalog (source of truth: `catalog.ts`)

| Model | Min memory | Ollama download | Drives the agent |
|---|---|---|---|
| Qwen3 1.7B | 4 GB | 1.4 GB | No — chat only |
| Qwen3.5 2B | 8 GB | 1.9 GB | No — chat only |
| Granite 4.1 3B | 8 GB | 2.1 GB | Yes |
| Qwen2.5 Coder 7B | 16 GB | 4.36 GB | Yes |
| GPT-OSS 20B | 16 GB | 13 GB | Yes |
| Qwen3 Coder 30B | 32 GB | 19 GB | Yes |

## Approach

A dedicated `/guide` route carries the depth; a compact block on the home page points to it.

Rejected alternatives: **all-in-page** (fights the wheel-driven rail, and buries reference material
a returning user needs to re-find); **guide page only** (a visitor who never scrolls past the hero
never learns the agent is drivable locally).

### `/guide` route

- `app/guide/page.tsx` — server component, reads `searchParams`, resolves locale with the same
  `params.lang === "en" ? "en" : "zh"` rule as the home page.
- Plain document scroll. No wheel interception, no pinning, no GSAP. It reuses the existing
  `content-light` surface and type tokens so it reads as the same product, not a bolted-on doc.
- A sticky section list for jumping between the two halves.
- Anchors `#use` and `#local-model` so the desktop app and support replies can deep-link a section.

### Content, part 1 — Using the agent

Reuses the existing bilingual `workflow` and `console.review` copy that is currently dead:

1. Describe the task in either language.
2. **Plan** — work is decomposed into ordered steps you read before anything runs.
3. **Tools** — each tool executes sandboxed, streaming output so nothing happens off-screen.
4. **Review** — every diff waits: *Approve & apply*, *Request changes*, or *Cancel / rollback*.

### Content, part 2 — Installing a local model

1. Get the desktop app — local model management is desktop-only.
2. Open **Settings → Local Models** ("Private inference").
3. DJL reports what it detected: processor, GPU, memory.
4. Pick a runtime — Ollama (DJL installs, starts, and connects it; no terminal or admin password) or
   LM Studio (install once, DJL manages its local server).
5. Install the recommendation, then select it in the model picker.

Followed by the model table, the chat-only warning, and the privacy note: DJL "connects only to
fixed loopback addresses (127.0.0.1)", and "prompts, code context, and output are not sent to a
hosted model provider."

Custom models are mentioned once, quoting `installHint`: an Ollama tag, an LM Studio catalog ID, or
an exact Hugging Face model URL.

### Home page entry point

A short block rendered after `ContextRailField` inside the existing `content-light` wrapper: three
compressed steps and a link to `/guide`. Plus a `Guide` item in `SiteNav`. The nav currently emits
only same-page `#` anchors, so it needs to handle one real route link.

### Content model

A new `guide` key in `content.ts` under both `en` and `zh`. Model names and byte sizes are
locale-neutral and live in one shared const rather than being duplicated per locale — duplicating
them is how the two languages drift out of sync with `catalog.ts`.

The table is **hand-maintained from `catalog.ts`, not imported from it.** `apps/landing` builds
standalone and is mirrored to a separate deployment repository, so it cannot depend on
`apps/server`. A comment in `content.ts` names `catalog.ts` as the source so the next editor knows
where the numbers came from.

## Testing

- A pure formatter (bytes → display size) unit-tested with vitest, colocated as `*.test.ts`.
- A test asserting the `en` and `zh` `guide` objects have identical key shape and equal-length step
  arrays — the failure this actually prevents is a half-translated section shipping.
- A test asserting every catalog row marked chat-only carries the warning flag, so a future edit
  cannot silently drop the one warning that matters most.
- Verification: `bunx vitest run --root apps/landing` and `bun run --cwd apps/landing build`, then
  load `/guide` and `/guide?lang=en` in a browser and read them.

## Out of scope

Screenshots of the app (they would need to be captured and kept current), a changelog or status
page, wiring the other dead `content.ts` sections, and any change to the desktop app itself.
