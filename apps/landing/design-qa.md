# Design QA: DJL Context Observatory

## Test target

- Source visual truth: `artifacts/context-observatory-reference/selected-reference.png` (1237 × 1271).
- Normalized source: `artifacts/context-observatory-qa/reference-normalized-932x958.png`.
- Production implementation: `http://localhost:3000/?lang=zh&v=own-spline-desktop#workflow`.
- Primary state: Chinese, chapter 02 / Workflow.
- Desktop environment: 932 × 958 CSS px, DPR 1, reduced motion off.
- Mobile environment: 390 × 844 CSS px.

## Final comparison evidence

- Production screenshot: `artifacts/context-observatory-qa/production-final-workflow.png`.
- Full same-viewport comparison: `artifacts/context-observatory-qa/comparison-final-full.png`.
- Heading comparison: `artifacts/context-observatory-qa/comparison-final-heading.png`.
- Orbit comparison: `artifacts/context-observatory-qa/comparison-final-orbit.png`.
- Card and event-log comparison: `artifacts/context-observatory-qa/comparison-final-panels.png`.
- Mobile screenshot: `artifacts/context-observatory-qa/mobile-390x844-workflow.png`.

## Fidelity findings

- No actionable P0, P1, or P2 differences remain.
- Layout: the fixed header, five-column chapter rail, eyebrow, two-line title, orbit stage, task object, event log, and integrity readout match the source hierarchy and measured placement. The orbit stage is 508.6 × 547.6 px at x 214.7 / y 266.5; the object card is 189.8 × 252.8 px at x 33.2 / y 620.8.
- Typography: the final title ink bounds are within 0–1 px of the normalized source horizontally and within 0–1 px on the second line vertically. Copy, line breaks, weights, blue labels, and compact technical counters follow the source.
- Assets: the metallic DJL context core and technical orbit tracks are real transparent raster assets created with built-in ImageGen, then sized to their measured slots. Visible UI icons use Lucide rather than handmade drawings.
- Color and surface: the cool white grid, charcoal type, pale blue-gray rules, electric-blue status path, layered node rings, and silver core are visually aligned with the reference.
- Responsive behavior: the 390 px layout becomes a focused mobile observatory with sticky orbit, chapter status, and five-step rail; measured document width is 380 px and there is no horizontal overflow.

## Interaction and behavior

- Chapter 03 click changed the URL to `#bilingual`, set chapter state to `2`, and moved the task packet to `77%`.
- Chapter 02 click restored `#workflow`, chapter state `1`, and the measured packet position `86.6%`.
- The task-object Inspect control exposes `aria-expanded=true` and reveals realistic scope data; the Chinese close control restores the compact card.
- Direct production reload at `#workflow` waits for the existing hero intro, then restores the correct section and scroll state.
- Navigation, chapter links, visible buttons, live status regions, keyboard focus styles, and the reduced-motion CSS fallback are present.

## Comparison history

1. [P2] The first implementation inherited the previous horizontal rail and did not match the selected observatory composition.
   - Fix: rebuilt the section around the measured chapter rail, circular orbit, side panels, and bottom integrity readout.
2. [P2] Early passes scaled the desktop frame around the scrollbar, compressed the task card, and used the wrong Chinese heading selector.
   - Fix: aligned the frame to the viewport, corrected `.stage[lang="en"]`, and set the source-derived absolute geometry.
3. [P2] The core, orbit opacity, active-node halos, task orb, and title rhythm were visibly different in the combined comparison.
   - Fix: resized the generated core, increased orbit detail visibility, neutralized node halos, repositioned the packet, and matched title ink bounds.
4. [P2] The lower integrity readout lacked the reference brackets.
   - Fix: added semantic decorative bracket elements and retuned the six-column readout.
5. [P3] The local-node icon silhouette differed from the source.
   - Fix: selected the closest available Lucide cube/box icon.

## Accepted P3 variance

- The existing site navigation keeps its pale-blue active pill because it is part of the already-approved first-page design; the reference uses blue text only.
- The generated silver core has slightly stronger material contrast than the source, and a few ultra-fine orbit hatch marks vary at subpixel scale.
- The source's custom local icon differs by a few internal strokes from the closest library icon.

## Engineering verification

- `npx tsc --noEmit --incremental false`: passed.
- `npx eslint app/ContextRailStory.tsx`: passed.
- `npm run build`: passed with Next.js 16.2.9.
- Production server: running on port 3000 and verified in the in-app browser.
- Repository-wide `eslint . --quiet` still reports 21 pre-existing errors in `SiteNav.tsx`, `HeroChrome.tsx`, `HeroStage.tsx`, and an older audit script; none are introduced by this section and the production build succeeds.

## Wide-screen repair regression (2026-07-22)

- Reported failure reproduced at 1916 × 988 in the in-app browser: the logical 1237 × 1271 observatory was being forced into a 1237 × 988 box, so horizontal geometry stayed full-size while vertical geometry compressed.
- Final production screenshot: `artifacts/context-observatory-wide-fix/production-final-1916x988-workflow.png`.
- Same-state, same-viewport reference/production comparison: `artifacts/context-observatory-wide-fix/qa-reference-vs-implementation.png`.
- Additional regression captures: `artifacts/context-observatory-wide-fix/after-932x958-workflow.png` and `artifacts/context-observatory-wide-fix/after-390x844-workflow.png`.

### Wide-screen findings and resolutions

1. [P2] The desktop frame lost its source aspect ratio on short, wide displays, pulling nodes away from their orbit tracks and crowding the side panels.
   - Fix: constrained the frame by both available width and viewport height, restored the 1237 / 1271 aspect ratio, centered it, and based desktop typography and controls on frame container units.
2. [P2] The desktop compact rules queried browser width even when the actual design frame was narrower than 980 px.
   - Fix: moved those rules to a named frame container query, so the layout responds to the rendered design canvas rather than unused side whitespace.
3. [P2] Tailwind's global image maximum silently clamped the orbit artwork from 108% to 100%, leaving the track and node coordinates visibly out of phase.
   - Fix: explicitly removed the orbit image maximum; its computed unrotated size is now 566.688 px against a 565.9 px orbit slot.
4. [P2] Opening the task-object inspector pushed the action control 6.7 px below the card at the repaired wide-screen scale.
   - Fix: scaled the card's vertical rhythm with the frame; closed and expanded states now remain fully contained.
5. [P3] The approved site header remains full-width while the source-derived observatory canvas is height-fitted and centered on wide displays.
   - Accepted intentionally to preserve the already-approved first-page navigation system.

### Final wide-screen acceptance

- 1916 × 988: frame 961.6 × 988 at x 472.2; chapter 02 and `#workflow` restore correctly; document width equals client width with no horizontal overflow.
- 932 × 958: frame 922 × 947.3 at x 0; chapter rail, orbit, panels, and integrity readout remain contained.
- 390 × 844: the dedicated mobile observatory is active, the desktop frame is hidden, and document width equals client width.
- Chapter navigation, task-object expand/collapse, and orbit-node selection were exercised in the in-app browser.
- `npx tsc --noEmit --incremental false`: passed.
- `npx eslint app/ContextRailStory.tsx`: passed.
- `npm run build`: passed with Next.js 16.2.9.
- No actionable P0, P1, or P2 differences remain in the final combined comparison.

## Desktop launch gate (2026-07-22)

- Approved visual truth: `artifacts/desktop-launch-gate/approved-reference.png`.
- Generated environment plate: `public/generated/djl-desktop-launch-bg-v1.png` (background only; all copy, controls, core, orbits, beams, and interactions remain live layers).
- Production screenshot: `artifacts/desktop-launch-gate/production-final-890x958.png`.
- Same-canvas comparison: `artifacts/desktop-launch-gate/comparison-890x958.png`.
- Verified URL/state: `http://localhost:3000/?lang=zh`, Chinese, final launch stage, 890 x 958 CSS px.

### Launch-gate findings and resolutions

1. [P2] The first pass made the metallic core too small and too high relative to the approved composition.
   - Fix: increased the responsive core from 24vw to 30vw at the current viewport and moved the full apparatus from 48% to 52% vertical center.
2. [P2] Platform metadata clipped mid-word on the 890 px browser canvas.
   - Fix: changed the compact layout to a two-line technical caption while preserving the full system, architecture, and package-size strings.
3. [P2] A translucent scrolled Header would have darkened over the new black stage.
   - Fix: raised the existing white Header surface to 97% opacity without changing its structure, logo, navigation, active pill, or language control.
4. [P3] The approved concept uses denser bespoke segmented metal around each download bay.
   - Accepted: the production bays keep the same hierarchy, two-realm color coding, platform scale, and energetic placement while using responsive, keyboard-focusable HTML controls over the generated mechanical environment.

### Launch-gate behavior and engineering acceptance

- The background plate, two counter-rotating orbit layers, vertical energy axis, scan lines, floating/breathing core, two measured animated beams, platform rings, pointer parallax, and hover/focus portal states are separate runtime layers.
- Offscreen/page-hidden animation pausing and `prefers-reduced-motion` fallbacks are present; the production browser reported all five primary animation groups running in view and exactly two live energy beams.
- macOS and Windows controls, system requirements, package verification, checksum copy status, close controls, Chinese/English copy, and accessible labels were exercised in the in-app browser.
- With no installer binaries or release URLs in the repository, both platform controls show an explicit in-page connection notice instead of navigating to a fake asset or a 404. They automatically become real links when `NEXT_PUBLIC_DJL_MAC_DOWNLOAD_URL` and `NEXT_PUBLIC_DJL_WINDOWS_DOWNLOAD_URL` are configured.
- Production document width equals client width (880 px) with no horizontal overflow; browser console logs are empty.
- `npx tsc --noEmit`: passed.
- `npx eslint app/DesktopLaunchGate.tsx app/Site.tsx`: passed.
- `npm run build`: passed with Next.js 16.2.9.
- No actionable P0, P1, or P2 issue remains in the selected browser state.

## Launch-gate scroll choreography (2026-07-22)

- Desktop production QA: 1280 x 720 CSS px, white 64 px Header, 656 px sticky stage, 1320 px native-scroll runway.
- Verified progress states in the in-app browser: entry `0.0966`, sync `0.5785`, download `1.0000`; the stage stayed pinned at 64 px while the document continued to scroll normally.
- Scroll progress drives the environment depth, headline settle, orbit/core acceleration, platform-bay reveal, beam intensity, utility controls, and the right-side 01/02/03 telemetry rail.
- No wheel interception, scroll snapping, or synthetic scroll-jacking is used. Mobile uses a natural 980 px section with a continuous bottom progress line; `prefers-reduced-motion` resolves to the complete static state and removes the telemetry prompt.
- The `#start` deep link now restores the download stage independently of the hero intro signal, so the production preview opens at the correct scene.
- macOS and Windows buttons remained visible, enabled, and keyboard-addressable through the pinned sequence; the unresolved package URL notice was exercised after the final production build.
- `npx tsc --noEmit`: passed.
- `npx eslint app/DesktopLaunchGate.tsx app/ContextRailStory.tsx`: passed.
- `git diff --check`: passed.
- `npm run build`: passed with Next.js 16.2.9.

final result: passed
