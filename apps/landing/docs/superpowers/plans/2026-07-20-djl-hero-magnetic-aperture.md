# DJL Hero Magnetic Aperture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current dashboard-like ExecutionAtlas hero visual with a full-bleed cobalt/ink Magnetic Aperture composition centered on the existing transparent DJL Agent Core.

**Architecture:** Keep `HeroSection` responsible for semantic copy, entrance sequence, platform actions, and the proof rail. Keep `ExecutionAtlas` as the focused client-side visual island, but redefine it as the aperture stage that owns the Agent Core, route SVG, endpoint annotations, and pointer depth motion. Replace only the hero and ExecutionAtlas CSS block so every downstream section and intentional hydration/performance change remains intact.

**Tech Stack:** Next.js 16.2.9, React 19.2.7, TypeScript, Motion 12.40.0, `next/image`, existing `landingAssets`, existing `useHydratedReducedMotion`, native CSS and SVG.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-20-djl-hero-magnetic-aperture-design.md`.
- Preserve the current intentional `useHydratedReducedMotion` integration.
- Preserve the current intentional `SiteNav`, downstream landing sections, bilingual content, and platform actions.
- Do not reintroduce the old graph-paper split hero, dashboard panel, transcript, fake readout, registration marks, chat UI, glass stack, remote embed, WebGL, or canvas.
- Use `landingAssets.agentCore` through `next/image` as the only hero product object for this focused pass.
- Preserve the intentional `routeRobot` and `relayRobot` asset entries and files without deleting or rewriting them.
- Keep one `h1` and the existing three-line title structure.
- Keep the hero within `100svh` on desktop and keep both CTAs visible in the first mobile viewport.
- Motion values must stay outside React state.
- Reduced motion must render a complete static composition.
- Do not modify or revert unrelated intentional working-tree changes.
- Do not commit.

## File Structure

### Modify

- `app/landing/ExecutionAtlas.tsx` - convert the visual island from a bounded dashboard panel into the Magnetic Aperture stage.
- `app/landing/HeroSection.tsx` - remove the old cartography wrapper and move proof items into a baseline rail outside the copy column.
- `app/landing/landing.css` - replace only the block from `/* Hero */` through the line immediately before `/* Compatibility ribbon */`; keep navigation and downstream CSS unchanged.

### Reuse unchanged

- `app/landing/assets.ts` - `landingAssets.agentCore` source, dimensions, and alt text.
- `app/landing/useHydratedReducedMotion.ts` - hydration-safe reduced-motion state.
- `app/landing/primitives.tsx` - platform icons and magnetic links.
- `app/content.ts` - existing bilingual title, body, proof, route labels, and atlas `ariaLabel`/route copy.

---

### Task 1: Convert ExecutionAtlas into the Magnetic Aperture Stage

**Files:**

- Modify: `app/landing/ExecutionAtlas.tsx`

**Interfaces:**

- Consumes: `copy: LandingContent["hero"]["atlas"]`, `routeLabels: LandingContent["hero"]["routeLabels"]`, and `cursorLabel: string`.
- Reuses: `landingAssets.agentCore` and `useHydratedReducedMotion()`.
- Produces: the same exported `ExecutionAtlas` component signature, so `HeroSection` and content contracts stay stable.

- [ ] **Step 1: Replace the current panel imports and visual model**

Add `next/image` and `landingAssets`; retain Motion values and the hydrated reduced-motion hook:

```tsx
import Image from "next/image";
import type { PointerEvent } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import type { LandingContent } from "../content";
import { landingAssets } from "./assets";
import { useHydratedReducedMotion } from "./useHydratedReducedMotion";
```

- [ ] **Step 2: Define separate depth values for the field, route plane, and Agent Core**

Use one pointer input and derive restrained motion:

```ts
const pointerX = useMotionValue(0);
const pointerY = useMotionValue(0);
const springX = useSpring(pointerX, { stiffness: 92, damping: 22, mass: 0.55 });
const springY = useSpring(pointerY, { stiffness: 92, damping: 22, mass: 0.55 });

const fieldX = useTransform(springX, [-0.5, 0.5], [-5, 5]);
const fieldY = useTransform(springY, [-0.5, 0.5], [-4, 4]);
const routesX = useTransform(springX, [-0.5, 0.5], [-9, 9]);
const routesY = useTransform(springY, [-0.5, 0.5], [-7, 7]);
const coreX = useTransform(springX, [-0.5, 0.5], [-15, 15]);
const coreY = useTransform(springY, [-0.5, 0.5], [-12, 12]);
const coreRotate = useTransform(springX, [-0.5, 0.5], [-2.4, 2.4]);
```

Keep the existing pointer normalization and reset functions. Do not use `useState`.

- [ ] **Step 3: Replace the dashboard markup with the aperture layers**

Use this semantic structure:

```tsx
<motion.figure
  className="execution-atlas"
  initial={reduce ? false : { opacity: 0, x: 42 }}
  animate={{ opacity: 1, x: 0 }}
  transition={{ duration: 1, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
  onPointerMove={move}
  onPointerLeave={reset}
  data-cursor="route"
  data-cursor-label={cursorLabel}
  role="img"
  aria-label={copy.ariaLabel}
>
  <motion.div
    className="aperture-field"
    style={reduce ? undefined : { x: fieldX, y: fieldY }}
    aria-hidden="true"
  >
    <span className="aperture-cobalt" />
    <span className="aperture-ink" />
    <span className="aperture-rim" />
  </motion.div>

  <motion.svg
    className="aperture-routes"
    viewBox="0 0 760 650"
    fill="none"
    aria-hidden="true"
    style={reduce ? undefined : { x: routesX, y: routesY }}
  >
    <path className="aperture-route aperture-route-rest" d="M64 124C218 124 240 230 358 230" />
    <path className="aperture-route aperture-route-mcp" d="M704 150C560 150 532 232 410 232" />
    <path className="aperture-route aperture-route-files" d="M706 330C568 330 530 315 430 315" />
    <path
      className="aperture-route aperture-route-active"
      pathLength="1"
      d="M120 548C252 548 274 395 366 395"
    />
    <path className="aperture-route aperture-route-tools" d="M676 520C548 520 512 398 410 398" />
    <circle className="aperture-signal" cx="366" cy="395" r="7" />
  </motion.svg>

  <motion.div
    className="aperture-core"
    style={reduce ? undefined : { x: coreX, y: coreY, rotate: coreRotate }}
  >
    <span className="aperture-core-halo" aria-hidden="true" />
    <Image
      src={landingAssets.agentCore.src}
      alt={landingAssets.agentCore.alt}
      width={landingAssets.agentCore.width}
      height={landingAssets.agentCore.height}
      className="aperture-core-image"
      loading="eager"
      sizes="(max-width: 620px) 82vw, (max-width: 1023px) 64vw, 48vw"
    />
  </motion.div>

  <div className="aperture-route-status">
    <span>{copy.activeRoute}</span>
    <strong>{copy.route}</strong>
  </div>

  {routeLabels.map((label, index) => (
    <span className={`aperture-endpoint endpoint-${index + 1}`} key={label}>
      {label}
    </span>
  ))}
</motion.figure>
```

Do not render `copy.transcript`, `copy.kicker`, `copy.mode`, `copy.core`, or `copy.ready` visibly in this pass. Retaining those content fields is safer than changing unrelated content contracts.

- [ ] **Step 4: Validate the visual island contract**

Run:

```bash
npx eslint app/landing/ExecutionAtlas.tsx && npx tsc --noEmit
```

Expected: exit code 0 and the exported component signature remains unchanged.

---

### Task 2: Recompose HeroSection and the Proof Rail

**Files:**

- Modify: `app/landing/HeroSection.tsx`

**Interfaces:**

- Consumes the current `LandingContent["hero"]` without schema changes.
- Continues to render `<ExecutionAtlas copy={copy.atlas} routeLabels={copy.routeLabels} cursorLabel={cursorLabel} />`.

- [ ] **Step 1: Remove the old cartography wrapper**

Delete only this visible background markup:

```tsx
<div className="hero-cartography" aria-hidden="true">
  <span className="hero-arc hero-arc-a" />
  <span className="hero-arc hero-arc-b" />
  <span className="hero-axis hero-axis-x" />
  <span className="hero-axis hero-axis-y" />
</div>
```

The aperture component now owns the expressive background geometry.

- [ ] **Step 2: Keep the copy and CTA sequence unchanged**

Preserve the current eyebrow, three-line heading, body, and both `MagneticLink` actions. Keep the accent on title index `2` and retain `useHydratedReducedMotion()`.

- [ ] **Step 3: Move the proof list outside `.hero-copy` and below `.hero-grid`**

Remove the current proof list from inside `.hero-copy`, then render it as a hero-level rail:

```tsx
<motion.ul
  className="hero-proof hero-proof-rail shell"
  initial={reduce ? false : { opacity: 0, y: 14 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: reduce ? 0 : 0.6, delay: 0.72, ease: [0.16, 1, 0.3, 1] }}
  aria-label={copy.proofLabel}
>
  {copy.proof.map((item) => (
    <li key={item}>
      <i aria-hidden="true" />
      {item}
    </li>
  ))}
</motion.ul>
```

Place the rail after the closing `.hero-grid` div and before the section closes.

- [ ] **Step 4: Validate semantics**

Run:

```bash
npx eslint app/landing/HeroSection.tsx && npx tsc --noEmit
```

Expected: one `h1`, one proof list, no old cartography markup, and no type errors.

---

### Task 3: Replace the Hero and Atlas CSS with the Magnetic Aperture System

**Files:**

- Modify: `app/landing/landing.css`

**Interfaces:**

- Styles the existing hero class names plus the new `aperture-*` class family.
- Must not alter `.command-*` navigation styles or any rule after `/* Compatibility ribbon */` except existing reduced-motion overrides that directly reference removed atlas classes.

- [ ] **Step 1: Replace the marker-delimited hero block safely**

Replace the text between `/* Hero */` and `/* Compatibility ribbon */` with a new block. Preserve both marker comments so future edits stay scoped.

- [ ] **Step 2: Implement the desktop composition**

The new CSS must include these exact structural decisions:

```css
.hero-section {
  position: relative;
  display: grid;
  min-height: max(760px, 100svh);
  align-items: center;
  overflow: hidden;
  padding: 108px 0 88px;
  background: #f5f7f6;
  isolation: isolate;
}

.hero-section::before {
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    linear-gradient(
      90deg,
      transparent 0 45%,
      rgba(10, 10, 10, 0.055) 45% calc(45% + 1px),
      transparent calc(45% + 1px)
    ),
    linear-gradient(
      transparent 0 77%,
      rgba(10, 10, 10, 0.06) 77% calc(77% + 1px),
      transparent calc(77% + 1px)
    );
  content: "";
  pointer-events: none;
}

.hero-grid {
  position: relative;
  z-index: 3;
  display: grid;
  grid-template-columns: minmax(0, 0.82fr) minmax(560px, 1.18fr);
  align-items: center;
  gap: clamp(22px, 3vw, 48px);
}

.hero-copy {
  position: relative;
  z-index: 6;
  max-width: 610px;
  padding: 54px 0 88px;
}

.hero-heading {
  margin: 22px 0 0;
  color: var(--ink);
  font-size: clamp(4rem, 5.6vw, 6.25rem);
  font-weight: 610;
  letter-spacing: -0.074em;
  line-height: 0.86;
}

.hero-heading-line {
  display: block;
  overflow: hidden;
  padding-bottom: 0.11em;
  white-space: nowrap;
}

.hero-heading-line > span {
  display: block;
}
.hero-heading-accent {
  color: var(--blue);
}

.hero-body {
  max-width: 45ch;
  margin: 25px 0 0;
  color: rgba(34, 34, 34, 0.72);
  font-size: clamp(1rem, 1.2vw, 1.12rem);
  line-height: 1.58;
}
```

Keep the current button styling language, with dark primary and white secondary actions. The proof rail is absolutely aligned near the hero bottom on desktop and uses sparse dividers instead of badge styling.

- [ ] **Step 3: Implement the aperture field and Agent Core styles**

Required characteristics:

- `.execution-atlas` is unframed and at least `650px` tall.
- `.aperture-cobalt` fills the right stage with `#1456f0` and uses an asymmetric `clip-path`.
- `.aperture-ink` forms a large near-black crescent or elliptical cut behind the core.
- `.aperture-rim` is a restrained white/transparent edge line.
- `.aperture-core` crosses the left boundary of the cobalt field.
- `.aperture-core-image` is approximately `min(680px, 54vw)` wide on large desktop.
- `.aperture-routes` fills the stage and remains behind the image.
- Endpoint labels are plain edge annotations with a short line, not pills or cards.
- `.aperture-route-active` uses one coral signal animation lasting `6s`.
- The route status is compact, aligned to the lower-right edge, and contains no fake terminal frame.

- [ ] **Step 4: Implement tablet and mobile collapse rules**

At `max-width: 860px`:

- Hero grid becomes one column.
- Copy stays above the aperture.
- CTAs remain above the aperture stage.
- Aperture width is `min(100%, 760px)` and centered.
- Proof rail becomes relative instead of absolute.

At `max-width: 620px`:

- Hero padding is approximately `88px 0 34px`.
- Both CTAs stack and remain at least `52px` high.
- Proof items wrap without decorative cards.
- Aperture stage is `420-500px` tall.
- Agent Core is cropped from the lower-right and does not overlap copy.
- Only endpoint labels `1`, `3`, and `4` remain visible.
- Chinese headline sizing remains explicitly controlled.

- [ ] **Step 5: Implement reduced-motion final states**

Under `prefers-reduced-motion: reduce`:

```css
.aperture-field,
.aperture-routes,
.aperture-core {
  transform: none !important;
}

.aperture-route-active,
.aperture-signal {
  animation: none !important;
}
```

All routes and the core remain visible.

- [ ] **Step 6: Remove stale hero selectors**

The final hero block must contain no visible styling for:

- `.hero-cartography`
- `.hero-arc*`
- `.hero-axis*`
- `.execution-atlas-plane`
- `.atlas-registration*`
- `.atlas-dot-field`
- `.atlas-core*`
- `.atlas-transcript`
- `.atlas-endpoint*`
- `.atlas-route-readout`

- [ ] **Step 7: Validate CSS integration**

Run:

```bash
npm run lint && npx tsc --noEmit && npm run build
```

Expected: all commands exit 0, with no missing class imports or CSS parse errors.

---

### Task 4: Run and Visually Verify the Hero

**Files:**

- Modify only the three hero files if a screenshot exposes a concrete problem.

**Interfaces:**

- Verifies the complete hero at both locales and all target motion modes.

- [ ] **Step 1: Start the production build on an available localhost port**

Use the run skill. Prefer port 3000 if free and do not terminate unknown listeners.

- [ ] **Step 2: Capture desktop English at 1440x900**

Verify:

- Navigation remains one line and visually integrated.
- All three headline lines are visible without clipping.
- Both CTAs are visible.
- Agent Core is the dominant visual object.
- Cobalt and ink layers read as one aperture, not two generic blobs.
- Route annotations align to real route geometry.
- Proof rail is quiet and does not compete with CTAs.
- No page-level horizontal overflow.

- [ ] **Step 3: Capture Chinese mobile at 390x844**

Verify:

- Chinese title does not clip.
- Body and CTAs are unobstructed.
- Both CTA labels remain one line.
- Proof rail is readable.
- Agent Core appears below the actions and is intentionally cropped.
- No custom pointer is rendered for a coarse pointer.

- [ ] **Step 4: Capture tablet and reduced-motion states**

Check `768x1024`, `1024x768`, and desktop reduced motion. Reduced motion must show the final aperture without looping route animation or pointer displacement.

- [ ] **Step 5: Check browser runtime and final commands**

Expected console: no errors or hydration warnings.

Run:

```bash
npm run lint && npx tsc --noEmit && npm run build && git status --short
```

Expected: lint, type-check, and build exit 0. The working tree remains uncommitted.

## Plan Self-Review Result

- Spec coverage: composition, Agent Core restoration, route system, proof rail, motion ownership, responsive behavior, accessibility, and real browser validation are all mapped to explicit tasks.
- Scope: only `HeroSection`, `ExecutionAtlas`, and the marker-delimited hero CSS block are modified.
- Type consistency: existing hero content and component props remain unchanged.
- Preservation: current `useHydratedReducedMotion`, `SiteNav`, and unrelated landing changes are explicitly retained.
- Commit policy: no commit step is included because the user did not authorize commits.
