# DJL Hero Redesign Design

**Date:** 2026-07-19  
**Status:** Approved through the user's instruction to make the design decisions autonomously and proceed without further questions.

## Objective

Replace the current glossy 3D, grid-heavy hero with a bespoke technology-product composition that feels precise, editorial, and professional. The new hero must explain DJL as an open execution layer connecting models, APIs, local tools, and desktop workflows without relying on generic AI imagery, glass cards, gradient blobs, or an interchangeable SaaS dashboard.

## Research synthesis

The Awwwards technology references consistently favor one strong first-viewport premise, typography used as a visual asset, controlled asymmetry, a deliberate signature color, integrated navigation, and motion that reveals product behavior rather than adding ambient spectacle. Relevant references include the [Awwwards technology gallery](https://www.awwwards.com/websites/technology/), [Family Style](https://www.awwwards.com/sites/family-style), [PLATFORM](https://www.awwwards.com/platform/), [Studio Size / Exat Typeface](https://www.awwwards.com/studio-size.com/), [CoffeeTech](https://coffee-tech.com/), [Cantor8](https://www.cantor8.io/), and [AppSignal](https://www.appsignal.com/).

## Considered directions

### 1. Execution Atlas — selected

A light editorial canvas containing a custom, code-built runtime map. Models, APIs, files, tools, MCP, and REST become labeled endpoints connected through a central DJL execution rail. It is visually distinctive while making the product legible.

### 2. Kinetic Wordmark

An ultra-minimal hero dominated by animated typography and a compact command strip. This would be memorable but would explain less about the product and risk making the page feel like a studio portfolio.

### 3. Dark Console Stage

A black, high-contrast hero with terminal-like traces and chromatic status signals. This would feel technical but would clash with the existing light landing page and could become another familiar developer-tool aesthetic.

## Selected concept: Execution Atlas

### Visual premise

DJL is presented as a routing and execution system, not as a synthetic intelligence object. The hero's visual centerpiece is an original runtime diagram built from semantic HTML, CSS, and inline SVG. It shows requests moving through DJL toward concrete endpoints such as local models, MCP, REST, files, and tools.

No generated hero image, 3D model, video, WebGL scene, or stock illustration is used.

### Composition

- Use a full first viewport with a deliberate two-column composition on desktop.
- The left side contains the eyebrow, headline, concise supporting copy, platform download actions, and a small compatibility/proof line.
- The right side contains the Execution Atlas, scaled large enough to act as the hero artwork rather than a dashboard screenshot.
- Preserve the core message: **One agent. Every model. Any API.**
- Keep `Any API.` as the only large cobalt accent so the promise remains memorable.
- Ensure the heading has stable, intentional line breaks and cannot clip at common desktop widths.
- Let the next section appear slightly at the bottom edge so the page feels continuous rather than like an isolated poster.

### Navigation

- Keep existing links, locale switching, active-section behavior, download anchor, and accessibility semantics.
- Replace the oversized floating capsule with a slimmer integrated navigation bar aligned to the hero shell.
- Use a fine bottom rule and controlled white translucency only when needed for legibility.
- Retain a compact black download control as the primary nav action.
- Mobile navigation continues to collapse, but its spacing and controls inherit the new visual language.

### Background and color

- Base: warm white rather than stark white.
- Primary ink: near-black.
- Signature accent: cobalt blue.
- Secondary runtime states: restrained signal orange and violet, used only in small labels or moving trace points.
- Replace the uniform square grid with custom cartographic linework: sparse routing curves, coordinate ticks, cropped arcs, and a localized dot field around the runtime visual.
- Background marks must be compositional and anchored to the Execution Atlas, not repeated wallpaper.
- Avoid glow clouds, mesh gradients, glassmorphism, large blur effects, and decorative floating pills.

### Execution Atlas structure

The artwork consists of independently understandable layers:

1. **Atlas frame:** an asymmetric coordinate field with cropped rules and registration marks.
2. **DJL core rail:** a bold central horizontal/diagonal route labeled `DJL / OPEN EXECUTION` with a visible ready state.
3. **Endpoint modules:** semantic labels for `LOCAL MODEL`, `MCP`, `REST API`, `FILES`, and `TOOLS`.
4. **Execution trace:** a small moving signal that travels across selected paths and changes endpoint states.
5. **Runtime transcript:** two or three compact monospaced lines such as route selection, tool authorization, and completion time. This is proof of behavior, not a fake terminal window.
6. **Status metadata:** small labels for local-first execution and protocol compatibility.

The visual should be readable without motion. Motion enhances causality but never carries essential information.

### Typography

- Continue using DM Sans to avoid adding a new font dependency.
- Use very large, tightly tracked display text with improved line-height and responsive clamps.
- Use a system monospaced stack for runtime metadata, protocol labels, and transcript lines.
- Keep supporting text measured and compact; avoid unnecessary marketing copy.
- English and Chinese variants must receive deliberate sizing and wrapping rather than sharing one fragile layout.

### Calls to action and proof

- Keep Mac and Windows download actions linked to the existing `#download` section.
- Primary Mac action remains dark and high contrast.
- Windows becomes a quieter outlined action.
- Reduce excessive pill styling; use compact radii and strong typography.
- Add a small proof line near the actions: local-first, MCP/REST compatible, and available on macOS/Windows. This uses existing product facts and does not introduce unsupported claims.

### Motion

Motion is restrained and purposeful:

- Stagger the eyebrow, heading, copy, and actions on entry.
- Draw the main route once, then run a slow signal trace through the atlas.
- Update endpoint active states in sequence to demonstrate one execution path.
- Apply very small pointer-responsive depth only inside the atlas on fine pointers.
- Do not move the headline continuously.
- Disable traces, parallax, and nonessential transitions under `prefers-reduced-motion`.

### Responsive behavior

- At tablet widths, reduce the atlas scale and allow it to overlap the right edge without obscuring copy.
- At mobile widths, stack copy above the atlas and simplify the route geometry rather than fading a desktop artwork behind the text.
- Keep both CTAs full-width only on narrow phones.
- Hide nonessential transcript and coordinate details when space is limited, while preserving the main core rail and endpoint labels.
- Avoid absolute positioning that causes headline clipping or large dead areas.

## Component architecture

- Refactor `app/landing/HeroSection.tsx` into a clear hero composition while preserving locale content and existing motion utilities.
- Add a focused `ExecutionAtlas` component under `app/landing/` for the SVG/semantic artwork and trace states.
- Keep hero-specific styling in `app/landing/landing.css`, grouped by hero shell, copy, atlas, and responsive rules.
- Update `app/SiteNav.tsx` only where structure or class names are required for the integrated navigation; preserve section tracking and GSAP scrolling behavior.
- Update `app/content.ts` only if small proof labels or localized atlas labels require content entries.
- Stop rendering `public/generated/djl-agent-core.png`; do not delete unrelated assets during this task.

## Accessibility and robustness

- The atlas is decorative/supporting and must be hidden from screen readers unless a concise accessible description adds useful product information.
- All text must meet contrast requirements on the warm background.
- Keyboard focus remains visible on navigation and CTAs.
- Pointer effects must not interfere with links or coarse-pointer devices.
- The layout must remain useful when JavaScript or animation is unavailable.
- Avoid hydration-sensitive random values; all trace paths and timings are deterministic.

## Verification

- Run `npm run lint` and `npm run build`.
- Launch the application and visually inspect desktop, tablet, and mobile widths.
- Verify English and Chinese layouts.
- Verify reduced-motion behavior and keyboard focus.
- Confirm nav section tracking, locale switching, and `#download` links still work.
- Confirm the old generated hero image is no longer requested in the first viewport.

## Scope boundaries

This redesign covers the hero and its integrated navigation treatment. It may adjust the immediate handoff into the following section for continuity, but it does not redesign the rest of the landing page or replace the existing product content architecture.
