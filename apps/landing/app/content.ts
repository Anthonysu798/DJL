export type Locale = "en" | "zh";
export type ConsoleTab = "plan" | "tools" | "review";

type BootLine = { text: string; ok?: boolean };

export const codeLines = [
  "import { Router } from 'express'",
  "import { z } from 'zod'",
  "import { createUser } from '../lib/user'",
  "",
  "const router = Router()",
  "const Body = z.object({",
  "  name: z.string().min(1),",
  "  email: z.string().email(),",
  "})",
  "",
  "router.post('/users', async (req, res) => {",
  "  const parsed = Body.safeParse(req.body)",
  "  if (!parsed.success) {",
  "    return res.status(400).json({ error: 'Invalid input' })",
  "  }",
  "  const user = await createUser(parsed.data)",
  "  res.status(201).json(user)",
  "})",
];

// simple-icons slugs rendered white into the Icon Cloud: the runtimes,
// languages, editors and providers DJL drives.
export const iconSlugs = [
  "typescript",
  "javascript",
  "python",
  "rust",
  "go",
  "react",
  "nextdotjs",
  "nodedotjs",
  "docker",
  "git",
  "github",
  "githubcopilot",
  "ollama",
  "huggingface",
  "pytorch",
  "postgresql",
  "redis",
  "linux",
  "apple",
  "neovim",
];

export const iconImages = iconSlugs.map((s) => `https://cdn.simpleicons.org/${s}/0b1118`);

// The curated local models DJL offers, mirrored by hand from
// apps/server/src/localModels/catalog.ts. This app builds standalone and is mirrored to its own
// deployment repository, so it cannot import from the server workspace; update both together.
//
// `agent: false` is `supportsToolCalls: false` there. Such a model chats but cannot drive tools,
// and handing it tool definitions stalls silently rather than erroring — which is the one thing a
// visitor must not have to discover by watching the agent hang.
export const localModelCatalog = [
  { id: "qwen3-1.7b", name: "Qwen3 1.7B", minMemoryGb: 4, downloadGb: 1.4, agent: false },
  { id: "qwen3.5-2b", name: "Qwen3.5 2B", minMemoryGb: 8, downloadGb: 1.9, agent: false },
  { id: "granite-4.1-3b", name: "Granite 4.1 3B", minMemoryGb: 8, downloadGb: 2.1, agent: true },
  {
    id: "qwen2.5-coder-7b",
    name: "Qwen2.5 Coder 7B",
    minMemoryGb: 16,
    downloadGb: 4.36,
    agent: true,
  },
  { id: "gpt-oss-20b", name: "GPT-OSS 20B", minMemoryGb: 16, downloadGb: 13, agent: true },
  { id: "qwen3-coder-30b", name: "Qwen3 Coder 30B", minMemoryGb: 32, downloadGb: 19, agent: true },
] as const;

export type LocalModelRow = (typeof localModelCatalog)[number];

// Weights are fractional gibibytes; a fixed decimal count would print "13.00 GB", which reads as
// precision the catalog does not claim.
export function formatGb(value: number): string {
  return `${Number(value.toFixed(2))} GB`;
}

export const content = {
  en: {
    htmlLang: "en",
    dir: "Bilingual agent command center",
    nav: [
      { id: "routing", label: "Routing" },
      { id: "workflow", label: "Workflow" },
      { id: "bilingual", label: "Bilingual" },
      { id: "stack", label: "Stack" },
      { id: "pipeline", label: "Pipeline" },
    ],
    getStarted: "Open workspace",
    enterHint: "press any key to enter",
    skip: "skip intro",
    boot: {
      brand: "DJL",
      label: "LOCAL RUNTIME",
      lines: [
        { text: "initializing DJL kernel" },
        { text: "mounting local runtime", ok: true },
        { text: "model: deepseek-v4-flash", ok: true },
        { text: "tools: 14 registered", ok: true },
        { text: "workspace: scoped and private", ok: true },
        { text: "online bridge: standby" },
        { text: "calibrating intent router" },
      ] as BootLine[],
      ready: "AGENT AWAKE",
    },
    hero: {
      status: "LOCAL / ONLINE READY",
      coord: "EN / 中文",
      kicker: "An intelligence that runs where you are",
      titleLines: ["Agent wakes", "on your machine."],
      body: "Run a bilingual coding agent locally, route tasks online when needed, and approve every file change before it lands.",
      primary: "Open workspace",
      secondary: "Read the docs",
      stats: [
        { k: "Local-first", v: "private by default" },
        { k: "14 tools", v: "registered & sandboxed" },
        { k: "EN / 中文", v: "one shared context" },
        { k: "Review-gated", v: "every change" },
      ],
      hud: {
        model: "MODEL",
        modelValue: "DJL-CORE",
        state: "STATE",
        stateValue: "AWAKE",
      },
    },
    field: {
      depthLabel: "DEPTH",
      descend: "descend the stack",
      strata: ["SURFACE", "ROUTER", "WORKFLOW", "BILINGUAL", "STACK", "PIPELINE", "KERNEL"],
      glyphs: [
        "› route → local",
        "tool · read_file ✓",
        "kernel · deepseek-v4-flash",
        "intent classified",
        "diff · awaiting review",
        "sandbox · scoped",
        "中文 ↔ EN",
        "运行测试 ✓",
      ],
    },
    console: {
      tag: "LIVE SESSION",
      task: "Build a user endpoint with validation and tests",
      state: "in progress",
      tabs: [
        { id: "plan" as ConsoleTab, label: "Plan" },
        { id: "tools" as ConsoleTab, label: "Tools" },
        { id: "review" as ConsoleTab, label: "Review" },
      ],
      timeline: [
        ["Plan", "create steps"],
        ["Tools", "run selected tools"],
        ["Read", "src/routes/users.ts"],
        ["Edit", "src/routes/users.ts"],
        ["Test", "npm test"],
        ["Review", "awaiting your approval"],
      ],
      file: "src/routes/users.ts",
      terminal: { cmd: "npm test", pass: "PASS", file: "tests/users.test.ts" },
      tests: ["creates a user (23 ms)", "validates email (18 ms)"],
      testSummary: "2 passed · 541 ms",
      review: {
        title: "Review change",
        action: "Edit file",
        summaryLabel: "Summary",
        summary: "Added POST /users with validation and tests.",
        impactLabel: "Impact",
        impact: ["adds new route", "adds input validation", "adds tests"],
        filesLabel: "Files",
        files: ["src/routes/users.ts", "tests/users.test.ts"],
        approve: "Approve & apply",
        request: "Request changes",
        cancel: "Cancel / rollback",
      },
    },
    routing: {
      index: "01",
      tag: "Routing",
      title: "Choose where every task runs",
      body: "Route work to local or online runtimes by sensitivity and speed. Your code and data stay scoped exactly where you put them.",
      workspace: "Your workspace",
      router: "DJL router",
      local: "Local",
      online: "Online",
      localBody: "Private by default. Nothing leaves the device.",
      onlineBody: "Best for reach. Secure connections only.",
      items: [
        { k: "Files", v: "scoped to project" },
        { k: "Environment", v: "isolated" },
        { k: "Secrets", v: "never sent" },
      ],
      steps: ["classify task", "select runtime", "run tools"],
    },
    workflow: {
      index: "02",
      tag: "Workflow",
      title: "A workflow you can inspect",
      body: "DJL breaks work into clear steps. See the plan, watch each tool run, and review every change before it is applied.",
      steps: [
        {
          k: "Plan",
          v: "Work is decomposed into ordered, legible steps you can read before anything runs.",
        },
        {
          k: "Tools",
          v: "Each tool executes in a sandbox, streaming its output so nothing happens off-screen.",
        },
        {
          k: "Review",
          v: "Every diff waits for your approval. Apply, request changes, or roll back.",
        },
      ],
    },
    bilingual: {
      index: "03",
      tag: "Bilingual",
      title: "English and 中文, in one context",
      body: "DJL keeps both languages in view. Speak or type either one; the agent holds a single shared understanding of the task.",
      en: [
        "Create a new user endpoint with validation and tests.",
        "Add input validation using Zod.",
        "Write tests for success and failure cases.",
      ],
      zh: [
        "创建一个带有校验和测试的用户接口。",
        "使用 Zod 添加输入校验。",
        "为成功和失败场景编写测试。",
      ],
    },
    stack: {
      index: "04",
      tag: "Stack",
      title: "Plugs into your stack",
      body: "DJL drives the tools you already run: language toolchains, runtimes, editors, and model providers, local or online.",
      caption: "Drag to rotate / hover to steer",
    },
    pipeline: {
      index: "05",
      tag: "Pipeline",
      title: "From prototype to production",
      body: "Keep one flow from first experiment to shipped change. DJL plugs into the tools you already run.",
      steps: [
        { k: "Prototype", v: "explore & build" },
        { k: "Integrate", v: "use your tools" },
        { k: "Review", v: "approve with confidence" },
        { k: "Ship", v: "merge & deploy" },
      ],
    },
    cta: {
      tag: "READY",
      title: "Wake DJL",
      body: "Open your workspace and put an agent to work on your machine, in your language.",
      primary: "Open workspace",
      secondary: "Read the docs",
    },
    footer: {
      brand: "DJL",
      tag: "local-first agent command center",
      status: "STANDBY",
      cols: [
        { h: "Product", links: ["Routing", "Workflow", "Bilingual", "Pipeline"] },
        { h: "Resources", links: ["Docs", "Changelog", "Privacy", "Status"] },
      ],
      note: "Runs where you are.",
    },
    start: {
      tag: "GET STARTED",
      title: "Three steps to a private agent",
      body: "Install DJL, give it a model that runs on your own hardware, and keep approval over every change.",
      steps: [
        { k: "Install DJL", v: "One download for macOS or Windows." },
        { k: "Add a local model", v: "DJL detects your hardware and installs the runtime for you." },
        { k: "Describe a task", v: "Read the plan, watch the tools, approve the diff." },
      ],
      cta: "Read the guide",
    },
    guide: {
      eyebrow: "Guide",
      title: "Put DJL to work",
      lede: "Two things worth knowing: how the agent runs a task, and how to give it a model that runs on your own machine.",
      home: "Home",
      toc: "On this page",
      sections: { use: "Using the agent", local: "Installing a local model" },
      use: {
        index: "01",
        tag: "Using the agent",
        title: "Describe the task, then stay in control",
        body: "DJL turns a request into ordered steps, runs each tool in the open, and stops for your approval before anything touches your files.",
        steps: [
          {
            k: "Describe the task",
            v: "Write what you want in English or 中文. Both languages share one context, so you can switch mid-task without repeating yourself.",
          },
          {
            k: "Read the plan",
            v: "Work is decomposed into ordered, legible steps you can read before anything runs.",
          },
          {
            k: "Watch the tools",
            v: "Each tool executes in a sandbox, streaming its output so nothing happens off-screen.",
          },
          {
            k: "Review the diff",
            v: "Every change waits for you: approve and apply, request changes, or cancel and roll back.",
          },
        ],
        note: "Nothing reaches your project until you approve it.",
      },
      local: {
        index: "02",
        tag: "Installing a local model",
        title: "Run a model on your own hardware",
        body: "DJL works out what your computer can run, then installs and starts the runtime itself. No terminal, no admin password.",
        desktopOnly: "Local model management lives in the DJL desktop app.",
        steps: [
          { k: "Open the desktop app", v: "Download DJL for your platform and launch it." },
          {
            k: "Go to Settings → Local Models",
            v: "Listed under Private inference.",
          },
          {
            k: "Check what DJL detected",
            v: "It reports your processor, graphics card, and memory, then recommends the largest model that will still feel fast — deliberately one tier below what your machine could merely hold.",
          },
          {
            k: "Install and start a runtime",
            v: "Choose Ollama or LM Studio. DJL downloads it, starts the local server, and connects to it.",
          },
          {
            k: "Select the model",
            v: "Once installed, pick it in the model picker and describe your first task.",
          },
        ],
        runtimeTitle: "Two runtimes",
        runtimes: [
          {
            k: "Ollama",
            v: "DJL installs, starts, and connects Ollama for you. No terminal or admin password needed.",
          },
          {
            k: "LM Studio",
            v: "Install LM Studio once, then DJL can start and manage its local server.",
          },
        ],
        table: {
          title: "Curated models",
          caption: "DJL recommends one of these from your hardware. You can always choose another.",
          model: "Model",
          memory: "Memory",
          download: "Download",
          drives: "Drives the agent",
          yes: "Yes",
          no: "Chat only",
        },
        warning: {
          title: "“Chat only” means chat only",
          body: "Qwen3 1.7B and Qwen3.5 2B answer questions well but are too small to hold a tool-calling loop together. Give either one a task that needs file edits and it stalls silently instead of reporting an error. For real work pick a model marked “Drives the agent” — Granite 4.1 3B is the smallest that qualifies, and it runs in 8 GB.",
        },
        context: {
          title: "If the tools stop working",
          body: "A capable model still needs enough context loaded to use tools. When DJL says the model is chat-only at its current context, reload it with a larger context window and the tools come back.",
        },
        custom: {
          title: "Bringing your own model",
          body: "The curated list is a starting point, not a limit. Install any Ollama tag, LM Studio catalog ID, or exact Hugging Face model URL.",
        },
        privacy: {
          title: "What stays on your machine",
          body: "Inference runs locally: prompts, code context, and output are never sent to a hosted model provider. DJL connects only to fixed loopback addresses (127.0.0.1) and never exposes either runtime to your network. Tools you approve can still reach the network on their own.",
        },
      },
      cta: {
        title: "Ready when you are",
        body: "Download DJL and give it a model that runs where you are.",
        download: "Download for macOS",
      },
    },
  },

  zh: {
    htmlLang: "zh-CN",
    dir: "双语智能体命令中心",
    nav: [
      { id: "routing", label: "路由" },
      { id: "workflow", label: "流程" },
      { id: "bilingual", label: "双语" },
      { id: "stack", label: "生态" },
      { id: "pipeline", label: "流水线" },
    ],
    getStarted: "打开工作区",
    enterHint: "按任意键进入",
    skip: "跳过开场",
    boot: {
      brand: "DJL",
      label: "本地运行时",
      lines: [
        { text: "正在初始化 DJL 内核" },
        { text: "挂载本地运行时", ok: true },
        { text: "模型: deepseek-v4-flash", ok: true },
        { text: "工具: 已注册 14 个", ok: true },
        { text: "工作区: 已隔离且私密", ok: true },
        { text: "在线通道: 待命" },
        { text: "校准意图路由器" },
      ] as BootLine[],
      ready: "智能体已唤醒",
    },
    hero: {
      status: "本地 / 在线就绪",
      coord: "EN / 中文",
      kicker: "在你所在之处运行的智能",
      titleLines: ["在你的设备上", "唤醒智能体。"],
      body: "DJL 是面向构建者的双语命令中心。在本地与在线运行时之间路由每个任务，观察每个工具运行，并在变更落地前逐一批准。",
      primary: "打开工作区",
      secondary: "阅读文档",
      stats: [
        { k: "本地优先", v: "默认私密" },
        { k: "14 个工具", v: "已注册 · 已隔离" },
        { k: "EN / 中文", v: "同一上下文" },
        { k: "审查门控", v: "每一次变更" },
      ],
      hud: {
        model: "模型",
        modelValue: "DJL-CORE",
        state: "状态",
        stateValue: "已唤醒",
      },
    },
    field: {
      depthLabel: "深度",
      descend: "向下进入运行栈",
      strata: ["界面", "路由", "流程", "双语", "生态", "流水线", "内核"],
      glyphs: [
        "› 路由 → 本地",
        "工具 · read_file ✓",
        "内核 · deepseek-v4-flash",
        "意图已分类",
        "变更 · 等待审查",
        "沙箱 · 已隔离",
        "EN ↔ 中文",
        "run tests ✓",
      ],
    },
    console: {
      tag: "实时会话",
      task: "构建带校验和测试的用户接口",
      state: "进行中",
      tabs: [
        { id: "plan" as ConsoleTab, label: "计划" },
        { id: "tools" as ConsoleTab, label: "工具" },
        { id: "review" as ConsoleTab, label: "审查" },
      ],
      timeline: [
        ["计划", "创建步骤"],
        ["工具", "运行已选工具"],
        ["读取", "src/routes/users.ts"],
        ["编辑", "src/routes/users.ts"],
        ["测试", "npm test"],
        ["审查", "等待你的批准"],
      ],
      file: "src/routes/users.ts",
      terminal: { cmd: "npm test", pass: "PASS", file: "tests/users.test.ts" },
      tests: ["创建用户 (23 ms)", "校验邮箱 (18 ms)"],
      testSummary: "2 项通过 · 541 ms",
      review: {
        title: "审查变更",
        action: "编辑文件",
        summaryLabel: "摘要",
        summary: "新增 POST /users 接口，并包含校验与测试。",
        impactLabel: "影响",
        impact: ["新增路由", "新增输入校验", "新增测试"],
        filesLabel: "文件",
        files: ["src/routes/users.ts", "tests/users.test.ts"],
        approve: "批准并应用",
        request: "请求修改",
        cancel: "取消 / 回滚",
      },
    },
    routing: {
      index: "01",
      tag: "路由",
      title: "为每个任务选择运行位置",
      body: "根据敏感度与速度，把任务路由到本地或在线运行时。代码与数据始终留在你设定的边界内。",
      workspace: "你的工作区",
      router: "DJL 路由器",
      local: "本地",
      online: "在线",
      localBody: "默认私密。数据不会离开设备。",
      onlineBody: "适合扩展。仅使用安全连接。",
      items: [
        { k: "文件", v: "限定于项目" },
        { k: "环境", v: "已隔离" },
        { k: "密钥", v: "从不外发" },
      ],
      steps: ["分类任务", "选择运行时", "运行工具"],
    },
    workflow: {
      index: "02",
      tag: "流程",
      title: "可被检查的工作流程",
      body: "DJL 把工作拆成清晰步骤。查看计划、观察每个工具运行，并在应用前审查每个变更。",
      steps: [
        { k: "计划", v: "工作被拆解为有序、可读的步骤，运行前你就能看清。" },
        { k: "工具", v: "每个工具在沙箱中执行并实时输出，没有任何动作发生在视线之外。" },
        { k: "审查", v: "每个差异都等待你的批准：应用、请求修改，或回滚。" },
      ],
    },
    bilingual: {
      index: "03",
      tag: "双语",
      title: "English 与中文，同一上下文",
      body: "DJL 让两种语言同时在场。用任意一种说或写，智能体始终保持对任务的同一份理解。",
      en: [
        "Create a new user endpoint with validation and tests.",
        "Add input validation using Zod.",
        "Write tests for success and failure cases.",
      ],
      zh: [
        "创建一个带有校验和测试的用户接口。",
        "使用 Zod 添加输入校验。",
        "为成功和失败场景编写测试。",
      ],
    },
    stack: {
      index: "04",
      tag: "生态",
      title: "接入你的技术栈",
      body: "DJL 驱动你已经在用的工具：语言工具链、运行时、编辑器与模型提供方，本地或在线。",
      caption: "拖动旋转 / 悬停转向",
    },
    pipeline: {
      index: "05",
      tag: "流水线",
      title: "从原型到生产",
      body: "从第一次实验到上线变更，保持同一套流程。DJL 接入你已经在用的工具。",
      steps: [
        { k: "原型", v: "探索并构建" },
        { k: "集成", v: "使用你的工具" },
        { k: "审查", v: "放心批准" },
        { k: "上线", v: "合并并部署" },
      ],
    },
    cta: {
      tag: "就绪",
      title: "唤醒 DJL",
      body: "打开工作区，让智能体在你的设备上用你的语言开始工作。",
      primary: "打开工作区",
      secondary: "阅读文档",
    },
    footer: {
      brand: "DJL",
      tag: "本地优先的智能体命令中心",
      status: "待命",
      cols: [
        { h: "产品", links: ["路由", "流程", "双语", "流水线"] },
        { h: "资源", links: ["文档", "更新日志", "隐私", "状态"] },
      ],
      note: "在你所在之处运行。",
    },
    start: {
      tag: "开始使用",
      title: "三步拥有私有智能体",
      body: "安装 DJL，为它配置一个在你自己硬件上运行的模型，并对每一次改动保留批准权。",
      steps: [
        { k: "安装 DJL", v: "macOS 与 Windows 各一个安装包。" },
        { k: "添加本地模型", v: "DJL 会检测你的硬件并自动安装运行时。" },
        { k: "描述任务", v: "阅读计划、观察工具、批准差异。" },
      ],
      cta: "阅读指南",
    },
    guide: {
      eyebrow: "指南",
      title: "让 DJL 开始工作",
      lede: "两件值得了解的事：智能体如何执行一项任务，以及如何为它配置一个在你自己设备上运行的模型。",
      home: "首页",
      toc: "本页内容",
      sections: { use: "使用智能体", local: "安装本地模型" },
      use: {
        index: "01",
        tag: "使用智能体",
        title: "描述任务，并始终掌控",
        body: "DJL 会把请求拆解为有序步骤，公开运行每个工具，并在改动触及你的文件之前停下来等待批准。",
        steps: [
          {
            k: "描述任务",
            v: "用中文或英文写下你的需求。两种语言共享同一上下文，因此可以中途切换而无需重述。",
          },
          {
            k: "阅读计划",
            v: "工作会被拆解为有序、清晰的步骤，在任何操作运行之前供你阅读。",
          },
          {
            k: "观察工具",
            v: "每个工具都在沙箱中执行，并实时输出，任何事都不会在你看不到的地方发生。",
          },
          {
            k: "审查差异",
            v: "每一处改动都会等你决定：批准并应用、要求修改，或取消并回滚。",
          },
        ],
        note: "在你批准之前，任何内容都不会写入你的项目。",
      },
      local: {
        index: "02",
        tag: "安装本地模型",
        title: "在你自己的硬件上运行模型",
        body: "DJL 会判断你的电脑能够运行什么，然后自行安装并启动运行时。无需终端，也无需管理员密码。",
        desktopOnly: "本地模型管理位于 DJL 桌面应用中。",
        steps: [
          { k: "打开桌面应用", v: "下载对应平台的 DJL 并启动。" },
          { k: "进入设置 → 本地模型", v: "位于「私有推理」分组下。" },
          {
            k: "查看 DJL 的检测结果",
            v: "它会报告你的处理器、显卡与内存，并推荐仍能保持流畅的最大模型——有意比你的机器勉强装得下的规格低一档。",
          },
          {
            k: "安装并启动运行时",
            v: "选择 Ollama 或 LM Studio。DJL 会完成下载、启动本地服务并建立连接。",
          },
          {
            k: "选择模型",
            v: "安装完成后，在模型选择器中选中它，然后描述你的第一个任务。",
          },
        ],
        runtimeTitle: "两种运行时",
        runtimes: [
          {
            k: "Ollama",
            v: "DJL 会为你安装、启动并连接 Ollama。无需终端或管理员密码。",
          },
          {
            k: "LM Studio",
            v: "只需安装一次 LM Studio，之后 DJL 即可启动并管理它的本地服务。",
          },
        ],
        table: {
          title: "精选模型",
          caption: "DJL 会依据你的硬件推荐其中之一，你也随时可以另选。",
          model: "模型",
          memory: "内存",
          download: "下载体积",
          drives: "可驱动智能体",
          yes: "可以",
          no: "仅对话",
        },
        warning: {
          title: "「仅对话」就是只能对话",
          body: "Qwen3 1.7B 与 Qwen3.5 2B 回答问题不错，但太小，无法完整维持一轮工具调用循环。若交给它们需要修改文件的任务，它们会静默停滞而不会报错。要做实际工作，请选择标记为「可驱动智能体」的模型——Granite 4.1 3B 是其中最小的一个，8 GB 内存即可运行。",
        },
        context: {
          title: "如果工具失效了",
          body: "即使模型本身够强，也需要加载足够的上下文才能使用工具。当 DJL 提示当前上下文下仅能对话时，请以更大的上下文窗口重新加载该模型，工具便会恢复。",
        },
        custom: {
          title: "使用你自己的模型",
          body: "精选列表只是起点，而非限制。你可以安装任意 Ollama 标签、LM Studio 目录 ID，或精确的 Hugging Face 模型链接。",
        },
        privacy: {
          title: "哪些内容留在你的设备上",
          body: "推理在本地进行：提示词、代码上下文与输出都不会发送给托管的模型服务商。DJL 只连接固定的本地回环地址（127.0.0.1），绝不会把任一运行时暴露到你的网络中。你批准的工具仍可自行访问网络。",
        },
      },
      cta: {
        title: "随时可以开始",
        body: "下载 DJL，为它配置一个在你所在之处运行的模型。",
        download: "下载 macOS 版",
      },
    },
  },
} as const;

export type Content = (typeof content)[Locale];
