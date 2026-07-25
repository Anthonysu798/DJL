# DJL Landing Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the active DJL landing page with a bilingual, enterprise-grade, playful product narrative that positions DJL Agent as the connective layer for any API, cloud model, local model, and tool.

**Architecture:** Keep `app/page.tsx` as a small server entry that resolves the URL locale, and make `app/Site.tsx` a composition shell. Split each animated chapter into a focused client component under `app/landing/`; GSAP owns scroll-linked motion and Motion owns local interaction states. Replace the active remote Spline/CDN visual path with three local image-generated PNG assets and code-native SVG/DOM diagrams.

**Tech Stack:** Next.js 16.2.9 App Router, React 19.2.7, TypeScript, GSAP 3.15.0, `@gsap/react` 2.1.2, Motion 12.40.0, Tailwind CSS 4.3.1, Lucide React, `next/image`, `next/font`.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-19-djl-landing-page-redesign-design.md`.
- Preserve Chinese as the default locale; `?lang=en` renders English and `?lang=zh` renders Chinese.
- Keep Mac and Windows actions honest UI-only controls; do not point them at nonexistent installers.
- Use MiniMax tokens: ink `#0a0a0a`, canvas `#ffffff`, surface `#f7f8fa`, hairline `#e5e7eb`, coral `#ff5530`, magenta `#ea5ec1`, blue `#1456f0`, purple `#a855f7`.
- Use DM Sans as the only Latin display/body family; use the existing CJK system fallback for Chinese glyphs.
- GSAP owns scroll-linked transforms, pinning, horizontal movement, and route progress.
- Motion owns entrances, hover/tap feedback, layout transitions, and the custom cursor spring.
- Never animate the same transform property on the same DOM node with both GSAP and Motion.
- Disable pinning, continuous ribbons, pointer parallax, magnetic movement, and cursor replacement under `prefers-reduced-motion`.
- Disable pointer-only effects on coarse pointers.
- Retain semantic HTML, visible keyboard focus, 44px mobile targets, and complete no-JavaScript reading order.
- Do not add a smooth-scroll interception library, WebGL scene, remote Spline iframe, remote icon CDN, fake customer logos, or fabricated metrics.
- Do not commit changes; the user did not request commits.

## File Structure

### Create

- `app/landing/assets.ts` — local generated artwork manifest and alt text.
- `app/landing/primitives.tsx` — `SectionLabel`, `MagneticLink`, and `PlatformIcon` primitives.
- `app/landing/CustomCursor.tsx` — fine-pointer-only spring cursor driven by `data-cursor` attributes.
- `app/landing/HeroSection.tsx` — hero copy, platform actions, route chips, Agent Core composition, pointer parallax.
- `app/landing/CompatibilityRibbon.tsx` — scroll-direction-aware capability ribbon.
- `app/landing/ConnectionConstellation.tsx` — accessible selectable routes and Connector Stack artwork.
- `app/landing/RuntimeStory.tsx` — desktop GSAP-pinned horizontal story and mobile native-snap fallback.
- `app/landing/CapabilityTunnel.tsx` — dark SVG execution path animated by ScrollTrigger.
- `app/landing/WorkflowPlayground.tsx` — Motion-powered recipe tabs and route-ticket layout.
- `app/landing/ConfidenceStrip.tsx` — operating-principle disclosures.
- `app/landing/DownloadStage.tsx` — Mac/Windows UI-preview actions and final artwork composition.
- `app/landing/LandingFooter.tsx` — black footer with real section anchors and inert unavailable links.
- `app/landing/landing.css` — all landing-page component styles and responsive/reduced-motion rules.
- `public/generated/djl-agent-core.png` — transparent Agent Core artwork.
- `public/generated/djl-connector-stack.png` — transparent Connector Stack artwork.
- `public/generated/djl-local-model-prism.png` — transparent Local Model Prism artwork.

### Modify

- `app/layout.tsx` — DM Sans, metadata, light theme color, global landing CSS import.
- `app/page.tsx` — pass only locale into the new site shell while tolerating old query parameters.
- `app/content.ts` — replace the old command-center copy with typed bilingual landing content.
- `app/Site.tsx` — replace the 982-line monolith with section composition only.
- `app/SiteNav.tsx` — new floating command bar, active-section state, language switch, and download anchor.
- `app/globals.css` — replace legacy multi-direction styles with tokens, reset, base accessibility, and shared utilities.

### Leave Unreferenced for This Pass

The old hero and experimental components remain in git but are removed from the active import graph: `app/hero/*`, `app/AgentConsole.tsx`, `app/BilingualBeams.tsx`, `app/IntroStage.tsx`, `app/ThreeSignalCore.tsx`, `app/Wake.tsx`, and legacy `app/ui/*` visuals. They can be removed in a separate cleanup after the redesigned page is approved.

---

### Task 1: Generate and Register the Three Local 3D Assets

**Files:**

- Create: `public/generated/djl-agent-core.png`
- Create: `public/generated/djl-connector-stack.png`
- Create: `public/generated/djl-local-model-prism.png`
- Create: `app/landing/assets.ts`

**Interfaces:**

- Produces: `landingAssets.agentCore`, `landingAssets.connectorStack`, and `landingAssets.localModelPrism`, each shaped as `{ src: string; alt: string; width: number; height: number }`.
- Consumed by: `HeroSection`, `ConnectionConstellation`, `RuntimeStory`, and `DownloadStage`.

- [ ] **Step 1: Generate Agent Core with imagegen**

Use this exact prompt:

```text
Premium isolated 3D product object for a modern enterprise AI-agent website: an asymmetric modular orb made from interlocking rounded black ceramic shells, clear resin windows, soft chrome joints, a luminous blue-to-purple inner core, and exactly two small coral connector details. Playful industrial design, elegant proportions, three-quarter front view, studio-soft rim lighting, highly polished but not toy-like, no text, no logo, no floor, no environment, no cast background, transparent alpha background, centered with generous transparent padding, ultra clean high-resolution product render.
```

Save the generated asset as `public/generated/djl-agent-core.png`.

- [ ] **Step 2: Generate Connector Stack with imagegen**

Use this exact prompt:

```text
Premium isolated 3D product sculpture for a modern enterprise AI-agent website: a dynamic diagonal cluster of modular rounded plugs, bridges, ports, and short connector arms orbiting one soft-chrome hub. Four clearly separated semantic materials: coral orange, vivid magenta, deep electric blue, and luminous purple, balanced with black ceramic and clear resin. Cohesive with a luxury industrial design system, playful but precise, no cables leaving the composition, no text, no logo, no floor, no environment, transparent alpha background, centered with generous transparent padding, high-resolution studio render.
```

Save the generated asset as `public/generated/djl-connector-stack.png`.

- [ ] **Step 3: Generate Local Model Prism with imagegen**

Use this exact prompt:

```text
Premium isolated 3D product object for a modern enterprise AI-agent website: a compact translucent purple compute prism with softly rounded corners, layered internal wafers visible through the resin, two black ceramic side rails, one tiny blue status light, and one removable coral module. Friendly and sculptural rather than a literal server rack, three-quarter view, soft chrome details, controlled studio lighting, no text, no logo, no floor, no environment, transparent alpha background, centered with generous transparent padding, high-resolution product render.
```

Save the generated asset as `public/generated/djl-local-model-prism.png`.

- [ ] **Step 4: Verify alpha and dimensions**

Run:

```bash
sips -g pixelWidth -g pixelHeight -g hasAlpha \
  public/generated/djl-agent-core.png \
  public/generated/djl-connector-stack.png \
  public/generated/djl-local-model-prism.png
```

Expected: each file reports `hasAlpha: yes` and both dimensions are at least 1200px. If imagegen returns a larger transparent image, keep it; `next/image` will optimize delivery.

- [ ] **Step 5: Add the typed asset manifest**

Create `app/landing/assets.ts`:

```ts
export const landingAssets = {
  agentCore: {
    src: "/generated/djl-agent-core.png",
    alt: "DJL Agent Core assembled from modular ceramic and translucent connector shells",
    width: 1600,
    height: 1600,
  },
  connectorStack: {
    src: "/generated/djl-connector-stack.png",
    alt: "A modular stack of API, tool, cloud, and local-model connectors",
    width: 1600,
    height: 1600,
  },
  localModelPrism: {
    src: "/generated/djl-local-model-prism.png",
    alt: "A translucent local-model compute prism with layered internal modules",
    width: 1600,
    height: 1600,
  },
} as const;
```

After generation, replace the manifest dimensions with the exact `sips` values if they differ.

- [ ] **Step 6: Validate the manifest**

Run:

```bash
npx eslint app/landing/assets.ts && test -s public/generated/djl-agent-core.png && test -s public/generated/djl-connector-stack.png && test -s public/generated/djl-local-model-prism.png
```

Expected: exit code 0 with no ESLint errors and no missing/empty assets.

---

### Task 2: Establish the Typography, Tokens, and Typed Bilingual Content

**Files:**

- Modify: `app/layout.tsx`
- Modify: `app/content.ts`
- Modify: `app/globals.css`
- Create: `app/landing/landing.css`

**Interfaces:**

- Produces: `Locale`, `SectionId`, `LandingContent`, and `content` from `app/content.ts`.
- Produces CSS variables consumed by every landing component.
- Consumed by: `app/page.tsx`, `app/Site.tsx`, `app/SiteNav.tsx`, and all `app/landing/*` sections.

- [ ] **Step 1: Replace the root font and metadata setup**

Rewrite `app/layout.tsx` to use DM Sans and import both global style files:

```tsx
import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import "./landing/landing.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DJL Agent — one agent, every model, any API",
  description: "Connect cloud APIs, local models, and the tools you already use with DJL Agent.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={dmSans.variable}>
      <body>{children}</body>
    </html>
  );
}
```

Do not keep the old scroll-restoration script; the new page has no forced boot sequence or scroll lock.

- [ ] **Step 2: Define the exact content schema**

At the top of `app/content.ts`, define:

```ts
export type Locale = "en" | "zh";
export type SectionId = "connect" | "runtime" | "recipes" | "download";

export type RuntimeChapter = {
  index: string;
  eyebrow: string;
  title: string;
  body: string;
  proof: string;
  tone: "coral" | "blue" | "purple" | "magenta";
};

export type WorkflowRecipe = {
  id: "research" | "private-files" | "operator";
  label: string;
  title: string;
  body: string;
  steps: readonly string[];
};

export type LandingContent = {
  htmlLang: "en" | "zh-CN";
  nav: readonly { id: SectionId; label: string }[];
  navDownload: string;
  hero: {
    eyebrow: string;
    title: readonly [string, string, string];
    body: string;
    mac: string;
    windows: string;
    note: string;
    routeLabels: readonly string[];
  };
  ribbon: readonly string[];
  constellation: {
    eyebrow: string;
    title: string;
    body: string;
    center: string;
    routes: readonly { id: string; source: string; destination: string; note: string }[];
  };
  runtime: {
    eyebrow: string;
    title: string;
    chapters: readonly RuntimeChapter[];
  };
  tunnel: {
    eyebrow: string;
    title: string;
    statements: readonly string[];
    stages: readonly string[];
  };
  recipes: {
    eyebrow: string;
    title: string;
    body: string;
    items: readonly WorkflowRecipe[];
  };
  confidence: readonly { title: string; body: string }[];
  download: {
    eyebrow: string;
    title: string;
    body: string;
    mac: string;
    macMeta: string;
    windows: string;
    windowsMeta: string;
    note: string;
  };
  footer: {
    statement: string;
    groups: readonly { title: string; links: readonly { label: string; href: string }[] }[];
    status: string;
  };
};
```

- [ ] **Step 3: Replace the old content with exact English and Chinese copy**

Export `content` with the following data. Keep the strings exactly as written so both locales have equivalent scope:

```ts
export const content = {
  en: {
    htmlLang: "en",
    nav: [
      { id: "connect", label: "Connect" },
      { id: "runtime", label: "Runtime" },
      { id: "recipes", label: "Recipes" },
      { id: "download", label: "Download" },
    ],
    navDownload: "Get DJL",
    hero: {
      eyebrow: "DJL AGENT / OPEN EXECUTION LAYER",
      title: ["One agent.", "Every model.", "Any API."],
      body: "Connect cloud APIs, local models, and the tools you already use—then run the same agent wherever your work lives.",
      mac: "Download for Mac",
      windows: "Download for Windows",
      note: "Interface preview · installers will be connected next",
      routeLabels: ["REST", "MCP", "LOCAL", "TOOLS", "FILES"],
    },
    ribbon: [
      "ANY REST API",
      "MCP SERVERS",
      "LOCAL WEIGHTS",
      "CLOUD MODELS",
      "FILES",
      "TOOLS",
      "YOUR STACK",
    ],
    constellation: {
      eyebrow: "CONNECTION CONSTELLATION",
      title: "Bring any input. Route it to the right intelligence.",
      body: "DJL sits between the systems you already use and the model that fits each job.",
      center: "DJL AGENT",
      routes: [
        {
          id: "webhook",
          source: "Webhook",
          destination: "Local model",
          note: "Keep the response path on your machine.",
        },
        {
          id: "mcp",
          source: "MCP tool",
          destination: "Cloud model",
          note: "Use hosted intelligence without changing the tool.",
        },
        {
          id: "files",
          source: "Files",
          destination: "Private runtime",
          note: "Move sensitive context toward your own hardware.",
        },
      ],
    },
    runtime: {
      eyebrow: "ONE AGENT / EVERY RUNTIME",
      title: "Change the intelligence, not the workflow.",
      chapters: [
        {
          index: "01",
          eyebrow: "CONNECT",
          title: "Connect anything",
          body: "Bring an endpoint, a tool, or a protocol. DJL turns the connection into something your agent can use.",
          proof: "API → agent-ready",
          tone: "coral",
        },
        {
          index: "02",
          eyebrow: "ROUTE",
          title: "Choose any brain",
          body: "Route work to a hosted model, a specialist API, or the model already running on your machine.",
          proof: "One task → the right model",
          tone: "blue",
        },
        {
          index: "03",
          eyebrow: "LOCAL",
          title: "Keep it local",
          body: "Move sensitive workflows toward your own hardware without redesigning the entire agent.",
          proof: "Private context → local runtime",
          tone: "purple",
        },
        {
          index: "04",
          eyebrow: "SHIP",
          title: "Ship the same flow",
          body: "Prototype on a laptop, then move the workflow to the runtime that fits.",
          proof: "Laptop → production path",
          tone: "magenta",
        },
      ],
    },
    tunnel: {
      eyebrow: "OPEN BY DESIGN",
      title: "Your agent should not care where intelligence lives.",
      statements: [
        "Swap providers without rebuilding the experience.",
        "Move a workflow closer to your data.",
        "Mix APIs, tools, and local inference in one route.",
      ],
      stages: ["INPUT", "CONTEXT", "ROUTE", "MODEL", "TOOL", "RESULT"],
    },
    recipes: {
      eyebrow: "WORKFLOW PLAYGROUND",
      title: "Compose a route. Keep the agent.",
      body: "Three example flows show how the same DJL layer can move through different systems.",
      items: [
        {
          id: "research",
          label: "Research relay",
          title: "Research without a closed stack",
          body: "Collect a source, route the context through DJL, summarize locally, and place the result where the team works.",
          steps: ["Web source", "DJL Agent", "Local summarizer", "Notes"],
        },
        {
          id: "private-files",
          label: "Private file analyst",
          title: "Keep file context close",
          body: "Read a scoped folder, select a local model, and return a structured result without redesigning the workflow.",
          steps: ["Folder", "DJL Agent", "Local model", "Structured result"],
        },
        {
          id: "operator",
          label: "Production operator",
          title: "Turn alerts into action",
          body: "Receive an event, reason over the context, call the right tool, and pause for a human handoff.",
          steps: ["Alert API", "DJL Agent", "Tool call", "Human handoff"],
        },
      ],
    },
    confidence: [
      {
        title: "Provider-flexible",
        body: "Move between model providers without rebuilding the product shell.",
      },
      {
        title: "Local-capable",
        body: "Route sensitive work toward models that run on hardware you control.",
      },
      {
        title: "Tool-native",
        body: "Connect APIs, files, and MCP tools as parts of one execution route.",
      },
      {
        title: "Runtime-portable",
        body: "Keep the workflow legible as it moves from laptop to deployment.",
      },
    ],
    download: {
      eyebrow: "CHOOSE YOUR PLATFORM",
      title: "Bring the agent. Choose the intelligence.",
      body: "Start with the platform you use today. The installer actions are presented as interface previews in this design phase.",
      mac: "Download for Mac",
      macMeta: "macOS UI preview",
      windows: "Download for Windows",
      windowsMeta: "Windows UI preview",
      note: "Interface preview—distribution links will be connected next.",
    },
    footer: {
      statement: "Open by design. Ready for your stack.",
      groups: [
        {
          title: "Product",
          links: [
            { label: "Connect", href: "#connect" },
            { label: "Runtime", href: "#runtime" },
            { label: "Recipes", href: "#recipes" },
            { label: "Downloads", href: "#download" },
          ],
        },
        {
          title: "Resources",
          links: [
            { label: "Docs", href: "#download" },
            { label: "Examples", href: "#recipes" },
            { label: "Changelog", href: "#download" },
            { label: "GitHub", href: "#download" },
          ],
        },
      ],
      status: "DJL AGENT / INTERFACE PREVIEW",
    },
  },
  zh: {
    htmlLang: "zh-CN",
    nav: [
      { id: "connect", label: "连接" },
      { id: "runtime", label: "运行方式" },
      { id: "recipes", label: "工作流" },
      { id: "download", label: "下载" },
    ],
    navDownload: "获取 DJL",
    hero: {
      eyebrow: "DJL 智能体 / 开放执行层",
      title: ["一个智能体。", "任意模型。", "连接所有 API。"],
      body: "连接云端 API、本地模型和你已经在用的工具，再让同一个智能体运行在工作真正发生的地方。",
      mac: "下载 Mac 版",
      windows: "下载 Windows 版",
      note: "界面预览 · 安装包将在下一阶段接入",
      routeLabels: ["REST", "MCP", "本地模型", "工具", "文件"],
    },
    ribbon: ["任意 REST API", "MCP 服务器", "本地权重", "云端模型", "文件", "工具", "你的技术栈"],
    constellation: {
      eyebrow: "连接星图",
      title: "接入任何输入，把它路由到合适的智能。",
      body: "DJL 位于现有系统与每个任务所需模型之间。",
      center: "DJL 智能体",
      routes: [
        {
          id: "webhook",
          source: "Webhook",
          destination: "本地模型",
          note: "让响应路径留在你的设备上。",
        },
        {
          id: "mcp",
          source: "MCP 工具",
          destination: "云端模型",
          note: "无需改变工具，就能使用托管智能。",
        },
        {
          id: "files",
          source: "文件",
          destination: "私有运行时",
          note: "让敏感上下文更靠近你自己的硬件。",
        },
      ],
    },
    runtime: {
      eyebrow: "一个智能体 / 每种运行方式",
      title: "更换智能，不必重做工作流。",
      chapters: [
        {
          index: "01",
          eyebrow: "连接",
          title: "接入任何系统",
          body: "带上一个接口、一件工具或一种协议，DJL 会把它变成智能体能够使用的连接。",
          proof: "API → 智能体可用",
          tone: "coral",
        },
        {
          index: "02",
          eyebrow: "路由",
          title: "选择任意模型",
          body: "把任务交给云端模型、专用 API，或已经运行在你设备上的模型。",
          proof: "一个任务 → 合适的模型",
          tone: "blue",
        },
        {
          index: "03",
          eyebrow: "本地",
          title: "让敏感工作留在本地",
          body: "把敏感工作流移动到自己的硬件上，而无需重新设计整个智能体。",
          proof: "私有上下文 → 本地运行时",
          tone: "purple",
        },
        {
          index: "04",
          eyebrow: "交付",
          title: "交付同一套流程",
          body: "先在笔记本上完成原型，再把工作流移动到真正合适的运行环境。",
          proof: "笔记本 → 生产路径",
          tone: "magenta",
        },
      ],
    },
    tunnel: {
      eyebrow: "开放设计",
      title: "智能体不该在意智能运行在哪里。",
      statements: [
        "更换提供方，不必重建整个体验。",
        "让工作流更靠近你的数据。",
        "在同一路由里组合 API、工具和本地推理。",
      ],
      stages: ["输入", "上下文", "路由", "模型", "工具", "结果"],
    },
    recipes: {
      eyebrow: "工作流游乐场",
      title: "组合一条路由，保留同一个智能体。",
      body: "三条示例流程展示同一个 DJL 层如何穿过不同系统。",
      items: [
        {
          id: "research",
          label: "研究接力",
          title: "不被封闭技术栈限制的研究",
          body: "收集来源，通过 DJL 路由上下文，在本地总结，再把结果放进团队正在使用的工具。",
          steps: ["网页来源", "DJL 智能体", "本地总结器", "笔记"],
        },
        {
          id: "private-files",
          label: "私有文件分析",
          title: "让文件上下文留在近处",
          body: "读取限定文件夹，选择本地模型，再返回结构化结果，无需重做工作流。",
          steps: ["文件夹", "DJL 智能体", "本地模型", "结构化结果"],
        },
        {
          id: "operator",
          label: "生产运维",
          title: "把告警变成行动",
          body: "接收事件，理解上下文，调用合适的工具，并在需要时暂停等待人工接手。",
          steps: ["告警 API", "DJL 智能体", "工具调用", "人工接手"],
        },
      ],
    },
    confidence: [
      { title: "提供方灵活", body: "在不同模型提供方之间移动，而不必重建产品外壳。" },
      { title: "支持本地运行", body: "把敏感工作路由到运行在你所控制硬件上的模型。" },
      { title: "原生连接工具", body: "把 API、文件和 MCP 工具组合进同一条执行路由。" },
      { title: "运行时可迁移", body: "从笔记本到部署环境，工作流始终清晰可读。" },
    ],
    download: {
      eyebrow: "选择你的平台",
      title: "带上智能体，选择智能。",
      body: "从你今天使用的平台开始。当前设计阶段只展示安装入口的界面状态。",
      mac: "下载 Mac 版",
      macMeta: "macOS 界面预览",
      windows: "下载 Windows 版",
      windowsMeta: "Windows 界面预览",
      note: "界面预览——分发链接将在下一阶段接入。",
    },
    footer: {
      statement: "开放设计，接入你的技术栈。",
      groups: [
        {
          title: "产品",
          links: [
            { label: "连接", href: "#connect" },
            { label: "运行方式", href: "#runtime" },
            { label: "工作流", href: "#recipes" },
            { label: "下载", href: "#download" },
          ],
        },
        {
          title: "资源",
          links: [
            { label: "文档", href: "#download" },
            { label: "示例", href: "#recipes" },
            { label: "更新日志", href: "#download" },
            { label: "GitHub", href: "#download" },
          ],
        },
      ],
      status: "DJL 智能体 / 界面预览",
    },
  },
} as const satisfies Record<Locale, LandingContent>;
```

- [ ] **Step 4: Replace the global stylesheet with the exact base system**

Rewrite `app/globals.css` so it contains Tailwind, the MiniMax tokens, reset, focus, selection, shell, skip link, and no component-specific legacy styles:

```css
@import "tailwindcss";

:root {
  --ink: #0a0a0a;
  --canvas: #ffffff;
  --surface: #f7f8fa;
  --hairline: #e5e7eb;
  --body: #222222;
  --muted: #5f5f5f;
  --coral: #ff5530;
  --magenta: #ea5ec1;
  --blue: #1456f0;
  --purple: #a855f7;
  --font-sans:
    var(--font-dm-sans), "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --max-width: 1280px;
  color-scheme: light;
}

* {
  box-sizing: border-box;
}
html {
  scroll-behavior: auto;
  -webkit-text-size-adjust: 100%;
}
body {
  margin: 0;
  overflow-x: clip;
  background: var(--canvas);
  color: var(--body);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
a {
  color: inherit;
  text-decoration: none;
}
button {
  color: inherit;
  font: inherit;
}
img {
  max-width: 100%;
}
::selection {
  background: var(--coral);
  color: #fff;
}
:focus-visible {
  outline: 3px solid var(--blue);
  outline-offset: 4px;
  border-radius: 6px;
}
.shell {
  width: min(var(--max-width), calc(100% - 64px));
  margin-inline: auto;
}
.skip-link {
  position: fixed;
  left: 16px;
  top: 12px;
  z-index: 200;
  transform: translateY(-160%);
  border-radius: 999px;
  background: var(--ink);
  color: white;
  padding: 10px 16px;
  transition: transform 180ms ease;
}
.skip-link:focus {
  transform: translateY(0);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 767px) {
  .shell {
    width: min(100% - 40px, var(--max-width));
  }
}
@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.001ms !important;
  }
}
```

Create `app/landing/landing.css` with only the opening page-level rules so later tasks can append section styles:

```css
.djl-site {
  min-height: 100dvh;
  background: var(--canvas);
  color: var(--body);
}
.djl-main {
  overflow: clip;
}
.djl-grain {
  position: fixed;
  inset: 0;
  z-index: 90;
  pointer-events: none;
  opacity: 0.025;
  mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.84' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E");
}
.section-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.section-label::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: currentColor;
}
```

- [ ] **Step 5: Type-check the foundation**

Run:

```bash
npx tsc --noEmit && npx eslint app/layout.tsx app/content.ts
```

Expected: exit code 0 with no type or lint errors.

---

### Task 3: Build Shared Interaction Primitives and the Custom Cursor

**Files:**

- Create: `app/landing/primitives.tsx`
- Create: `app/landing/CustomCursor.tsx`
- Modify: `app/landing/landing.css`

**Interfaces:**

- Produces: `SectionLabel({ children, tone? })`, `MagneticLink({ href, children, className?, cursorLabel? })`, and `PlatformIcon({ platform })`.
- Produces: `<CustomCursor />`, driven by `data-cursor="open|scroll|drag"` and optional `data-cursor-label`.
- Consumed by: navigation, hero, runtime story, workflow, and download components.

- [ ] **Step 1: Create the primitives with one animation owner per element**

Create `app/landing/primitives.tsx` as a client component. Use Motion values for the magnetic link only; do not let GSAP animate the same anchor:

```tsx
"use client";

import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import type { PointerEvent, ReactNode } from "react";

export function SectionLabel({
  children,
  tone = "ink",
}: {
  children: ReactNode;
  tone?: "ink" | "light";
}) {
  return <span className={`section-label ${tone === "light" ? "is-light" : ""}`}>{children}</span>;
}

export function MagneticLink({
  href,
  children,
  className = "",
  cursorLabel = "OPEN",
}: {
  href: string;
  children: ReactNode;
  className?: string;
  cursorLabel?: string;
}) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 280, damping: 24, mass: 0.35 });
  const sy = useSpring(y, { stiffness: 280, damping: 24, mass: 0.35 });

  const move = (event: PointerEvent<HTMLAnchorElement>) => {
    if (reduce || event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(((event.clientX - rect.left) / rect.width - 0.5) * 12);
    y.set(((event.clientY - rect.top) / rect.height - 0.5) * 12);
  };

  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.a
      href={href}
      className={className}
      style={{ x: sx, y: sy }}
      onPointerMove={move}
      onPointerLeave={reset}
      onBlur={reset}
      data-cursor="open"
      data-cursor-label={cursorLabel}
      whileTap={reduce ? undefined : { scale: 0.98 }}
    >
      {children}
    </motion.a>
  );
}

export function PlatformIcon({ platform }: { platform: "mac" | "windows" }) {
  return platform === "mac" ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17.2 12.7c0-2.7 2.2-4 2.3-4.1-1.3-1.9-3.3-2.1-4-2.1-1.7-.2-3.3 1-4.2 1-.9 0-2.3-1-3.8-1-1.9 0-3.7 1.1-4.7 2.8-2 3.5-.5 8.7 1.4 11.5.9 1.4 2.1 3 3.6 2.9 1.4-.1 2-1 3.7-1s2.2 1 3.8 1c1.6 0 2.6-1.4 3.5-2.8 1.1-1.6 1.5-3.2 1.5-3.3-.1 0-3.1-1.2-3.1-4.9ZM14.4 4.7c.8-1 1.3-2.3 1.2-3.7-1.2.1-2.6.8-3.4 1.8-.7.8-1.4 2.2-1.2 3.5 1.3.1 2.6-.6 3.4-1.6Z"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="m2 5.1 8.1-1.1v7.4H2V5.1Zm9.1-1.3L22 2.3v9.1H11.1V3.8ZM2 12.5h8.1V20L2 18.9v-6.4Zm9.1 0H22v9.2l-10.9-1.5v-7.7Z"
      />
    </svg>
  );
}
```

- [ ] **Step 2: Create the fine-pointer custom cursor**

Create `app/landing/CustomCursor.tsx` with one global pointer listener, one delegated hover listener, and safe eligibility checks:

```tsx
"use client";

import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { useEffect, useState } from "react";

export function CustomCursor() {
  const reduce = useReducedMotion();
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const sx = useSpring(x, { stiffness: 520, damping: 38, mass: 0.2 });
  const sy = useSpring(y, { stiffness: 520, damping: 38, mass: 0.2 });
  const [eligible, setEligible] = useState(false);
  const [mode, setMode] = useState("default");
  const [label, setLabel] = useState("");

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const update = () => setEligible(fine.matches && !reduce);
    update();
    fine.addEventListener("change", update);
    return () => fine.removeEventListener("change", update);
  }, [reduce]);

  useEffect(() => {
    if (!eligible) return;
    const move = (event: PointerEvent) => {
      x.set(event.clientX);
      y.set(event.clientY);
    };
    const over = (event: PointerEvent) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-cursor]");
      setMode(target?.dataset.cursor ?? "default");
      setLabel(target?.dataset.cursorLabel ?? "");
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerover", over, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerover", over);
    };
  }, [eligible, x, y]);

  if (!eligible) return null;

  return (
    <motion.div
      className="custom-cursor"
      data-mode={mode}
      style={{ x: sx, y: sy }}
      aria-hidden="true"
    >
      <span>{label}</span>
    </motion.div>
  );
}
```

- [ ] **Step 3: Add exact primitive and cursor styles**

Append styles for `.magnetic-link`, platform SVG sizing, and `.custom-cursor`. The cursor must use `transform: translate(-50%, -50%)` on an inner pseudo-element rather than overriding Motion’s transform on the root. Hide the native cursor only inside `.djl-site[data-custom-cursor="true"]` and only in `@media (pointer: fine) and (prefers-reduced-motion: no-preference)`; retain native cursors for text selection and inputs.

- [ ] **Step 4: Validate shared interaction code**

Run:

```bash
npx eslint app/landing/primitives.tsx app/landing/CustomCursor.tsx && npx tsc --noEmit
```

Expected: exit code 0. Verify no `window` or `document` access occurs outside effects.

---

### Task 4: Build the Floating Navigation, Hero, and Compatibility Ribbon

**Files:**

- Modify: `app/SiteNav.tsx`
- Create: `app/landing/HeroSection.tsx`
- Create: `app/landing/CompatibilityRibbon.tsx`
- Modify: `app/landing/landing.css`

**Interfaces:**

- `SiteNav` consumes `{ locale: Locale; items: LandingContent["nav"]; downloadLabel: string }`.
- `HeroSection` consumes `{ copy: LandingContent["hero"] }`.
- `CompatibilityRibbon` consumes `{ items: LandingContent["ribbon"] }`.
- All three render stable semantic markup before animation initializes.

- [ ] **Step 1: Replace the navigation with the new command bar**

Implement a fixed `.command-nav` that observes `connect`, `runtime`, `recipes`, and `download`; uses GSAP `ScrollToPlugin` only for anchor clicks; sets `aria-current="page"` on the active section; and keeps `?lang=en` / `?lang=zh` language links. The download pill points to `#download`, not to a file.

- [ ] **Step 2: Build the hero client island**

Create `HeroSection.tsx` with:

- `motion.h1` line children using a clipped parent and `y: "105%" → 0` transition.
- Two `MagneticLink` actions pointing to `#download` and carrying `data-platform="mac|windows"`.
- An Agent Core `next/image` using `landingAssets.agentCore`.
- Five route-chip buttons rendered as inert visual labels with `tabIndex={-1}` and `aria-hidden="true"`.
- Pointer parallax built from Motion values on an outer artwork wrapper only; image and route labels never receive GSAP transforms.
- A reduced-motion branch that renders final positions immediately.

Use this accessible heading structure:

```tsx
<h1 className="hero-heading">
  <span>{copy.title[0]}</span>
  <span>{copy.title[1]}</span>
  <span className="hero-heading-accent">{copy.title[2]}</span>
</h1>
```

- [ ] **Step 3: Build the direction-aware ribbon**

In `CompatibilityRibbon.tsx`, duplicate the item list exactly twice for seamless travel. Use a GSAP tween on the track and adjust `timeScale` between `1` and `-1` from scroll direction. Kill the tween and scroll listener on cleanup. Under reduced motion, do not create the tween and render a wrapped static list.

- [ ] **Step 4: Add navigation, hero, and ribbon styles**

Implement:

- White editorial hero with asymmetric two-column grid.
- Hero type `clamp(3.6rem, 8vw, 7.5rem)`, weight 600, line-height `.92`.
- Black primary pill and outlined secondary pill.
- Agent Core at the right edge with no surrounding card.
- Route lines as absolutely positioned 1px elements using semantic accent colors.
- Command bar as white/90 with a hairline and restrained blur; no glass-heavy gradient.
- Ribbon bordered top/bottom with black connector glyph separators.

- [ ] **Step 5: Validate the opening experience**

Run:

```bash
npx eslint app/SiteNav.tsx app/landing/HeroSection.tsx app/landing/CompatibilityRibbon.tsx && npx tsc --noEmit
```

Expected: exit code 0. Keyboard focus must reach language controls and both download actions in document order.

---

### Task 5: Build the Accessible Connection Constellation

**Files:**

- Create: `app/landing/ConnectionConstellation.tsx`
- Modify: `app/landing/landing.css`

**Interfaces:**

- Consumes: `{ copy: LandingContent["constellation"] }` and `landingAssets.connectorStack`.
- Produces: section `id="connect"` for navigation and a three-route keyboard-selectable visualization.

- [ ] **Step 1: Create the route state model**

Use `useState(copy.routes[0].id)` and derive `activeRoute` from the immutable content array. Render route selectors as real buttons in a list. Each button sets active state on click and focus, and uses `aria-pressed`.

- [ ] **Step 2: Render the semantic constellation**

Use an SVG behind the controls for three source-to-center and center-to-destination lines. Keep labels as HTML, not SVG text. The selected route uses the blue/purple/coral semantic stroke; inactive lines use `var(--hairline)`. Render the Connector Stack with `next/image` outside the diagram card so it overlaps the stage edge.

- [ ] **Step 3: Animate selection with Motion only**

Animate the active route description through `AnimatePresence mode="wait"`. Use `layoutId="active-route"` for the selected pill background. Do not use GSAP in this section.

- [ ] **Step 4: Add responsive constellation styles**

Desktop: editorial copy on the left, constellation stage on the right, artwork overlapping the lower-right edge. Mobile: buttons stack, SVG becomes a simplified vertical route, artwork moves behind the stage at low opacity without obscuring text.

- [ ] **Step 5: Validate route semantics**

Run:

```bash
npx eslint app/landing/ConnectionConstellation.tsx && npx tsc --noEmit
```

Expected: exit code 0. Each selector is keyboard reachable, has an accessible name, and updates `aria-pressed`.

---

### Task 6: Build the Desktop Pinned Horizontal Runtime Story and Mobile Snap Fallback

**Files:**

- Create: `app/landing/RuntimeStory.tsx`
- Modify: `app/landing/landing.css`

**Interfaces:**

- Consumes: `{ copy: LandingContent["runtime"] }` and `landingAssets.localModelPrism`.
- Produces: section `id="runtime"` and four `.runtime-panel` children inside `.runtime-track`.

- [ ] **Step 1: Render all four chapters in source order**

Use a normal section with an intro header followed by a track. Each panel contains index, eyebrow, title, body, proof, and a diagrammatic route line. Only chapter `03` renders the Local Model Prism. Add `data-tone` from the typed chapter.

- [ ] **Step 2: Add the scoped GSAP horizontal timeline**

Use `useGSAP` with `scope: rootRef` and `gsap.matchMedia()`:

```ts
media.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
  const track = trackRef.current;
  if (!track) return;
  const distance = () => Math.max(0, track.scrollWidth - window.innerWidth);
  const tween = gsap.to(track, {
    x: () => -distance(),
    ease: "none",
    scrollTrigger: {
      trigger: rootRef.current,
      start: "top top",
      end: () => `+=${distance()}`,
      pin: true,
      scrub: 0.85,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
  });
  return () => tween.kill();
});
```

Return `media.revert()` from the hook. Do not manually call `ScrollTrigger.getAll().forEach(kill)` because that would destroy other sections’ triggers.

- [ ] **Step 3: Add panel-progress details**

Create a slim progress rail inside the pinned section using the same timeline progress. Use a separate child `.runtime-progress-fill` tween inside the same GSAP context. Do not use React state on scroll.

- [ ] **Step 4: Add desktop and fallback styles**

Desktop: `.runtime-track` is `display:flex; width:max-content`; each panel is `min-width:100vw; min-height:100svh`. Mobile/tablet: `overflow-x:auto; scroll-snap-type:x mandatory`; no fixed height and no pinning. Hide scrollbars visually without disabling scroll.

- [ ] **Step 5: Validate cleanup and fallback**

Run:

```bash
npx eslint app/landing/RuntimeStory.tsx && npx tsc --noEmit
```

Expected: exit code 0. Confirm the code creates no ScrollTrigger when reduced motion is enabled or viewport width is below 1024px.

---

### Task 7: Build the Dark Capability Tunnel

**Files:**

- Create: `app/landing/CapabilityTunnel.tsx`
- Modify: `app/landing/landing.css`

**Interfaces:**

- Consumes: `{ copy: LandingContent["tunnel"] }`.
- Produces: a near-black section with one SVG path, six labeled route stages, and three statements.

- [ ] **Step 1: Render the route as SVG geometry plus HTML labels**

Use one responsive `viewBox="0 0 1200 520"` SVG with a visible path and a second accent path sharing `d="M40 380 C220 380 180 120 360 120 S520 380 680 380 S840 120 1010 120 S1090 260 1160 260"`. Place six HTML labels over the route using CSS grid so translated Chinese text remains readable.

- [ ] **Step 2: Animate path progress and statement entrances with one GSAP timeline**

Set the accent path to `pathLength="1"`, `strokeDasharray="1"`, and `strokeDashoffset="1"`. Use `useGSAP` and a ScrollTrigger timeline from `top 70%` to `bottom 65%` with `scrub: 0.7`; animate dash offset to `0`, then statement opacity/y in a stagger. Under reduced motion, render dash offset `0` and statements visible without creating a trigger.

- [ ] **Step 3: Add dark-section styles**

Use `#0a0a0a` background, white type, muted `rgba(255,255,255,.62)`, hairline route grid, and one controlled blue-to-purple route glow. Do not add terminal chrome, fake logs, or generic code cards.

- [ ] **Step 4: Validate the tunnel**

Run:

```bash
npx eslint app/landing/CapabilityTunnel.tsx && npx tsc --noEmit
```

Expected: exit code 0 and no duplicated ScrollTrigger registration outside the module setup.

---

### Task 8: Build the Workflow Playground and Confidence Strip

**Files:**

- Create: `app/landing/WorkflowPlayground.tsx`
- Create: `app/landing/ConfidenceStrip.tsx`
- Modify: `app/landing/landing.css`

**Interfaces:**

- `WorkflowPlayground` consumes `{ copy: LandingContent["recipes"] }` and produces section `id="recipes"`.
- `ConfidenceStrip` consumes `{ items: LandingContent["confidence"] }`.

- [ ] **Step 1: Build the accessible recipe tablist**

Render each recipe label as a button with `role="tab"`, `aria-selected`, `aria-controls`, and roving `tabIndex`. Add ArrowLeft/ArrowRight/Home/End keyboard handling. The selected panel uses `role="tabpanel"` and references the active tab id.

- [ ] **Step 2: Build the route-ticket layout**

Render the selected recipe’s four steps as overlapping ticket elements connected by a code-native line. Use `LayoutGroup` and `layout` on the tickets; animate selection with `AnimatePresence mode="wait"`. Each ticket includes the sequence number and exact step label.

- [ ] **Step 3: Build confidence disclosures without fabricated metrics**

Use native `<details>` / `<summary>` elements for the four confidence principles. Desktop CSS keeps summaries in one row and reveals body copy beneath; mobile stacks them. This guarantees keyboard and no-JavaScript behavior without custom state.

- [ ] **Step 4: Add playful but restrained styles**

Use white bordered route tickets, one accent per active recipe, oversized sequence numerals, and a subtle spring tilt only on hover-capable devices. Avoid a uniform bento grid.

- [ ] **Step 5: Validate tab and disclosure behavior**

Run:

```bash
npx eslint app/landing/WorkflowPlayground.tsx app/landing/ConfidenceStrip.tsx && npx tsc --noEmit
```

Expected: exit code 0. Keyboard arrows change tabs and every `<details>` summary remains independently focusable.

---

### Task 9: Build the Download Finale and Footer

**Files:**

- Create: `app/landing/DownloadStage.tsx`
- Create: `app/landing/LandingFooter.tsx`
- Modify: `app/landing/landing.css`

**Interfaces:**

- `DownloadStage` consumes `{ copy: LandingContent["download"] }` and all three artwork manifest entries.
- `LandingFooter` consumes `{ copy: LandingContent["footer"] }`.
- Produces: section `id="download"` and final page footer.

- [ ] **Step 1: Build honest platform controls**

Render Mac and Windows controls as `<button type="button">`, not anchors, because no download URL exists. Set `aria-describedby` to the shared preview note. Use `PlatformIcon` and `data-cursor="open"`. Clicking a control should only produce a short inline `Preview only` / `仅为预览` status via `aria-live="polite"`; it must not navigate or start a download.

- [ ] **Step 2: Compose the final three-object artwork**

Render the Agent Core, Connector Stack, and Local Model Prism in one decorative composition. Use empty `alt=""` in this repeated decorative context because descriptive versions appeared earlier. Motion may animate hover separation by at most 12px; reduced motion renders the settled arrangement.

- [ ] **Step 3: Build the footer with safe destinations**

Use the content-provided anchor hrefs. For unavailable Docs/Changelog/GitHub destinations, the content intentionally points to an existing on-page section instead of `#` or a missing external URL. Include the DJL wordmark text, statement, groups, status line, and current year as static `2026` to avoid hydration differences.

- [ ] **Step 4: Add finale and footer styles**

Use a white download stage with a coral promotional surface and embedded white/black platform controls, followed by a black footer. Buttons remain fully rounded; the promo surface uses 32px radius and 64px desktop padding, matching the MiniMax reference.

- [ ] **Step 5: Validate platform behavior**

Run:

```bash
npx eslint app/landing/DownloadStage.tsx app/landing/LandingFooter.tsx && npx tsc --noEmit
```

Expected: exit code 0. No `href` references a nonexistent installer.

---

### Task 10: Compose the New Active Page and Remove Legacy Runtime Dependencies from Its Import Graph

**Files:**

- Modify: `app/Site.tsx`
- Modify: `app/page.tsx`
- Modify: `app/landing/landing.css`

**Interfaces:**

- `Site({ locale }: { locale: Locale })` becomes the only active landing-page composition export.
- `Home` resolves locale from `searchParams` and renders `<Site locale={locale} />`.

- [ ] **Step 1: Replace `Site.tsx` with composition-only markup**

Use this exact order:

```tsx
import { content, type Locale } from "./content";
import { SiteNav } from "./SiteNav";
import { CapabilityTunnel } from "./landing/CapabilityTunnel";
import { CompatibilityRibbon } from "./landing/CompatibilityRibbon";
import { ConfidenceStrip } from "./landing/ConfidenceStrip";
import { ConnectionConstellation } from "./landing/ConnectionConstellation";
import { CustomCursor } from "./landing/CustomCursor";
import { DownloadStage } from "./landing/DownloadStage";
import { HeroSection } from "./landing/HeroSection";
import { LandingFooter } from "./landing/LandingFooter";
import { RuntimeStory } from "./landing/RuntimeStory";
import { WorkflowPlayground } from "./landing/WorkflowPlayground";

export function Site({ locale }: { locale: Locale }) {
  const t = content[locale];
  return (
    <div className="djl-site" lang={t.htmlLang}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <CustomCursor />
      <div className="djl-grain" aria-hidden="true" />
      <SiteNav locale={locale} items={t.nav} downloadLabel={t.navDownload} />
      <main id="main-content" className="djl-main">
        <HeroSection copy={t.hero} />
        <CompatibilityRibbon items={t.ribbon} />
        <ConnectionConstellation copy={t.constellation} />
        <RuntimeStory copy={t.runtime} />
        <CapabilityTunnel copy={t.tunnel} />
        <WorkflowPlayground copy={t.recipes} />
        <ConfidenceStrip items={t.confidence} />
        <DownloadStage copy={t.download} />
      </main>
      <LandingFooter copy={t.footer} />
    </div>
  );
}
```

Localize the skip-link text by adding `skipToContent` to `LandingContent` (`"Skip to content"` / `"跳到主要内容"`) and use `t.skipToContent` in the final code instead of the English literal shown in the composition skeleton.

- [ ] **Step 2: Simplify the page entry while preserving old URLs**

Rewrite `app/page.tsx`:

```tsx
import { Site } from "./Site";
import type { Locale } from "./content";

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const locale: Locale = params.lang === "en" ? "en" : "zh";
  return <Site locale={locale} />;
}
```

Old `?tab=` parameters are tolerated and ignored rather than causing errors.

- [ ] **Step 3: Confirm the active import graph is local**

Run:

```bash
rg -n "Spline|my\.spline|cdn\.simpleicons|DjlHero|ThreeSignalCore|IconCloud" app/Site.tsx app/SiteNav.tsx app/landing app/page.tsx
```

Expected: no matches.

- [ ] **Step 4: Run the first complete build**

Run:

```bash
npm run lint && npm run build
```

Expected: both commands exit 0. The build output includes `/` as a successfully generated route and contains no hydration or TypeScript errors.

---

### Task 11: Complete Responsive, Reduced-Motion, Cursor, and Accessibility Rules

**Files:**

- Modify: `app/landing/landing.css`
- Modify: any `app/landing/*.tsx` file where validation finds a semantic issue

**Interfaces:**

- Applies project-wide behavior without changing section content contracts.

- [ ] **Step 1: Add breakpoint rules**

Implement exact tiers:

- `>=1280px`: full 1280px shell and expanded art offsets.
- `1024–1279px`: desktop pinning remains; reduce artwork scale and gutters.
- `768–1023px`: no GSAP pinning; runtime story uses native snap; condensed nav.
- `<768px`: one-column sections, 20px gutters, stacked download controls, no pointer tilt.
- `<480px`: hero `clamp(3rem, 14vw, 4.5rem)`, footer groups stacked, route labels shortened only through CSS wrapping—not hidden content.

- [ ] **Step 2: Add reduced-motion final-state rules**

Under `@media (prefers-reduced-motion: reduce)`:

- Set all reveal elements to visible and `transform:none`.
- Set ribbon track to `transform:none` and allow wrapping.
- Set runtime track to native horizontal/vertical flow without pin spacer assumptions.
- Hide custom cursor.
- Remove magnetic/pointer transition movement.
- Keep SVG tunnel path fully drawn.

- [ ] **Step 3: Add coarse-pointer rules**

Under `@media (pointer: coarse)` hide `.custom-cursor`, restore `cursor:auto`, disable hover tilts, and increase all tabs/buttons to at least 44px height.

- [ ] **Step 4: Audit labels and landmark order**

Verify:

- One `h1` only.
- Every section uses an `h2`.
- Navigation has `aria-label` in the active language.
- Decorative repeated artwork has `alt=""`.
- Informative first-use artwork has the manifest alt text.
- Platform preview status uses `aria-live="polite"`.
- Workflow tabs and constellation buttons expose their selected state.

- [ ] **Step 5: Validate the final static code**

Run:

```bash
npm run lint && npx tsc --noEmit && npm run build
```

Expected: all commands exit 0.

---

### Task 12: Run the Application and Perform Visual/Interaction Verification

**Files:**

- Modify only files implicated by observed failures.
- Record results in the final response; do not create a second QA document unless requested.

**Interfaces:**

- Validates the complete page at English and Chinese URLs.

- [ ] **Step 1: Start the production-equivalent app**

Use the project run workflow to launch the app. Prefer a production build/server after Task 11 passes:

```bash
npm run build
npm start
```

Expected: the server reports a local URL and `/` responds successfully.

- [ ] **Step 2: Verify desktop English at 1440×900**

Open `/?lang=en` and check:

- Hero headline and both platform actions are visible above the fold.
- Agent Core has a transparent edge with no baked rectangle.
- Command nav activates Connect, Runtime, Recipes, and Download at the correct scroll positions.
- Horizontal runtime story pins once, advances through four full panels, and releases cleanly.
- Capability route draws without jumping.
- Custom cursor changes labels on buttons and horizontal story without hiding text-selection cursor.
- No unintended horizontal scrollbar appears.

- [ ] **Step 3: Verify Chinese default at 390×844**

Open `/` and check:

- Chinese is rendered without requiring a query parameter.
- No English-only product paragraphs remain.
- Hero headline wraps cleanly.
- Runtime story is swipe/native-snap rather than pinned.
- Route buttons and recipe tabs have 44px touch targets.
- Download controls stack without clipping.
- Footer groups remain readable.

- [ ] **Step 4: Verify tablet at 768×1024 and 1024×768**

Check both orientations. At 768px there is no pinning; at 1024px the pinned version may run only if the viewport has a fine pointer. Artwork cannot overlap copy or navigation.

- [ ] **Step 5: Verify reduced motion**

Emulate `prefers-reduced-motion: reduce` and reload. Confirm:

- All content is visible.
- No boot lock, continuous ribbon, pointer parallax, custom cursor, or pinned blank space remains.
- Runtime panels remain reachable in source order.
- Tunnel path is already drawn.

- [ ] **Step 6: Check browser console and final commands**

Expected console: no errors, hydration warnings, failed image requests, or ScrollTrigger duplicate warnings.

Run one final time:

```bash
npm run lint && npm run build && git status --short
```

Expected: lint/build exit 0. `git status --short` lists only the intended landing-page files, generated assets, design spec, and implementation plan. Do not commit.

## Plan Self-Review Result

- Spec coverage: all visual-system, bilingual, generated-artwork, horizontal-scroll, parallax, custom-cursor, download-placeholder, accessibility, responsive, reduced-motion, and validation requirements map to explicit tasks.
- Placeholder scan: every implementation step names its files, behavior, code shape, command, and expected result.
- Type consistency: every component consumes a named `LandingContent` slice; `Locale`, `SectionId`, `RuntimeChapter`, `WorkflowRecipe`, `landingAssets`, and component prop names are defined before use.
- Scope: the active landing page is replaced without deleting legacy files or adding backend/download behavior.
- Commit policy: commit steps are intentionally omitted because the user did not authorize commits.
