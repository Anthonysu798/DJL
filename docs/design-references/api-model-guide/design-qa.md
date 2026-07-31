# API model guide design QA

Status: **Passed**

The selected black-and-white reference was compared beside the running Electron implementation at a normalized 1300 × 768 viewport. See `comparison-reference-vs-implementation.png` in this directory.

## Review findings

- P0: none.
- P1: none remaining. The initial guide attached to the wrong side of the composer when vertical space was tight; it now remains centered on the visible model selector and constrains its height instead of flipping sideways.
- P2: none remaining. The “Good to know” content was restored to the reference’s vertical list, spacing was tightened for English, and the popup now stays usable in the new-chat first-run state.

## States reviewed

- First install: the model guide appears as step 5 of 5 after the existing desktop tour.
- Existing/replay flow: the third sidebar tutorial item opens the guide directly.
- Light, dark, English, and Simplified Chinese rendering.
- Connected-provider CTA opens the composer model picker.
- “How API setup works” switches to a focused three-step setup path without growing beyond the viewport.
- The top-right close button dismisses the guide, persists the seen version, and remains replayable from the sidebar.
- Continue locally persists across an Electron reload.
- Missing-anchor fallback and narrow stacked layout are covered by browser component tests.

The reference uses an active thread with a bottom composer, while a true first install opens on the empty new-chat state with a centered composer. The guide follows the live composer selector in both cases; this state difference is intentional and not a visual defect.
