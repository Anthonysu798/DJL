# DJL Landing Page Redesign — Design Specification

**Date:** 2026-07-19  
**Status:** Approved through explicit autonomous design delegation  
**Scope:** Landing-page UI and motion only; no installer, authentication, connector backend, telemetry, or download delivery implementation

### Existing behavior to preserve

- Chinese remains the default page language.
- `?lang=en` switches the full experience to English; `?lang=zh` returns to Chinese.
- Both locales receive equivalent product messaging, navigation, interactions, and accessibility—not a partially translated shell.
- Active-section navigation, reduced-motion support, responsive behavior, and strict GSAP cleanup remain first-class requirements.
- The redesign removes the active page's dependency on the remote Spline hero and CDN icon cloud in favor of local generated artwork and code-native diagrams.

## 1. Product Positioning

DJL Agent is presented as an open connective layer for AI work:

> **One agent. Every model. Any API.**

The page must immediately communicate that DJL can connect to cloud APIs, developer tools, protocols, and local models without locking the user into one provider or runtime. The experience should feel enterprise-ready but not corporate-generic: precise typography and strong information hierarchy are paired with playful motion, tactile controls, and custom 3D objects.

The landing page must avoid common AI-template patterns such as a generic chat window in the hero, a wall of interchangeable feature cards, glowing purple blobs, fake dashboards, floating glass panels, or unsupported performance claims.

## 2. Source Design System

The visual foundation adapts the MiniMax `DESIGN.md` supplied by the user.

### Core tokens

| Role         | Value     | Usage                                         |
| ------------ | --------- | --------------------------------------------- |
| Ink          | `#0a0a0a` | Primary type, black chapters, primary actions |
| Canvas       | `#ffffff` | Main page canvas                              |
| Surface      | `#f7f8fa` | Secondary sections and quiet controls         |
| Hairline     | `#e5e7eb` | Borders, dividers, route grid                 |
| Body         | `#222222` | Long-form copy                                |
| Muted        | `#5f5f5f` | Supporting copy and metadata                  |
| API coral    | `#ff5530` | APIs and connector identity                   |
| Tool magenta | `#ea5ec1` | Tools, media, and workflow identity           |
| Cloud blue   | `#1456f0` | Hosted/cloud model identity                   |
| Local purple | `#a855f7` | Local model and on-device identity            |

Black remains the dominant action color. Accent colors are semantic identities, not generic decoration. White cards use borders rather than heavy shadows. Gradients are reserved for generated 3D artwork, route energy, and large product stages—not ordinary buttons.

### Typography

Use **DM Sans** through `next/font` with the existing system sans stack as fallback.

- Hero display: fluid `clamp(3.6rem, 8vw, 7.5rem)`, weight 600, line-height `0.92`, tight tracking
- Section display: fluid `clamp(2.6rem, 5.2vw, 5.25rem)`, weight 600, line-height `0.98`
- Card title: `clamp(1.5rem, 2.2vw, 2.5rem)`, weight 600
- Body: `1rem–1.125rem`, line-height `1.5–1.65`
- Eyebrow and metadata: `0.75rem–0.875rem`, weight 600, uppercase only for short labels

Display copy uses sentence case. No second display font is introduced.

### Shape and spacing

- Base spacing rhythm: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96px`
- Compact controls: `8px` radius
- Standard panels: `16px` radius
- Large narrative stages: `24–32px` radius
- Buttons, badges, and tabs: full pill radius
- Marketing container: `min(1280px, calc(100vw - 64px))`
- Mobile gutters: `20px`

## 3. Selected Creative Direction

### Direction: “The Open Agent Constellation”

The page begins as a highly legible white editorial product story, progressively becomes more spatial and kinetic, enters one near-black cinematic capability chapter, then returns to an emphatic white download finale and black footer.

This hybrid direction was selected over:

1. **Pure editorial light:** strongest reference fidelity and enterprise clarity, but insufficiently immersive for the requested scroll experience.
2. **Full dark neon lab:** visually dramatic, but too close to generic AI branding and inconsistent with the supplied MiniMax foundation.
3. **Hybrid editorial/cinematic:** preserves trust and readability while creating memorable moments through controlled contrast, motion, and custom artwork.

## 4. Page Architecture and Story

### 4.1 Utility layer

Persistent experience primitives:

- A custom pointer for fine-pointer devices only
- A thin scroll-progress rail integrated into the left or top edge
- Shared magnetic-button behavior for primary calls to action
- Reduced-motion and coarse-pointer fallbacks
- A global grain/noise treatment at very low opacity to prevent sterile flatness

### 4.2 Navigation

A compact floating command bar appears after the opening hero beat.

Content:

- DJL wordmark and animated status glyph
- Product, Connect, Local, and Docs anchors
- Small “Open runtime” status pill
- Primary “Download” action

Behavior:

- Initially integrated into the hero composition
- Becomes a bordered white floating pill after the user starts scrolling
- Hides subtly during fast downward scroll and returns on upward scroll
- Collapses to a logo, current-section label, and menu control below `1024px`
- Retains visible keyboard focus and never relies on cursor-only feedback

### 4.3 Hero — one agent, every runtime

The hero occupies roughly one viewport and avoids a conventional centered SaaS layout.

Left/top narrative:

- Eyebrow: `DJL AGENT / OPEN EXECUTION LAYER`
- Headline: `One agent. Every model. Any API.`
- Supporting copy: `Connect cloud APIs, local models, and the tools you already use—then run the same agent wherever your work lives.`
- Primary CTA: `Download for Mac`
- Secondary CTA: `Download for Windows`
- Quiet helper: `UI preview • installers coming next`

Right/bottom visual:

- A custom transparent 3D **Agent Core** object sits off-axis, not inside a card
- Thin routed lines connect the core to protocol chips labeled `REST`, `MCP`, `LOCAL`, `TOOLS`, and `FILES`
- Chips drift on independent low-amplitude paths
- The object rotates slightly with pointer position and separates into layers during the first scroll beat

Motion:

- Headline reveals by clipped lines, not per-letter gimmicks
- CTA group rises after the first headline line resolves
- Route lines draw outward from the Agent Core
- Scroll moves the core diagonally into the next section, making the page feel continuous

### 4.4 Compatibility ribbon

A full-width kinetic ribbon establishes breadth without becoming a logo wall.

- Alternating labels: `ANY REST API`, `MCP SERVERS`, `LOCAL WEIGHTS`, `CLOUD MODELS`, `FILES`, `TOOLS`, `YOUR STACK`
- Labels are separated by animated connector glyphs
- Motion reverses gently based on scroll direction
- On reduced motion, it becomes a wrapped static list

### 4.5 Connection constellation

A large white stage explains DJL’s role as the middle layer.

- Intro copy sits on a narrow editorial column
- The **Connector Stack** 3D object overlaps the stage edge
- A radial DOM-based constellation connects semantic nodes; no canvas or WebGL is required
- Hovering or focusing a node highlights the path from source → DJL Agent → destination
- Example routes are descriptive rather than provider-dependent:
  - `Webhook → DJL → Local model`
  - `MCP tool → DJL → Cloud model`
  - `Files → DJL → Private runtime`

The interaction must remain understandable without hover. All nodes and routes appear in source order for assistive technology.

### 4.6 Pinned horizontal story — “One agent, every runtime”

Desktop uses a GSAP ScrollTrigger-pinned horizontal sequence. Mobile and reduced-motion modes use a native vertical or horizontal snap list with no pinning.

Four chapters:

1. **Connect anything**  
   `Bring an endpoint, a tool, or a protocol. DJL turns the connection into something your agent can use.`
2. **Choose any brain**  
   `Route work to a hosted model, a specialist API, or the model already running on your machine.`
3. **Keep it local**  
   `Move sensitive workflows toward your own hardware without redesigning the entire agent.`
4. **Ship the same flow**  
   `Prototype on a laptop, then move the workflow to the runtime that fits.`

Each chapter is a large editorial panel, not a repeated feature card. Panels use one assigned accent color, oversized numerals, a short proof line, and diagrammatic motion. The **Local Model Prism** artwork anchors chapter three.

### 4.7 Dark capability tunnel

The page transitions into near-black with the line:

> **Your agent should not care where intelligence lives.**

A routed execution path moves through an abstract grid:

`INPUT → CONTEXT → ROUTE → MODEL → TOOL → RESULT`

The path is animated as the user scrolls. Supporting statements enter one at a time:

- `Swap providers without rebuilding the experience.`
- `Move a workflow closer to your data.`
- `Mix APIs, tools, and local inference in one route.`

This section avoids fake terminal output. It uses typographic system labels, route geometry, and meaningful state transitions.

### 4.8 Workflow playground

A playful editorial workspace shows three example recipes as overlapping “route tickets,” not a standard bento grid.

Recipes:

- **Research relay** — `Web source → Agent → Local summarizer → Notes`
- **Private file analyst** — `Folder → Agent → Local model → Structured result`
- **Production operator** — `Alert API → Agent → Tool call → Human handoff`

Interaction:

- Selecting a recipe rearranges the route tickets through Motion layout animation
- The active route draws between the selected steps
- Small success badges and microcopy make the stage feel tactile
- Keyboard users can select recipes through a segmented tablist

### 4.9 Enterprise confidence strip

No fabricated statistics or customer logos are used. Confidence is communicated through concise operating principles:

- `Provider-flexible`
- `Local-capable`
- `Tool-native`
- `Runtime-portable`

Each principle expands into one sentence on hover/focus and remains visible in a stacked mobile layout.

### 4.10 Download finale

The page returns to white with a large typographic close:

> **Bring the agent. Choose the intelligence.**

Two oversized platform actions sit on one continuous stage:

- `Download for Mac` with Apple platform glyph and honest `macOS UI preview` metadata
- `Download for Windows` with Windows platform glyph and honest `Windows UI preview` metadata

Because implementation is UI-only, buttons use safe placeholder behavior and accessible labels rather than fake downloads. A small note makes the state explicit: `Interface preview—distribution links will be connected next.`

The Agent Core, Connector Stack, and Local Model Prism align into a final three-object composition before the black footer.

### 4.11 Footer

Black background, restrained multi-column structure:

- Product: Agent, Connectors, Local models, Downloads
- Resources: Docs, Examples, Changelog, GitHub
- Company/brand: About DJL, Contact
- Closing line: `Open by design. Ready for your stack.`

Unavailable destinations remain non-destructive placeholder links in this UI phase.

## 5. Generated 3D Asset Direction

Three transparent-background assets are required. They should share one material language: polished black ceramic, soft chrome, clear resin, and small coral/blue/magenta/purple internal accents. Lighting is studio-soft with a subtle contact-like underside glow contained inside the object; no environment, floor, text, logo, or baked background.

### Asset A — Agent Core

An asymmetric modular orb made from interlocking rounded black ceramic and clear resin shells, with a luminous blue-to-purple inner core and two coral connector details. Premium industrial design, playful proportions, three-quarter view, transparent background.

### Asset B — Connector Stack

A sculptural cluster of modular plugs and bridge pieces orbiting a soft chrome hub. Coral, magenta, blue, and purple pieces remain distinct but use the same rounded geometry. Dynamic diagonal composition, transparent background.

### Asset C — Local Model Prism

A compact translucent purple compute prism with layered internal wafers, black ceramic rails, one blue status light, and a removable coral module. Friendly rather than server-rack literal, transparent background.

Preferred output is high-resolution PNG or WebP with alpha. Assets are displayed through `next/image`, include meaningful alt text when informative, and use empty alt text where purely decorative.

## 6. Motion and Interaction System

### Ownership

- **GSAP + ScrollTrigger:** scroll-linked transforms, pinning, horizontal storytelling, route-line progress, hero-to-section continuity, direction-aware ribbon
- **Motion for React / Framer Motion:** component entrances, hover/tap feedback, recipe selection, layout transitions, presence, cursor spring
- **CSS:** color, border, underline, focus, and small opacity transitions

No element may have the same transform property animated by both GSAP and Motion. Wrappers are introduced when both systems are needed: GSAP owns the outer scroll wrapper and Motion owns the inner interactive element.

### Timing language

- Micro feedback: `150–220ms`
- Component transitions: `350–550ms`
- Hero sequence: `800–1200ms` per grouped beat
- Scroll-linked motion uses scrubbed progress rather than long autonomous loops
- Easing favors `power3.out`, `expo.out`, or spring values with limited overshoot

### Custom cursor

Enabled only when `(pointer: fine)` and reduced motion is not requested.

States:

- Default: 12px dark dot with subtle trailing ring
- Link/button: 44px outlined ring with short action label such as `OPEN`
- Horizontal story: 56px ring labeled `SCROLL`
- Draggable/snap areas: ring labeled `DRAG`

The native cursor remains for text fields, selectable copy, coarse pointers, reduced-motion mode, and any state where the custom cursor fails to initialize.

### Magnetic controls

Primary CTAs translate no more than 6px toward the pointer and snap back with a soft spring. Text and icon move together. Keyboard focus never triggers spatial movement.

## 7. Responsive Behavior

### Desktop (`≥1024px`)

- Full navigation
- Pinned horizontal story
- Layered 3D composition
- Custom cursor and pointer parallax
- Constellation node interactions

### Tablet (`768–1023px`)

- Condensed navigation
- Horizontal story becomes native snap without long pinning
- Reduced parallax distance
- Route diagrams simplify to fewer visible lines
- Product artwork remains offset but cannot overlap body copy

### Mobile (`<768px`)

- One-column editorial flow
- Hero display scales to `clamp(3rem, 14vw, 4.5rem)`
- Download actions stack and meet a 44px minimum touch target
- No custom cursor
- No pointer tilt
- Horizontal content uses native swipe/snap only where it improves comprehension
- 3D assets are cropped intentionally and never cause horizontal overflow
- Footer uses an accessible accordion or stacked groups

## 8. Accessibility

- Respect `prefers-reduced-motion`; remove scrubbed parallax, pinning, cursor replacement, and continuous ribbons
- Keep all content and section relationships valid without JavaScript
- Provide a skip link and semantic landmarks
- Maintain visible focus rings with at least 3:1 contrast against adjacent colors
- Use semantic buttons for interactions and anchors for real navigation
- Use `aria-current` for the active navigation section
- Use a real tablist pattern for workflow recipes
- Never encode meaning by color alone; route labels and glyph shapes remain present
- Decorative generated artwork uses empty alt text; product-explanatory artwork receives concise descriptive alt text
- Ensure text contrast meets WCAG AA

## 9. Performance and Technical Boundaries

- Preserve the Next.js route as a server-rendered shell where practical
- Isolate browser-only animation code in focused client components
- Use `next/font` for DM Sans and `next/image` for generated assets
- Dynamically load only the heaviest below-the-fold motion section if bundle analysis justifies it
- Register GSAP plugins inside the client boundary and use `@gsap/react` `useGSAP` scoping or `gsap.context()` cleanup
- Call `ScrollTrigger.refresh()` only after image/font layout stabilizes where necessary
- Use `gsap.matchMedia()` or equivalent media-query branching for desktop, mobile, and reduced motion
- Avoid WebGL, video backgrounds, and large canvas effects; the visual system is achievable with optimized images, SVG route lines, and DOM transforms
- Do not add a smooth-scroll interception library; retain native scrolling and layer GSAP ScrollTrigger on top
- Avoid hydration-dependent viewport markup. Browser-only states initialize after mount without changing essential content order

## 10. Component Boundaries

Exact paths should follow the repository’s existing conventions, but the implementation must preserve these conceptual boundaries:

- `LandingPageShell` — ordered server-friendly page composition
- `LandingHeader` — navigation and active-section state
- `HeroStage` — headline, platform CTAs, Agent Core, and first scroll transition
- `CompatibilityRibbon` — direction-aware capability labels
- `ConnectionConstellation` — accessible routes and Connector Stack
- `RuntimeStory` — desktop pinned narrative plus mobile snap fallback
- `CapabilityTunnel` — dark route visualization
- `WorkflowPlayground` — selectable recipes and layout animation
- `ConfidenceStrip` — operating principles
- `DownloadStage` — platform actions and final object composition
- `CustomCursor` — fine-pointer-only cursor layer
- Shared `MagneticButton`, `SectionLabel`, `RouteLine`, and `PlatformIcon` primitives
- Static content arrays separated from motion implementation

Large sections should remain independently understandable and testable. Animation setup belongs beside the section it controls rather than in one global timeline file.

## 11. Error and Degradation Behavior

- If GSAP or Motion fails to initialize, all content remains visible in normal document flow
- If generated artwork fails to load, layout retains its proportions and text never becomes obscured
- Placeholder download actions do not navigate to missing files
- Anchor navigation works without the custom cursor or animation runtime
- Resize/orientation changes recalculate desktop ScrollTriggers without duplicating instances
- Development strict-mode remounts do not leave duplicate triggers because all timelines and triggers are scoped and reverted

## 12. Validation Strategy

### Automated

- Existing lint command passes
- Existing type-check command passes, or `next build` completes type checking
- Production build succeeds
- No new console errors or hydration warnings

### Visual and interaction

Verify at representative widths:

- `1440×900`
- `1024×768`
- `768×1024`
- `390×844`

Check:

- No unintended horizontal overflow
- Pinned story releases at the correct point
- Sticky navigation does not obscure anchors
- 3D assets remain crisp and compositionally balanced
- Buttons, tabs, and route nodes have hover, focus, active, and disabled/placeholder-safe states
- Reduced-motion mode presents the complete story without blank pinned space
- Keyboard traversal follows the visual order
- Custom cursor never traps or hides the native pointer in unsupported contexts

## 13. Completion Criteria

The UI redesign is complete when:

1. The full landing page uses the new MiniMax-derived visual system.
2. The hero clearly communicates DJL Agent’s any-API/any-model/local-model positioning.
3. Mac and Windows download actions are visually prominent and honestly marked as UI placeholders.
4. Three custom transparent-background 3D assets appear as integrated storytelling elements.
5. GSAP powers the intentional scroll narrative, including one desktop horizontal chapter and parallax transitions.
6. Motion powers local micro-interactions without fighting GSAP.
7. A custom cursor works on eligible desktop pointers and degrades safely.
8. Mobile, keyboard, and reduced-motion experiences remain complete and usable.
9. The production build and repository validation commands pass.
10. The result feels custom, playful, and enterprise-grade rather than like a generic AI landing-page template.
