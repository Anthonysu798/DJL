# DJL Hero Magnetic Aperture Redesign

**Date:** 2026-07-20  
**Scope:** Hero section and its immediate background only  
**Status:** Approved through the user's autonomous redesign request

## 1. Objective

Replace the current bounded ExecutionAtlas-panel hero with a distinctive, professional, full-bleed technology composition that communicates DJL's core promise immediately:

- one agent
- any model
- any API
- local or connected execution

The hero must not resemble a chat product, an AI dashboard, a terminal mockup, a glass-card stack, or a generic blue-purple gradient landing page.

## 2. Inspiration Principles

The design adapts principles observed in high-quality technology work rather than copying a specific website:

1. **One coherent physical metaphor:** the hero behaves like a magnetic routing aperture. Every line, layer, object movement, and route signal belongs to that metaphor.
2. **Editorial scale contrast:** large direct typography, compact utility text, and a single dominant product object.
3. **Layered depth:** foreground copy, a midground Agent Core, and background aperture fields move at slightly different rates.
4. **Integrated navigation:** the existing command navigation remains visually connected to the opening composition.
5. **Concentrated motion:** expressive motion belongs to the aperture and routing system rather than being scattered across every element.
6. **Restraint:** no fake product interface is needed. The actual generated Agent Core and route geometry carry the story.

## 3. Selected Direction: DJL Magnetic Aperture

The hero uses a clean off-white editorial field on the left and a large custom cobalt execution field on the right. A near-black crescent cuts into the cobalt field, creating an aperture around the transparent Agent Core. The object crosses the white/color boundary so it feels physically present rather than placed inside a card.

The aperture is not a rounded rectangle, browser frame, dashboard, or generic background blob. It is a full-height structural shape made from layered CSS geometry and SVG route paths.

### Visual hierarchy

1. Floating command navigation
2. Hero eyebrow
3. Three-line product statement
4. Short product explanation
5. Mac and Windows actions
6. Agent Core crossing the aperture boundary
7. Integrated endpoint and route geometry
8. Baseline compatibility rail

## 4. Composition

### Desktop

- Hero height: `100svh`, with a minimum practical height of `760px`.
- Navigation keeps its existing position and behavior.
- Content shell remains `1280px` maximum width.
- Copy occupies approximately 44% of the shell and sits slightly below vertical center.
- The aperture occupies approximately 58% of the viewport from the center toward the right edge.
- The Agent Core is approximately `560-680px` wide at large desktop sizes.
- The Agent Core overlaps the aperture edge by roughly 18% of its width.
- The final headline line uses cobalt; the first two lines remain near-black.
- Platform actions remain directly below the body copy.
- Compatibility proof moves into a quiet horizontal rail along the lower hero boundary.

### Aperture geometry

The background consists of four coordinated layers:

1. **Base field:** cool off-white `#f5f7f6`, with very subtle paper noise from the existing global grain.
2. **Cobalt execution field:** `#1456f0`, clipped into a broad asymmetric shape entering from the right edge.
3. **Ink crescent:** `#0a0a0a`, positioned behind and partly around the Agent Core to increase contrast and create a physical aperture.
4. **Route layer:** thin white, ink, coral, and purple SVG curves with endpoint labels aligned to the geometry.

Do not use a uniform graph-paper grid. A small number of structural axes may remain, but each must align a real element such as the copy baseline, object center, proof rail, or route endpoint.

### Product object

Use `landingAssets.agentCore` through `next/image`.

- Keep its transparent edge visible.
- Do not place it inside a card or frame.
- Use a restrained drop shadow and an internal cobalt halo only where required for separation.
- The image remains informative on first use and keeps its existing descriptive alt text.
- Decorative duplicates are not added.

### Route system

Use five route labels from bilingual hero content:

- REST API
- MCP
- LOCAL MODEL
- TOOLS
- FILES

Labels are small edge annotations connected to the aperture by thin rules. They are not pill badges floating randomly over the image.

One active route uses a coral signal packet moving along a route between the object and one endpoint. Other paths remain quiet.

The existing atlas transcript, rectangular panel, crosshair registration marks, and fake status UI are removed from the visible hero.

## 5. Copy and Content

Preserve current bilingual hero content and the three-line title structure:

### English

- `One agent.`
- `Every model.`
- `Any API.`

### Chinese

Use the existing equivalent three-line content already defined in `app/content.ts`.

Preserve:

- eyebrow
- body copy
- Mac action
- Windows action
- proof labels
- route labels

The atlas-specific content object may remain temporarily for compatibility, but the visible hero must not render fake transcript or dashboard copy.

## 6. Motion

### Entrance

- Copy reveals by clipped lines using the existing Motion variants.
- The cobalt aperture enters with a horizontal mask expansion.
- The ink crescent scales from `0.94` to `1` with no bounce.
- The Agent Core enters from the right with a subtle rotation and blur-to-clear transition.
- Route paths draw after the object settles.

### Pointer response

`ExecutionAtlas` continues to own pointer response, but becomes the aperture stage.

- Background aperture moves no more than `6px`.
- Route plane moves no more than `10px`.
- Agent Core moves no more than `16px` and rotates no more than `3deg`.
- Motion values and springs remain outside React state.
- The effect runs only for fine pointers.

### Ambient motion

- Only one route signal may loop.
- Loop duration: approximately `5-7 seconds`.
- No floating chips, perpetual object bobbing, shimmer, or unrelated particles.

### Reduced motion

- Render the final composition immediately.
- Disable pointer response, route packet looping, mask expansion, and object rotation.
- Keep every route and label visible.

## 7. Responsive Behavior

### Tablet, `768-1023px`

- Stack copy above the aperture stage.
- Keep CTAs above the fold where practical.
- Aperture becomes a wide landscape stage below the copy.
- Agent Core remains fully visible and does not overlap paragraph text.
- Proof rail stays between copy and aperture or at the hero bottom.

### Mobile, below `768px`

- Hero text remains a clean single column.
- Headline uses the current bilingual mobile sizing and must not clip.
- Mac and Windows actions stack.
- Proof rail wraps into two short rows.
- Aperture becomes the lower 38-44% of the hero.
- Agent Core is cropped intentionally from the lower-right edge.
- Route labels reduce to three visible endpoints: API, LOCAL, and TOOLS.
- No object, aperture, or route label may overlap the body copy or actions.

## 8. Component Architecture

### `app/landing/HeroSection.tsx`

Responsibilities:

- hero semantic structure
- localized copy
- entrance sequencing
- platform actions
- proof rail
- mounting the aperture component

It must not own pointer values or route geometry.

### `app/landing/ExecutionAtlas.tsx`

Retain the file to preserve the current focused component boundary, but redefine its visible responsibility as the Magnetic Aperture stage:

- Agent Core image
- cobalt and ink spatial fields
- route SVG
- endpoint labels
- pointer depth motion
- reduced-motion behavior

It must no longer render a dashboard-like panel, transcript, fake readout, or status slot.

### `app/landing/landing.css`

Replace the current hero and ExecutionAtlas style blocks. Do not alter downstream section styles.

### `app/content.ts`

No hero copy rewrite is required. Remove atlas-specific visible dependencies only if TypeScript makes it safe; otherwise leave the fields unused for this pass.

## 9. Accessibility and Performance

- Keep one `h1`.
- Keep informative Agent Core alt text.
- Route visuals remain decorative and `aria-hidden` except for the figure's concise localized `aria-label`.
- Maintain visible focus states on both platform actions.
- Preserve the native cursor for text selection.
- Use `next/image` with explicit dimensions and a responsive `sizes` value.
- Keep the hero asset eager because it is the LCP candidate.
- No WebGL, canvas, video, remote iframe, or new dependency is introduced.
- Avoid layout shifts by reserving aperture-stage dimensions.

## 10. Validation

Verify:

- English desktop at `1440x900`
- Chinese default mobile at `390x844`
- tablet at `768x1024`
- landscape tablet at `1024x768`
- reduced-motion desktop

Acceptance checks:

1. The hero no longer resembles a card-based AI dashboard.
2. The Agent Core is visible and integrated into the background.
3. Headline, body, and CTAs remain readable in the first viewport.
4. No page-level horizontal overflow is introduced.
5. Route geometry reads as part of the composition.
6. The aperture is the one expressive hero device.
7. Mobile artwork does not overlap text or controls.
8. Reduced-motion mode is complete and static.
9. Lint, TypeScript, and production build pass.
10. Browser console has no errors or hydration warnings.
