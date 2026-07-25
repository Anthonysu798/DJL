# DJL Execution Atlas Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current generated 3D hero with a bespoke, code-built Execution Atlas and integrate the navigation into a professional editorial/technical first viewport.

**Architecture:** Localized copy remains in `app/content.ts`; `HeroSection` owns only narrative composition and calls a new focused `ExecutionAtlas` component for the interactive SVG/HTML artwork. Existing navigation behavior remains intact while `landing.css` replaces the floating-pill and generic grid styling with a warm, structured visual system. No new dependency or generated media asset is required.

**Tech Stack:** Next.js 16, React 19, TypeScript, Motion 12, inline SVG, CSS, existing GSAP navigation scrolling.

## Global Constraints

- Do not render a generated hero image, 3D model, video, WebGL scene, stock illustration, glow cloud, mesh gradient, or glass-card dashboard in the hero.
- Preserve the core English promise: `One agent. Every model. Any API.`
- Preserve English and Chinese localization and give each locale deliberate responsive wrapping.
- Preserve nav links, locale switching, active-section tracking, smooth scrolling, keyboard focus, and `#download` behavior.
- Motion must be restrained, deterministic, explanatory, and disabled by `prefers-reduced-motion`.
- Keep DM Sans and use a system monospace stack for runtime metadata.
- Do not add dependencies.
- Do not delete generated assets because other landing-page sections still use them.
- Do not overwrite unrelated uncommitted work.
- Do not commit unless the user explicitly requests it.

## File Structure

- Create `app/landing/ExecutionAtlas.tsx`: self-contained semantic/SVG runtime map, pointer depth, deterministic route trace, and reduced-motion behavior.
- Modify `app/landing/HeroSection.tsx`: localized hero narrative, stable three-line heading, CTAs, proof strip, and `ExecutionAtlas` composition.
- Modify `app/content.ts`: three-line localized headline plus proof and atlas labels/transcript.
- Modify `app/landing/landing.css`: integrated nav treatment, warm cartographic background, hero layout, atlas visuals, route animation, responsive layouts, and reduced-motion overrides.
- Preserve `app/SiteNav.tsx`: current DOM and behavior are sufficient; style its existing classes instead of changing logic.
- Preserve `app/landing/assets.ts`: the hero stops importing it, while other sections continue using it.

---

### Task 1: Add localized Execution Atlas content

**Files:**

- Modify: `app/content.ts:24-43`
- Modify: `app/content.ts:127-135`
- Modify: `app/content.ts:343-351`

**Interfaces:**

- Produces: `LandingContent["hero"]` with `title`, `proof`, `routeLabels`, and `atlas` fields consumed by `HeroSection` and `ExecutionAtlas`.
- Produces exact atlas shape:

```ts
atlas: {
  ariaLabel: string;
  kicker: string;
  core: string;
  ready: string;
  route: string;
  transcript: readonly[(string, string, string)];
}
```

- [ ] **Step 1: Change the hero content type to an intentional three-line title and add proof/atlas copy**

Replace the current hero type with:

```ts
hero: {
  eyebrow: string;
  title: readonly[(string, string, string)];
  body: string;
  mac: string;
  windows: string;
  proof: readonly[(string, string, string)];
  routeLabels: readonly[(string, string, string, string, string)];
  atlas: {
    ariaLabel: string;
    kicker: string;
    core: string;
    ready: string;
    route: string;
    transcript: readonly[(string, string, string)];
  }
}
```

- [ ] **Step 2: Add the English content**

Use:

```ts
hero: {
  eyebrow: "DJL AGENT / OPEN EXECUTION LAYER",
  title: ["One agent.", "Every model.", "Any API."],
  body:
    "Connect APIs, local models, and everyday tools. Run the same agent wherever work happens.",
  mac: "Download for Mac",
  windows: "Download for Windows",
  proof: ["LOCAL-FIRST", "MCP + REST", "MACOS + WINDOWS"],
  routeLabels: ["REST API", "MCP", "LOCAL MODEL", "TOOLS", "FILES"],
  atlas: {
    ariaLabel:
      "DJL execution map routing one agent between a REST API, MCP, a local model, tools, and files.",
    kicker: "LIVE ROUTE / 04",
    core: "DJL / OPEN EXECUTION",
    ready: "READY",
    route: "LOCAL MODEL → TOOL",
    transcript: [
      "context.scope  /workspace",
      "model.route    local",
      "tool.result    complete · 184ms",
    ],
  },
},
```

- [ ] **Step 3: Add equivalent Chinese content without transliterating protocol names**

Use:

```ts
hero: {
  eyebrow: "DJL 智能体 / 开放执行层",
  title: ["一个智能体", "任意模型", "连接所有 API"],
  body:
    "连接 API、本地模型和日常工具，让同一个智能体运行在工作真正发生的地方。",
  mac: "下载 Mac 版",
  windows: "下载 Windows 版",
  proof: ["本地优先", "MCP + REST", "MACOS + WINDOWS"],
  routeLabels: ["REST API", "MCP", "本地模型", "工具", "文件"],
  atlas: {
    ariaLabel: "DJL 执行路径图：在 REST API、MCP、本地模型、工具和文件之间路由同一个智能体。",
    kicker: "实时路径 / 04",
    core: "DJL / 开放执行",
    ready: "就绪",
    route: "本地模型 → 工具",
    transcript: [
      "context.scope  /workspace",
      "model.route    local",
      "tool.result    完成 · 184ms",
    ],
  },
},
```

- [ ] **Step 4: Run TypeScript compilation through the production build**

Run: `npm run build`

Expected: PASS. The existing title mapper accepts the three-line tuple; the temporary visual accent remains on the second line until Task 3 updates the composition.

---

### Task 2: Build the semantic Execution Atlas component

**Files:**

- Create: `app/landing/ExecutionAtlas.tsx`

**Interfaces:**

- Consumes:

```ts
copy: LandingContent["hero"]["atlas"];
routeLabels: LandingContent["hero"]["routeLabels"];
cursorLabel: string;
```

- Produces: `ExecutionAtlas` React component with no external state and no image dependencies.

- [ ] **Step 1: Create deterministic endpoint metadata and the public component signature**

Start the file with:

```tsx
"use client";

import type { PointerEvent } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import type { LandingContent } from "../content";

type ExecutionAtlasProps = {
  copy: LandingContent["hero"]["atlas"];
  routeLabels: LandingContent["hero"]["routeLabels"];
  cursorLabel: string;
};

const endpointPositions = [
  { className: "atlas-endpoint-rest", index: "01" },
  { className: "atlas-endpoint-mcp", index: "02" },
  { className: "atlas-endpoint-local", index: "03" },
  { className: "atlas-endpoint-tools", index: "04" },
  { className: "atlas-endpoint-files", index: "05" },
] as const;
```

- [ ] **Step 2: Add reduced-motion-aware pointer depth owned by the atlas**

Inside the component, use deterministic motion values:

```tsx
const reduce = useReducedMotion();
const pointerX = useMotionValue(0);
const pointerY = useMotionValue(0);
const springX = useSpring(pointerX, { stiffness: 95, damping: 22, mass: 0.55 });
const springY = useSpring(pointerY, { stiffness: 95, damping: 22, mass: 0.55 });
const planeX = useTransform(springX, [-0.5, 0.5], [-10, 10]);
const planeY = useTransform(springY, [-0.5, 0.5], [-8, 8]);

const move = (event: PointerEvent<HTMLElement>) => {
  if (reduce || event.pointerType === "touch") return;
  const rect = event.currentTarget.getBoundingClientRect();
  pointerX.set((event.clientX - rect.left) / rect.width - 0.5);
  pointerY.set((event.clientY - rect.top) / rect.height - 0.5);
};

const reset = () => {
  pointerX.set(0);
  pointerY.set(0);
};
```

- [ ] **Step 3: Render the atlas frame, routing SVG, core rail, endpoints, and transcript**

The returned structure must use these stable class names so CSS and later verification agree:

```tsx
return (
  <motion.figure
    className="execution-atlas"
    initial={reduce ? false : { opacity: 0, y: 32, scale: 0.97 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ duration: 1, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
    onPointerMove={move}
    onPointerLeave={reset}
    data-cursor="route"
    data-cursor-label={cursorLabel}
    role="img"
    aria-label={copy.ariaLabel}
  >
    <motion.div
      className="execution-atlas-plane"
      style={reduce ? undefined : { x: planeX, y: planeY }}
    >
      <div className="atlas-registration atlas-registration-nw" aria-hidden="true" />
      <div className="atlas-registration atlas-registration-se" aria-hidden="true" />
      <div className="atlas-dot-field" aria-hidden="true" />

      <svg
        className="atlas-routes"
        viewBox="0 0 760 620"
        fill="none"
        aria-hidden="true"
        preserveAspectRatio="xMidYMid meet"
      >
        <path className="atlas-route atlas-route-muted" d="M98 98C214 98 228 218 364 218" />
        <path className="atlas-route atlas-route-muted" d="M650 120C548 120 538 218 394 218" />
        <path className="atlas-route atlas-route-primary" d="M152 496C248 496 264 358 368 358" />
        <path className="atlas-route atlas-route-primary" d="M604 464C524 464 500 358 392 358" />
        <path className="atlas-route atlas-route-muted" d="M660 302C562 302 530 290 426 290" />
        <path className="atlas-route atlas-route-spine" d="M380 102V514" />
        <circle className="atlas-pulse atlas-pulse-a" cx="380" cy="358" r="5" />
        <circle className="atlas-pulse atlas-pulse-b" cx="380" cy="358" r="5" />
      </svg>

      <div className="atlas-meta">
        <span>{copy.kicker}</span>
        <span>38°53′ / 77°02′</span>
      </div>

      <div className="atlas-core">
        <span className="atlas-core-index">DJL</span>
        <strong>{copy.core}</strong>
        <span className="atlas-core-ready">
          <i aria-hidden="true" />
          {copy.ready}
        </span>
      </div>

      <div className="atlas-route-readout">
        <span>ACTIVE ROUTE</span>
        <strong>{copy.route}</strong>
      </div>

      {endpointPositions.map((endpoint, index) => (
        <div className={`atlas-endpoint ${endpoint.className}`} key={endpoint.className}>
          <span>{endpoint.index}</span>
          <strong>{routeLabels[index]}</strong>
        </div>
      ))}

      <div className="atlas-transcript">
        {copy.transcript.map((line, index) => (
          <div key={line}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <code>{line}</code>
          </div>
        ))}
      </div>
    </motion.div>
  </motion.figure>
);
```

- [ ] **Step 4: Run lint to catch component and accessibility mistakes**

Run: `npm run lint`

Expected: PASS, or only consumer/type errors that disappear in Task 3; no unused imports, unstable keys, or JSX accessibility errors in `ExecutionAtlas.tsx`.

---

### Task 3: Recompose the hero around the atlas

**Files:**

- Modify: `app/landing/HeroSection.tsx:1-166`

**Interfaces:**

- Consumes: `ExecutionAtlas({ copy, routeLabels, cursorLabel })` from Task 2.
- Consumes: the expanded `LandingContent["hero"]` contract from Task 1.
- Produces: the same exported `HeroSection({ copy, cursorLabel })` API used by `Site.tsx`.

- [ ] **Step 1: Remove generated-image and hero-level pointer dependencies**

Delete imports for `next/image`, `PointerEvent`, `useMotionValue`, `useSpring`, `useTransform`, and `landingAssets`. Keep `motion` and `useReducedMotion`, then add:

```tsx
import { ExecutionAtlas } from "./ExecutionAtlas";
```

Delete the pointer motion setup, `move`, and `reset` functions. The section opening becomes:

```tsx
<section id="top" className="hero-section">
```

- [ ] **Step 2: Replace decorative orbits, watermark, art image, and route chips with the new background anatomy**

Immediately inside the section render only:

```tsx
<div className="hero-cartography" aria-hidden="true">
  <span className="hero-arc hero-arc-a" />
  <span className="hero-arc hero-arc-b" />
  <span className="hero-axis hero-axis-x" />
  <span className="hero-axis hero-axis-y" />
</div>
```

Remove `.hero-orbit`, `.hero-watermark`, `.hero-art-stage`, `.hero-art-motion`, the `Image`, `.hero-route-map`, route chips, and route lines from the JSX.

- [ ] **Step 3: Keep the reveal sequence and render the three-line title**

Keep the existing `reveal` and `lineReveal` variants. Render each title entry as its own clipped line and apply the accent only to index `2`:

```tsx
<motion.h1 className="hero-heading" variants={reveal}>
  {copy.title.map((line, index) => (
    <span className="hero-heading-line" key={line}>
      <motion.span variants={lineReveal} className={index === 2 ? "hero-heading-accent" : ""}>
        {line}
      </motion.span>
    </span>
  ))}
</motion.h1>
```

- [ ] **Step 4: Add proof metadata below the platform actions**

After `.hero-actions`, add:

```tsx
<motion.ul className="hero-proof" variants={lineReveal} aria-label="DJL compatibility">
  {copy.proof.map((item) => (
    <li key={item}>
      <i aria-hidden="true" />
      {item}
    </li>
  ))}
</motion.ul>
```

- [ ] **Step 5: Mount the atlas as the right-hand visual**

After the copy motion container, add:

```tsx
<ExecutionAtlas copy={copy.atlas} routeLabels={copy.routeLabels} cursorLabel={cursorLabel} />
```

- [ ] **Step 6: Run build and lint**

Run: `npm run lint && npm run build`

Expected: both commands PASS. `HeroSection` no longer imports or requests `djl-agent-core.png` in the hero path.

---

### Task 4: Replace the generic nav and hero visual system

**Files:**

- Modify: `app/landing/landing.css:168-592`
- Modify: `app/landing/landing.css:659-879`

**Interfaces:**

- Styles the unchanged `SiteNav` class contract.
- Styles all class names created by `HeroSection` and `ExecutionAtlas`.

- [ ] **Step 1: Redesign the navigation without changing its behavior**

Replace the rounded floating-pill treatment with an integrated 72px bar:

```css
.command-nav {
  position: fixed;
  inset: 0 0 auto;
  z-index: 80;
  pointer-events: none;
}

.command-nav::after {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1px;
  background: rgba(10, 10, 10, 0.08);
  content: "";
  opacity: 0;
  transition: opacity 220ms ease;
}

.command-nav-inner {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  width: min(var(--max-width), calc(100% - 64px));
  min-height: 78px;
  margin-inline: auto;
  padding: 0;
  pointer-events: auto;
}

.command-nav[data-past-hero="true"] {
  background: rgba(250, 249, 246, 0.92);
  backdrop-filter: blur(16px) saturate(1.15);
  -webkit-backdrop-filter: blur(16px) saturate(1.15);
}

.command-nav[data-past-hero="true"]::after {
  opacity: 1;
}
```

Use compact square-ish controls rather than repeated pills: nav links have no background capsule, the language group uses a 10px radius, and the download action uses a 12px radius.

- [ ] **Step 2: Establish the warm cartographic hero canvas and stable desktop layout**

Use:

```css
.hero-section {
  position: relative;
  display: grid;
  min-height: 100svh;
  align-items: center;
  overflow: hidden;
  padding: 112px 0 56px;
  background: #faf9f6;
  isolation: isolate;
}

.hero-section::before {
  position: absolute;
  inset: 0;
  z-index: 0;
  background:
    linear-gradient(90deg, transparent 49.94%, rgba(10, 10, 10, 0.035) 50%, transparent 50.06%),
    linear-gradient(transparent 49.94%, rgba(10, 10, 10, 0.035) 50%, transparent 50.06%);
  background-size: 100% 100%;
  content: "";
  pointer-events: none;
}

.hero-grid {
  position: relative;
  z-index: 3;
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(520px, 1.08fr);
  align-items: center;
  gap: clamp(36px, 5vw, 88px);
}
```

Create `.hero-cartography`, `.hero-arc`, and `.hero-axis` as sparse cropped circles and rules anchored to the right side. Do not recreate a repeating square grid.

- [ ] **Step 3: Make typography the primary visual asset**

Use a larger but safer three-line heading:

```css
.hero-copy {
  position: relative;
  z-index: 4;
  max-width: 680px;
  padding: 28px 0;
}

.hero-heading {
  margin: 24px 0 0;
  color: var(--ink);
  font-size: clamp(4.1rem, 5.85vw, 6.25rem);
  font-weight: 600;
  letter-spacing: -0.075em;
  line-height: 0.86;
}

.hero-heading-line {
  display: block;
  overflow: hidden;
  padding: 0 0 0.1em;
  white-space: nowrap;
}

.hero-heading-accent {
  color: var(--blue);
}
```

Give Chinese a separate, less compressed scale and line height. Keep body copy at 48–52 characters and do not let it compete with the headline.

- [ ] **Step 4: Restyle actions and proof metadata**

Use 12–14px radii, 54px minimum action height, strong focus contrast, and no glow shadow. Add `.hero-proof` as a compact monospaced metadata row with small status squares.

- [ ] **Step 5: Build the complete Execution Atlas visual system**

Define CSS for:

```text
.execution-atlas
.execution-atlas-plane
.atlas-registration
.atlas-dot-field
.atlas-routes
.atlas-route
.atlas-route-primary
.atlas-route-spine
.atlas-pulse
.atlas-meta
.atlas-core
.atlas-core-index
.atlas-core-ready
.atlas-route-readout
.atlas-endpoint
.atlas-endpoint-rest
.atlas-endpoint-mcp
.atlas-endpoint-local
.atlas-endpoint-tools
.atlas-endpoint-files
.atlas-transcript
```

The atlas must:

- use a 1px ink/cobalt line system on warm white;
- have one solid central core rail, not a floating card stack;
- position five endpoint labels around the core with asymmetric balance;
- animate `.atlas-route-primary` using a slow `stroke-dashoffset` route trace;
- animate `.atlas-pulse-a` and `.atlas-pulse-b` with staggered, subtle opacity/scale;
- use `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` for technical text;
- avoid blur and glow except a maximum 8px soft shadow beneath the atlas frame;
- keep all essential endpoint labels visible without animation.

Use deterministic animation definitions:

```css
@keyframes atlas-route-trace {
  0% {
    stroke-dashoffset: 1;
    opacity: 0.22;
  }
  35%,
  72% {
    opacity: 1;
  }
  100% {
    stroke-dashoffset: -1;
    opacity: 0.22;
  }
}

@keyframes atlas-pulse {
  0%,
  100% {
    opacity: 0;
    transform: scale(0.65);
  }
  40% {
    opacity: 0.9;
  }
  70% {
    opacity: 0;
    transform: scale(1.8);
  }
}
```

- [ ] **Step 6: Replace old tablet/mobile art fading with intentional stacked layouts**

At `max-width: 1050px`, use an approximately `1fr / 0.9fr` grid and scale the atlas down.

At `max-width: 860px`:

- preserve the current collapsed nav behavior;
- make `.hero-grid` a one-column grid;
- render `.execution-atlas` in normal document flow below the copy;
- set a finite aspect ratio and remove any negative z-index/faded artwork behavior;
- simplify the transcript and coordinate labels if required.

At `max-width: 620px`:

- allow title wrapping while keeping each title phrase distinct;
- keep Chinese heading around `clamp(2.3rem, 10vw, 3.4rem)`;
- stack CTAs at full width;
- hide `.atlas-transcript` and the two least important registration details;
- keep the core, active route, and all five endpoint labels readable.

- [ ] **Step 7: Add reduced-motion overrides**

Inside the existing reduced-motion query, ensure:

```css
.execution-atlas-plane {
  transform: none !important;
}
.atlas-route-primary {
  animation: none;
  stroke-dasharray: none;
}
.atlas-pulse {
  animation: none;
  opacity: 0;
}
```

Remove obsolete `.hero-art-motion` reduced-motion rules.

- [ ] **Step 8: Run lint and production build**

Run: `npm run lint && npm run build`

Expected: both PASS with no unused image import, invalid CSS, type mismatch, or hydration warning.

---

### Task 5: Run and visually verify the real application

**Files:**

- Modify only the files above if visual inspection finds a specific defect.

**Interfaces:**

- Verifies the final integrated experience rather than introducing new APIs.

- [ ] **Step 1: Start the application using the project run workflow**

Run the `run` skill or `npm run dev`, then open the app at the local URL reported by Next.js.

Expected: the page loads without console or hydration errors.

- [ ] **Step 2: Inspect English desktop at approximately 1440×900 and 1920×1080**

Verify:

- no generated 3D hero asset appears;
- headline shows three complete lines with no clipping;
- navigation feels integrated, not like a large floating pill;
- the atlas is the dominant visual and all five endpoints are legible;
- background linework is sparse and composition-specific;
- Mac and Windows actions remain usable;
- the next section begins naturally below the hero.

- [ ] **Step 3: Inspect tablet and mobile at approximately 834×1112 and 390×844**

Verify:

- atlas stays in normal flow and is not faded behind text;
- no horizontal overflow occurs;
- controls remain tappable;
- all essential atlas labels remain readable;
- CTAs stack correctly on narrow screens.

- [ ] **Step 4: Inspect the Chinese locale using `?lang=zh` at desktop and mobile widths**

Verify all three Chinese title lines, atlas labels, proof metadata, and nav controls fit without collision.

- [ ] **Step 5: Verify reduced motion and keyboard access**

Enable reduced motion in the browser/OS or emulate `prefers-reduced-motion: reduce`. Confirm route tracing, pulses, pointer depth, and magnetic offsets stop while the static atlas remains understandable. Tab through logo, nav, language switch, download action, and hero CTAs; visible focus must remain clear.

- [ ] **Step 6: Confirm the hero does not request its former image**

Use the browser network panel or page source/runtime inspection to confirm `/generated/djl-agent-core.png` is not loaded by the first viewport. It may still load later if another current section intentionally uses it.

- [ ] **Step 7: Perform the final command-line verification**

Run: `npm run lint && npm run build`

Expected: both PASS.

- [ ] **Step 8: Report the result without committing**

Summarize changed files, the final visual direction, responsive/localization/reduced-motion checks, and exact lint/build outcomes. Leave the existing working tree and all unrelated uncommitted work intact.
