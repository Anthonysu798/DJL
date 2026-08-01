"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Folder,
  Hand,
  Mic,
  Plus,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  SquareTerminal,
  Star,
} from "lucide-react";
import type { Content } from "./content";
import "./hero-app-demo.css";

// A playable miniature of the real DJL desktop window. The scripted run walks
// the product's actual loop: plan → tools → review gate → apply. Everything is
// local state; nothing leaves the page.

type Phase = "idle" | "planning" | "working" | "review" | "changes" | "done";
type AccessKey = "ask" | "auto" | "full";
type MenuKey = "access" | "model" | "effort";

const STAGE_BY_PHASE: Record<Phase, number> = {
  idle: -1,
  planning: 0,
  working: 1,
  review: 2,
  changes: 2,
  done: 3,
};

const ACCESS_ICONS = { ask: Hand, auto: SquareTerminal, full: CircleAlert } as const;

// Model names are product identifiers; they stay untranslated.
const MODEL_GROUPS: {
  name: string;
  items: { n: string; badge?: "assisted" | "chat" }[];
}[] = [
  {
    name: "DeepSeek",
    items: [{ n: "DeepSeek V4 Flash" }, { n: "DeepSeek V4 Pro" }],
  },
  {
    name: "LM Studio",
    items: [{ n: "qwen2.5-coder-7b" }, { n: "gpt-oss-20b" }],
  },
  {
    name: "Ollama",
    items: [
      { n: "djl-qwen:3b" },
      { n: "djl-qwen:7b", badge: "assisted" },
      { n: "qwen2.5:3b" },
      { n: "qwen2.5:7b" },
      { n: "llama3.2:1b", badge: "chat" },
      { n: "qwen2.5-coder:0.5b", badge: "chat" },
      { n: "Qwen3 1.7B", badge: "chat" },
    ],
  },
];

export function HeroAppDemo({ t }: { t: Content }) {
  const demo = t.landing.demo;
  const menus = demo.menus;
  const [phase, setPhase] = useState<Phase>("idle");
  const [prompt, setPrompt] = useState("");
  const [sentPrompt, setSentPrompt] = useState("");
  const [tasks, setTasks] = useState<string[]>([]);
  const [tab, setTab] = useState<"work" | "projects">("work");
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [access, setAccess] = useState<AccessKey>("full");
  const [model, setModel] = useState("DeepSeek V4 Flash");
  const [effortIndex, setEffortIndex] = useState(2);
  const [starred, setStarred] = useState<string[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(["LM Studio"]);
  const inputRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  // One menu open at a time; outside click or Escape closes it.
  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest(".had-menu-wrap")) setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  const schedule = (fn: () => void, delay: number) => {
    timers.current.push(window.setTimeout(fn, delay));
  };

  const send = () => {
    const text = prompt.trim();
    if (!text || phase === "planning" || phase === "working") return;
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setOpenMenu(null);
    setSentPrompt(text);
    setPrompt("");
    setPhase("planning");
    schedule(() => setPhase("working"), instant ? 150 : 1100);
    schedule(() => setPhase("review"), instant ? 300 : 2400);
  };

  const approve = () => {
    setPhase("done");
    setTasks((existing) => [sentPrompt, ...existing].slice(0, 4));
  };

  const requestChanges = () => {
    setPhase("changes");
    inputRef.current?.focus();
  };

  const reset = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
    setPhase("idle");
    setPrompt("");
    setSentPrompt("");
    inputRef.current?.focus();
  };

  const toggleMenu = (key: MenuKey) => setOpenMenu((open) => (open === key ? null : key));

  const toggleStar = (name: string) =>
    setStarred((list) =>
      list.includes(name) ? list.filter((item) => item !== name) : [...list, name],
    );

  const toggleGroup = (name: string) =>
    setCollapsedGroups((list) =>
      list.includes(name) ? list.filter((item) => item !== name) : [...list, name],
    );

  const running = phase !== "idle";
  const stage = STAGE_BY_PHASE[phase];
  const accessLabel =
    access === "ask" ? menus.ask : access === "auto" ? menus.auto : demo.fullAccess;
  const AccessIcon = ACCESS_ICONS[access];

  return (
    <div className="had" lang={t.htmlLang}>
      {/* sidebar */}
      <aside className="had-side" data-skel>
        <div className="had-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "work"}
            data-active={tab === "work" || undefined}
            onClick={() => setTab("work")}
          >
            {demo.tabs.work}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "projects"}
            data-active={tab === "projects" || undefined}
            onClick={() => setTab("projects")}
          >
            {demo.tabs.projects}
          </button>
        </div>

        <button type="button" className="had-side-row" onClick={reset}>
          <SquarePen size={13} aria-hidden="true" />
          {demo.newTask}
        </button>
        <div className="had-side-row" aria-disabled="true">
          <Sparkles size={13} aria-hidden="true" />
          {demo.writingCheck}
        </div>
        <div className="had-side-row" aria-disabled="true">
          <Search size={13} aria-hidden="true" />
          {demo.search}
        </div>

        <span className="had-side-label">
          {tab === "work" ? demo.workLabel : demo.tabs.projects}
        </span>
        {tab === "work" && tasks.length > 0 ? (
          <div className="had-task-list">
            {tasks.map((task) => (
              <span key={task} className="had-task">
                {task}
              </span>
            ))}
          </div>
        ) : (
          <span className="had-empty">{tab === "work" ? demo.noTasks : demo.noProjects}</span>
        )}

        <div className="had-side-bottom">
          <div className="had-side-row" aria-disabled="true">
            <Settings size={13} aria-hidden="true" />
            {demo.settings}
          </div>
        </div>
      </aside>

      {/* main */}
      <div className="had-main">
        <div className="had-top" data-skel>
          <span className="had-title">{demo.windowTitle}</span>
          <span className="had-handoff">{demo.handOff}</span>
        </div>

        {!running ? (
          <div className="had-idle">
            <h3 className="had-headline" data-skel>
              {demo.headline}
            </h3>
            <div className="had-suggestions" data-skel>
              {demo.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setPrompt(suggestion);
                    inputRef.current?.focus();
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="had-run">
            <div className="had-stages" aria-hidden="true">
              {demo.run.stages.map((label, index) => (
                <span key={label} className="had-stage" data-state={index <= stage ? "on" : "off"}>
                  {label}
                </span>
              ))}
            </div>

            <div className="had-thread">
              <span className="had-bubble">{sentPrompt}</span>

              {phase === "planning" && <p className="had-line had-dim">{demo.run.planning}</p>}

              {(phase === "working" || phase === "review" || phase === "changes" || phase === "done") && (
                <>
                  {demo.run.planLines.map((line) => (
                    <p key={line} className="had-line">
                      {line}
                    </p>
                  ))}
                  <p className="had-line had-mono">
                    {demo.run.toolLine}
                    <span>{demo.run.toolOutput}</span>
                  </p>
                </>
              )}

              {(phase === "review" || phase === "changes") && (
                <div className="had-review">
                  <p>
                    {demo.run.ready} <span className="had-mono-inline">{demo.run.diff}</span>
                  </p>
                  <div className="had-review-actions">
                    <button type="button" className="had-btn-ghost" onClick={requestChanges}>
                      {demo.run.requestChanges}
                    </button>
                    <button type="button" className="had-btn-solid" onClick={approve}>
                      {demo.run.approve}
                    </button>
                  </div>
                  {phase === "changes" && <p className="had-line had-dim">{demo.run.changesPrompt}</p>}
                </div>
              )}

              {phase === "done" && <p className="had-line had-done">{demo.run.applied}</p>}
            </div>
          </div>
        )}

        <div className="had-composer-wrap" data-skel>
          <div className="had-composer">
            <input
              ref={inputRef}
              type="text"
              value={prompt}
              placeholder={demo.placeholder}
              aria-label={demo.placeholder}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") send();
              }}
            />
            <div className="had-composer-row">
              <Plus size={14} aria-hidden="true" className="had-icon" />

              {/* access dropdown */}
              <span className="had-menu-wrap">
                <button
                  type="button"
                  className="had-access"
                  data-kind={access}
                  aria-haspopup="menu"
                  aria-expanded={openMenu === "access"}
                  onClick={() => toggleMenu("access")}
                >
                  <AccessIcon size={11} aria-hidden="true" />
                  {accessLabel}
                  <ChevronDown size={10} aria-hidden="true" />
                </button>
                {openMenu === "access" && (
                  <div className="had-menu had-menu--access" role="menu">
                    <p className="had-menu-title">{menus.accessTitle}</p>
                    {(
                      [
                        { key: "ask" as const, label: menus.ask, desc: menus.askDesc },
                        { key: "auto" as const, label: menus.auto, desc: menus.autoDesc },
                        { key: "full" as const, label: demo.fullAccess, desc: menus.fullDesc },
                      ]
                    ).map((option) => {
                      const Icon = ACCESS_ICONS[option.key];
                      return (
                        <button
                          key={option.key}
                          type="button"
                          role="menuitemradio"
                          aria-checked={access === option.key}
                          className="had-menu-item"
                          data-kind={option.key}
                          onClick={() => {
                            setAccess(option.key);
                            setOpenMenu(null);
                          }}
                        >
                          <Icon size={14} aria-hidden="true" className="had-mi-icon" />
                          <span className="had-mi-body">
                            <span className="had-mi-label">{option.label}</span>
                            <p>{option.desc}</p>
                          </span>
                          {access === option.key && (
                            <Check size={13} aria-hidden="true" className="had-mi-check" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </span>

              {/* model dropdown */}
              <span className="had-menu-wrap had-menu-wrap--model">
                <button
                  type="button"
                  className="had-model"
                  aria-haspopup="menu"
                  aria-expanded={openMenu === "model"}
                  onClick={() => toggleMenu("model")}
                >
                  {model}
                  <ChevronDown size={10} aria-hidden="true" />
                </button>
                {openMenu === "model" && (
                  <div className="had-menu had-menu--model" role="menu">
                    {MODEL_GROUPS.map((group) => {
                      const isCollapsed = collapsedGroups.includes(group.name);
                      return (
                        <div key={group.name}>
                          <button
                            type="button"
                            className="had-group"
                            aria-expanded={!isCollapsed}
                            onClick={() => toggleGroup(group.name)}
                          >
                            {isCollapsed ? (
                              <ChevronRight size={12} aria-hidden="true" />
                            ) : (
                              <ChevronDown size={12} aria-hidden="true" />
                            )}
                            {group.name}
                            <span className="had-group-count">{group.items.length}</span>
                          </button>
                          {!isCollapsed &&
                            group.items.map((item) => (
                              <button
                                key={item.n}
                                type="button"
                                role="menuitemradio"
                                aria-checked={model === item.n}
                                className="had-model-item"
                                onClick={() => {
                                  setModel(item.n);
                                  setOpenMenu(null);
                                }}
                              >
                                <span className="had-model-name">{item.n}</span>
                                {item.badge && (
                                  <span className="had-badge-soft">
                                    {item.badge === "assisted" ? menus.assisted : menus.chatOnly}
                                  </span>
                                )}
                                {model === item.n && (
                                  <Check size={12} aria-hidden="true" className="had-mi-check" />
                                )}
                                <Star
                                  size={12}
                                  aria-hidden="true"
                                  className="had-star"
                                  data-on={starred.includes(item.n) || undefined}
                                  fill={starred.includes(item.n) ? "currentColor" : "none"}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleStar(item.n);
                                  }}
                                />
                              </button>
                            ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </span>

              {/* effort / variant dropdown */}
              <span className="had-menu-wrap">
                <button
                  type="button"
                  className="had-effort"
                  aria-haspopup="menu"
                  aria-expanded={openMenu === "effort"}
                  onClick={() => toggleMenu("effort")}
                >
                  <Settings size={11} aria-hidden="true" />
                  {menus.variantShort[effortIndex]}
                  <ChevronDown size={10} aria-hidden="true" />
                </button>
                {openMenu === "effort" && (
                  <div className="had-menu had-menu--effort" role="menu">
                    <p className="had-menu-title">{menus.variantTitle}</p>
                    {menus.variants.map((label, index) => (
                      <button
                        key={label}
                        type="button"
                        role="menuitemradio"
                        aria-checked={effortIndex === index}
                        className="had-menu-item had-menu-item--plain"
                        onClick={() => {
                          setEffortIndex(index);
                          setOpenMenu(null);
                        }}
                      >
                        <span className="had-mi-label">{label}</span>
                        {effortIndex === index && (
                          <Check size={13} aria-hidden="true" className="had-mi-check" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </span>

              <Mic size={13} aria-hidden="true" className="had-icon" />
              <button
                type="button"
                className="had-send"
                aria-label={demo.windowTitle}
                data-ready={prompt.trim().length > 0 || undefined}
                onClick={send}
              >
                <ArrowUp size={13} aria-hidden="true" />
              </button>
            </div>
          </div>
          <span className="had-folder">
            <Folder size={11} aria-hidden="true" />
            {demo.workFolder}
          </span>
        </div>
      </div>
    </div>
  );
}
