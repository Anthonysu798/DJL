# Capabilities Section Design QA

## Comparison Target

- Source visual truth: `/Users/toni798/.codex/generated_images/019fbe8c-85dc-7dd2-bb0f-6923c9cf2ca6/exec-d241bfc7-eed3-41a1-8144-1380f7193490.png`
- Browser-rendered implementation: `/Users/toni798/.codex/visualizations/2026/08/01/019fbe8c-85dc-7dd2-bb0f-6923c9cf2ca6/capabilities-implementation-desktop.png`
- Side-by-side comparison: `/Users/toni798/.codex/visualizations/2026/08/01/019fbe8c-85dc-7dd2-bb0f-6923c9cf2ca6/capabilities-design-comparison.png`
- Route: `http://localhost:3000/#capabilities`
- State: desktop, Chinese locale, pinned scroll sequence at the fully revealed hold state.

## Normalization

- Source pixels: 1541 × 1020. The generated concept is a section-only landscape render rather than a browser viewport.
- Implementation pixels: 958 × 1036 from a 958 × 1035 CSS viewport. The browser reported device pixel ratio 1.8, while its screenshot API returned CSS-normalized pixels.
- Comparison normalization: source resized proportionally to 958 px wide and placed on a 958 × 1036 white canvas; implementation retained at 958 px wide. The comparison preserves both compositions without stretching.
- The implementation includes the real floating navigation; the source visual intentionally omits site chrome.

## Full-view Comparison Evidence

The implementation preserves the selected concept's defining hierarchy: a wide editorial heading, a dark 6-column local-model anchor spanning two rows, four light 3-column support cards filling the remaining 12-column grid, and a restrained tool ribbon. Typography, hairlines, radii, monochrome surfaces, icon weight, terminal structure, and content order align with the source. The implementation is taller at the annotated 958 px viewport to preserve readable Chinese copy; this is an intentional responsive constraint rather than an empty grid or proportion error.

## Focused-region Evidence

No separate crop was required because the original-resolution side-by-side comparison keeps the terminal, card icons, titles, copy, border radii, and ribbon labels readable. The terminal was specifically checked for traffic lights, command emphasis, output rows, and the closing `djl >` prompt. The four supporting icons use the existing Lucide family at a consistent 1.6 stroke weight.

## Required Fidelity Surfaces

- Fonts and typography: passed. The implementation uses the landing system's SF Pro Rounded/system display stack and native body/mono stacks. Heading width, weight, line height, body sizing, and Chinese wrapping preserve the source hierarchy.
- Spacing and layout rhythm: passed. The desktop bento is mathematically dense (`6+3+3=12` on both rows), with 12 px gaps, 12 px radii, and no empty grid cells. The larger vertical card height is required by the narrower real viewport.
- Colors and visual tokens: passed. Paper white, near-black, neutral grays, hairlines, and one inverted black focal card all map to existing landing tokens. No gradients or shadows were added.
- Image quality and asset fidelity: passed. The concept contains no raster imagery. All icons are real Lucide components; no handcrafted SVG, CSS illustration, emoji, or placeholder asset is used.
- Copy and content: passed. All five existing Chinese capability titles and bodies are retained, with one concise introductory sentence and a bilingual tool ribbon.

## Interaction and Responsive Checks

- Navigation anchor: tested; the existing “能力” link reaches the redesigned section.
- Desktop motion: tested at 958 × 1035 CSS px; the scene pins at 96 px, the anchor card remains legible at entry, supporting cards scrub to full contrast, and the final state holds before unpinning.
- Mobile layout: tested with the in-app browser viewport override (390 × 844 request; browser-reported CSS viewport 433 × 938). The page had no document-level horizontal overflow, the featured card stacked full-width, and all supporting cards remained visible in one column.
- Reduced motion: tested through browser media emulation. All five cards reported `opacity: 1`, `transform: none`, and `visibility: visible`; the redesigned section created no pin spacer.
- Browser console: checked after the final production build; no warnings or errors.

## Comparison History

1. First pass found a P2 entry-state issue: every card began nearly transparent, leaving too much blank space when the navigation anchor landed. Fix: keep the featured card fully visible and reveal only the supporting cards from low contrast.
2. First pass also found P2 terminal fidelity drift. Fix: replace the prompt glyph with icon-library traffic lights and restore the closing `djl >` row.
3. Second pass found a P2 exit-state issue: the title could move under the floating navigation at the exact moment the final card reached full opacity. Fix: add a scrubbed hold after the reveal so the fully composed grid remains pinned at 96 px before exit.
4. Final evidence confirms all five cards are visible at full opacity, the scene top is 96.2 px, and the console is clean.

## Findings

No actionable P0, P1, or P2 differences remain.

## Follow-up Polish

- P3: the continuously moving ribbon can show a partially clipped label at either viewport edge. This is expected marquee behavior and does not obscure the repeated information.

## Implementation Checklist

- [x] Source and implementation opened together at original comparison resolution.
- [x] Dense desktop grid and responsive fallbacks verified.
- [x] Scroll, mobile, and reduced-motion states tested.
- [x] Static checks and production build passed.
- [x] Browser console checked.

final result: passed
