"use client";

import Image from "next/image";
import {
  Blocks,
  Box,
  BriefcaseBusiness,
  Cloud,
  Eye,
  KeyRound,
  Languages,
  PackageCheck,
  PlayCircle,
  Rocket,
  Route,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import type { Content } from "./content";
import "./context-rail-story.css";

type ChapterId = "routing" | "workflow" | "bilingual" | "stack" | "pipeline";

type Chapter = {
  id: ChapterId;
  label: string;
  summary: string;
  icon: LucideIcon;
};

type OrbitNode = {
  id: "local" | "secret" | "online" | "bilingual" | "tools" | "production";
  label: string;
  detail: string;
  status: string;
  icon: LucideIcon;
  x: number;
  y: number;
  activeOn: number[];
};

type StoryCopy = {
  eyebrow: string;
  title: [string, string];
  body: string;
  chapterLabel: string;
  chapters: Chapter[];
  taskObject: string;
  inspect: string;
  hide: string;
  taskId: string;
  type: string;
  typeValue: string;
  target: string;
  targetValue: string;
  language: string;
  languageValue: string;
  created: string;
  progress: string;
  viewObject: string;
  packet: string;
  running: string;
  eventLog: string;
  live: string;
  contextComplete: string;
  currentLabels: string[];
  logEntries: [string, string][];
  nodes: OrbitNode[];
};

const chapterIcons: LucideIcon[] = [Route, Workflow, Languages, Blocks, PackageCheck];

const packetPositions = [
  { x: 82, y: 22 },
  { x: 86.6, y: 27 },
  { x: 77, y: 68 },
  { x: 52, y: 88 },
  { x: 19, y: 76 },
];

const logIcons: LucideIcon[] = [Box, Route, PlayCircle, BriefcaseBusiness, Languages, ShieldCheck];

function getCopy(t: Content): StoryCopy {
  const isZh = t.htmlLang === "zh-CN";
  const chapters = t.nav.map((item, index) => ({
    id: item.id as ChapterId,
    label: item.label,
    summary: isZh
      ? [
          "先确定任务在哪里运行",
          "执行过程逐步展开",
          "上下文在移动，任务保持不变",
          "工具接入同一份上下文",
          "交付与生产",
        ][index]
      : [
          "Choose the execution boundary",
          "Watch execution unfold",
          "Keep one shared understanding",
          "Connect the tools you already use",
          "Validate and ship",
        ][index],
    icon: chapterIcons[index],
  }));

  const nodes: OrbitNode[] = isZh
    ? [
        {
          id: "local",
          label: "本地",
          detail: "本地优先",
          status: "策略就绪",
          icon: Box,
          x: 45,
          y: 6,
          activeOn: [0, 1],
        },
        {
          id: "secret",
          label: "密钥",
          detail: "策略就绪",
          status: "已校验",
          icon: KeyRound,
          x: 6,
          y: 33,
          activeOn: [0],
        },
        {
          id: "online",
          label: "在线",
          detail: "安全边界内",
          status: "策略就绪",
          icon: Cloud,
          x: 94,
          y: 43,
          activeOn: [0, 1],
        },
        {
          id: "bilingual",
          label: "双语处理",
          detail: "上下文一致",
          status: "中英双语保持",
          icon: Languages,
          x: 76,
          y: 75,
          activeOn: [2],
        },
        {
          id: "tools",
          label: "工具生态",
          detail: "工具已接入",
          status: "可调用",
          icon: BriefcaseBusiness,
          x: 50,
          y: 94,
          activeOn: [1, 3],
        },
        {
          id: "production",
          label: "生产环境",
          detail: "流水线就绪",
          status: "待命",
          icon: Rocket,
          x: 19,
          y: 82,
          activeOn: [4],
        },
      ]
    : [
        {
          id: "local",
          label: "Local",
          detail: "Local first",
          status: "Policy ready",
          icon: Box,
          x: 45,
          y: 6,
          activeOn: [0, 1],
        },
        {
          id: "secret",
          label: "Secrets",
          detail: "Policy ready",
          status: "Verified",
          icon: KeyRound,
          x: 6,
          y: 33,
          activeOn: [0],
        },
        {
          id: "online",
          label: "Online",
          detail: "Inside boundary",
          status: "Policy ready",
          icon: Cloud,
          x: 94,
          y: 43,
          activeOn: [0, 1],
        },
        {
          id: "bilingual",
          label: "Bilingual",
          detail: "Context aligned",
          status: "EN / ZH retained",
          icon: Languages,
          x: 76,
          y: 75,
          activeOn: [2],
        },
        {
          id: "tools",
          label: "Tool stack",
          detail: "Tools connected",
          status: "Available",
          icon: BriefcaseBusiness,
          x: 50,
          y: 94,
          activeOn: [1, 3],
        },
        {
          id: "production",
          label: "Production",
          detail: "Pipeline ready",
          status: "Standby",
          icon: Rocket,
          x: 19,
          y: 82,
          activeOn: [4],
        },
      ];

  if (isZh) {
    return {
      eyebrow: "CONTEXT OBSERVATORY",
      title: ["同一上下文，", "任务保持完整"],
      body: "任务在路由、流程、双语、工具与生产之间流转，上下文始终完整，从不丢失。",
      chapterLabel: "上下文章节",
      chapters,
      taskObject: "任务对象",
      inspect: "INSPECT",
      hide: "收起",
      taskId: "任务 #A7F3C2",
      type: "类型",
      typeValue: "代码审查",
      target: "目标",
      targetValue: "生成评审报告",
      language: "语言",
      languageValue: "中英双语",
      created: "创建时间",
      progress: "上下文完整度",
      viewObject: "查看完整对象",
      packet: "任务包",
      running: "正在执行",
      eventLog: "实时事件日志",
      live: "LIVE",
      contextComplete: "上下文完整",
      currentLabels: [
        "路由策略匹配中",
        "流程执行中",
        "双语上下文对齐",
        "工具生态已接入",
        "生产校验中",
      ],
      logEntries: [
        ["10:22:18", "任务已创建"],
        ["10:22:19", "路由策略匹配完成"],
        ["10:22:21", "进入流程：参数校验"],
        ["10:22:23", "工具检查：代码检索"],
        ["10:22:26", "双语处理：中英对齐"],
        ["10:22:30", "上下文完整度 100%"],
      ],
      nodes,
    };
  }

  return {
    eyebrow: "CONTEXT OBSERVATORY",
    title: ["One context,", "the task stays whole"],
    body: "The task moves through routing, workflow, language, tools, and production without losing its shared context.",
    chapterLabel: "Context chapters",
    chapters,
    taskObject: "TASK OBJECT",
    inspect: "INSPECT",
    hide: "HIDE",
    taskId: "Task #A7F3C2",
    type: "Type",
    typeValue: "Code review",
    target: "Target",
    targetValue: "Generate review report",
    language: "Language",
    languageValue: "EN / ZH",
    created: "Created",
    progress: "Context completeness",
    viewObject: "View complete object",
    packet: "TASK PACKET",
    running: "Running",
    eventLog: "LIVE EVENT LOG",
    live: "LIVE",
    contextComplete: "CONTEXT COMPLETE",
    currentLabels: [
      "Matching route policy",
      "Workflow in progress",
      "Aligning bilingual context",
      "Tool stack connected",
      "Production validation",
    ],
    logEntries: [
      ["10:22:18", "Task created"],
      ["10:22:19", "Routing policy matched"],
      ["10:22:21", "Workflow: parameters checked"],
      ["10:22:23", "Tool check: code search"],
      ["10:22:26", "Bilingual context aligned"],
      ["10:22:30", "Context completeness 100%"],
    ],
    nodes,
  };
}

export function ContextRailStory({ t }: { t: Content }) {
  const rootRef = useRef<HTMLElement>(null);
  const [activeChapter, setActiveChapter] = useState(0);
  const [inspectedNode, setInspectedNode] = useState<string | null>(null);
  const [objectOpen, setObjectOpen] = useState(false);
  const copy = useMemo(() => getCopy(t), [t]);

  const updateFromScroll = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const travel = Math.max(1, rect.height - window.innerHeight);
    const progress = Math.min(1, Math.max(0, -rect.top / travel));
    root.style.setProperty("--co-progress", progress.toFixed(4));
    root.style.setProperty("--co-orbit-rotate", `${(progress * 18 - 5).toFixed(2)}deg`);
    setActiveChapter(Math.min(4, Math.max(0, Math.round(progress * 4))));
  }, []);

  useEffect(() => {
    let frame = 0;
    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        updateFromScroll();
        frame = 0;
      });
    };
    requestUpdate();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, [updateFromScroll]);

  useEffect(() => {
    const ids = copy.chapters.map((chapter) => chapter.id);
    const hash = window.location.hash.slice(1);
    const index = ids.indexOf(hash as ChapterId);
    const isLaunchGate = hash === "start";
    if (index < 0 && !isLaunchGate) return;

    const restoreHash = () => {
      const target = document.getElementById(hash);
      if (!target) return;
      setActiveChapter(index >= 0 ? index : ids.length - 1);
      window.setTimeout(() => {
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY });
      }, 80);
    };

    if (isLaunchGate) {
      const launchRestore = window.setTimeout(restoreHash, 120);
      return () => window.clearTimeout(launchRestore);
    }

    if ((window as unknown as { __djlIntroDone?: boolean }).__djlIntroDone) {
      restoreHash();
      return;
    }

    window.addEventListener("djl:intro-done", restoreHash, { once: true });
    return () => window.removeEventListener("djl:intro-done", restoreHash);
  }, [copy.chapters]);

  const scrollToChapter = (
    event: MouseEvent<HTMLAnchorElement>,
    chapter: Chapter,
    index: number,
  ) => {
    const target = document.getElementById(chapter.id);
    if (!target) return;
    event.preventDefault();
    setActiveChapter(index);
    if (event.detail > 0) event.currentTarget.blur();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: target.getBoundingClientRect().top + window.scrollY,
      behavior: reduce ? "auto" : "smooth",
    });
    window.history.replaceState(null, "", `#${chapter.id}`);
  };

  const packet = packetPositions[activeChapter];
  const storyStyle = {
    "--packet-x": `${packet.x}%`,
    "--packet-y": `${packet.y}%`,
  } as CSSProperties;

  return (
    <section
      ref={rootRef}
      className="context-observatory"
      data-chapter={activeChapter}
      style={storyStyle}
      aria-label={t.htmlLang === "zh-CN" ? "DJL 上下文观测站" : "DJL context observatory"}
    >
      {copy.chapters.map((chapter, index) => (
        <span
          key={chapter.id}
          id={chapter.id}
          className="co-anchor"
          style={{ top: `${index * 20}%` }}
          aria-hidden="true"
        />
      ))}

      <div className="co-sticky">
        <div className="co-grid" aria-hidden="true" />

        <div className="co-frame">
          <nav className="co-chapters" aria-label={copy.chapterLabel}>
            {copy.chapters.map((chapter, index) => {
              const ChapterIcon = chapter.icon;
              const active = index === activeChapter;
              return (
                <a
                  key={chapter.id}
                  href={`#${chapter.id}`}
                  className={active ? "active" : ""}
                  aria-current={active ? "step" : undefined}
                  onClick={(event) => scrollToChapter(event, chapter, index)}
                >
                  <span className="co-chapter-number">{String(index + 1).padStart(2, "0")}</span>
                  <i aria-hidden="true" />
                  <span className="co-chapter-copy">
                    <ChapterIcon aria-hidden="true" />
                    <strong>{chapter.label}</strong>
                    <small>{chapter.summary}</small>
                  </span>
                </a>
              );
            })}
          </nav>

          <header className="co-intro">
            <span className="co-eyebrow">{copy.eyebrow}</span>
            <h2>
              {copy.title[0]}
              <br />
              {copy.title[1]}
            </h2>
            <p>{copy.body}</p>
          </header>

          <div
            className="co-orbit"
            aria-label={t.htmlLang === "zh-CN" ? "任务上下文轨道" : "Task context orbit"}
          >
            <Image
              className="co-orbit-graphic"
              src="/generated/djl-context-orbits.png"
              alt=""
              width={1254}
              height={1254}
              aria-hidden="true"
            />

            <div className="co-core">
              <Image
                src="/generated/djl-context-core.png"
                alt={t.htmlLang === "zh-CN" ? "DJL 上下文核心" : "DJL context core"}
                width={1254}
                height={1254}
              />
            </div>

            {copy.nodes.map((node) => {
              const NodeIcon = node.icon;
              const selected = node.activeOn.includes(activeChapter) || inspectedNode === node.id;
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`co-node co-node-${node.id}`}
                  data-selected={selected}
                  style={{ "--node-x": `${node.x}%`, "--node-y": `${node.y}%` } as CSSProperties}
                  aria-label={`${node.label}：${node.detail}，${node.status}`}
                  onPointerEnter={() => setInspectedNode(node.id)}
                  onPointerLeave={() => setInspectedNode(null)}
                  onFocus={() => setInspectedNode(node.id)}
                  onBlur={() => setInspectedNode(null)}
                >
                  <span className="co-node-disc">
                    <NodeIcon aria-hidden="true" />
                  </span>
                  <span className="co-node-copy">
                    <strong>{node.label}</strong>
                    <small>{node.detail}</small>
                    <em>
                      <i aria-hidden="true" />
                      {node.status}
                    </em>
                  </span>
                </button>
              );
            })}

            <span className="co-task-orb" aria-hidden="true" />
          </div>

          <aside className="co-packet-copy" aria-live="polite">
            <strong>{copy.packet}</strong>
            <span>{copy.taskId}</span>
            <small>
              <i aria-hidden="true" />
              {copy.running}
            </small>
          </aside>

          <aside className={`co-object-card ${objectOpen ? "open" : ""}`}>
            <header>
              <strong>{copy.taskObject}</strong>
              <button
                type="button"
                onClick={() => setObjectOpen((open) => !open)}
                aria-expanded={objectOpen}
              >
                {objectOpen ? copy.hide : copy.inspect}
                <Eye aria-hidden="true" />
              </button>
            </header>
            <h3>{copy.taskId}</h3>
            <dl>
              <div>
                <dt>{copy.type}</dt>
                <dd>{copy.typeValue}</dd>
              </div>
              <div>
                <dt>{copy.target}</dt>
                <dd>{copy.targetValue}</dd>
              </div>
              <div>
                <dt>{copy.language}</dt>
                <dd>{copy.languageValue}</dd>
              </div>
              <div>
                <dt>{copy.created}</dt>
                <dd>10:22:18</dd>
              </div>
              {objectOpen && (
                <div className="co-object-extra">
                  <dt>Scope</dt>
                  <dd>workspace / djl</dd>
                </div>
              )}
            </dl>
            <div className="co-object-progress">
              <span>{copy.progress}</span>
              <div aria-hidden="true">
                <i />
              </div>
              <strong>100%</strong>
            </div>
            <button
              type="button"
              className="co-object-action"
              onClick={() => setObjectOpen((open) => !open)}
            >
              {copy.viewObject}
              <span aria-hidden="true">›</span>
            </button>
          </aside>

          <aside className="co-event-log" aria-live="polite">
            <header>
              <strong>{copy.eventLog}</strong>
              <span>
                {copy.live}
                <i aria-hidden="true" />
              </span>
            </header>
            <ol>
              {copy.logEntries.map(([time, label], index) => {
                const LogIcon = logIcons[index];
                return (
                  <li
                    key={`${time}-${label}`}
                    className={index === activeChapter + 1 ? "active" : ""}
                  >
                    <LogIcon aria-hidden="true" />
                    <time>{time}</time>
                    <span>{label}</span>
                  </li>
                );
              })}
            </ol>
            <p>
              <i aria-hidden="true" />
              <time>10:22:32</time>
              {copy.currentLabels[activeChapter]}
            </p>
          </aside>

          <div className="co-integrity" aria-label={`${copy.contextComplete} 100%`}>
            <span aria-hidden="true" />
            <i className="co-integrity-bracket co-integrity-bracket-left" aria-hidden="true" />
            <strong>{copy.contextComplete}</strong>
            <b>100%</b>
            <i className="co-integrity-bracket co-integrity-bracket-right" aria-hidden="true" />
            <span aria-hidden="true" />
          </div>
        </div>

        <div className="co-mobile">
          <span>{copy.eyebrow}</span>
          <h2>
            {copy.title[0]}
            <br />
            {copy.title[1]}
          </h2>
          <div className="co-mobile-orbit">
            <Image src="/generated/djl-context-orbits.png" alt="" width={1254} height={1254} />
            <Image src="/generated/djl-context-core.png" alt="" width={1254} height={1254} />
            <i />
          </div>
          <div className="co-mobile-status">
            <strong>
              {String(activeChapter + 1).padStart(2, "0")} / 05 ·{" "}
              {copy.chapters[activeChapter].label}
            </strong>
            <small>{copy.currentLabels[activeChapter]}</small>
          </div>
          <nav aria-label={copy.chapterLabel}>
            {copy.chapters.map((chapter, index) => (
              <a
                key={chapter.id}
                href={`#${chapter.id}`}
                className={index === activeChapter ? "active" : ""}
                onClick={(event) => scrollToChapter(event, chapter, index)}
              >
                {String(index + 1).padStart(2, "0")}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </section>
  );
}
