"use client";

import {
  Boxes,
  Cloud,
  Download,
  HardDrive,
  KeyRound,
  Languages,
  Rocket,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { Content } from "./content";
import { ContextRailPbrScene } from "./ContextRailPbrScene";
import "./context-rail-field.css";

type CapabilityId = "local" | "online" | "bilingual" | "tools" | "production" | "key";
type Platform = "mac" | "windows";
type Locale = "zh" | "en";

type CapabilityCopy = {
  id: CapabilityId;
  anchor: string;
  icon: LucideIcon;
  label: string;
  eyebrow: string;
  title: string;
  signal: string;
  summary: string;
  facts: readonly [
    { label: string; value: string },
    { label: string; value: string },
    { label: string; value: string },
  ];
  flow: readonly [string, string, string];
};

const capabilityOrder: readonly CapabilityId[] = [
  "local",
  "online",
  "bilingual",
  "tools",
  "production",
  "key",
];

const copy: Record<Locale, readonly CapabilityCopy[]> = {
  zh: [
    {
      id: "local",
      anchor: "capability-local",
      icon: HardDrive,
      label: "本地",
      eyebrow: "CAPABILITY 01 · LOCAL",
      title: "本地执行",
      signal: "任务已切换至本地执行",
      summary: "任务在你的设备上完成，敏感资料无需离开本机。",
      facts: [
        { label: "位置", value: "本机设备" },
        { label: "网络", value: "可离线" },
        { label: "数据", value: "不出设备" },
      ],
      flow: ["任务资料", "本地处理", "设备内结果"],
    },
    {
      id: "online",
      anchor: "capability-online",
      icon: Cloud,
      label: "在线",
      eyebrow: "CAPABILITY 02 · ONLINE",
      title: "受控在线",
      signal: "安全在线通道已建立",
      summary: "仅在任务需要实时信息时连接外部服务，并保持上下文连续。",
      facts: [
        { label: "调用", value: "按需启用" },
        { label: "通道", value: "安全连接" },
        { label: "回退", value: "返回本地" },
      ],
      flow: ["本地任务", "在线能力", "上下文回写"],
    },
    {
      id: "bilingual",
      anchor: "capability-bilingual",
      icon: Languages,
      label: "双语处理",
      eyebrow: "CAPABILITY 03 · BILINGUAL",
      title: "双语上下文",
      signal: "中英文上下文已对齐",
      summary: "中文与英文共享同一任务状态，切换语言无需重新开始。",
      facts: [
        { label: "语言", value: "中 / EN" },
        { label: "状态", value: "实时同步" },
        { label: "术语", value: "保持一致" },
      ],
      flow: ["任一语言", "语义对齐", "一致输出"],
    },
    {
      id: "tools",
      anchor: "capability-tools",
      icon: Boxes,
      label: "工具生态",
      eyebrow: "CAPABILITY 04 · TOOLS",
      title: "工具编排",
      signal: "工具生态已接入",
      summary: "按任务阶段调用已接入工具，并将结果写回同一上下文。",
      facts: [
        { label: "调用", value: "按需触发" },
        { label: "权限", value: "策略约束" },
        { label: "结果", value: "自动回写" },
      ],
      flow: ["任务意图", "工具执行", "结果回写"],
    },
    {
      id: "production",
      anchor: "capability-production",
      icon: Rocket,
      label: "生产环境",
      eyebrow: "CAPABILITY 05 · PRODUCTION",
      title: "生产交付",
      signal: "生产导轨已校准",
      summary: "交付前校验环境、参数和输出，让生产状态清晰可追踪。",
      facts: [
        { label: "环境", value: "交付就绪" },
        { label: "校验", value: "参数一致" },
        { label: "追踪", value: "全程可见" },
      ],
      flow: ["任务结果", "交付校验", "生产输出"],
    },
    {
      id: "key",
      anchor: "capability-secret",
      icon: KeyRound,
      label: "密钥",
      eyebrow: "CAPABILITY 06 · KEYS",
      title: "密钥与策略",
      signal: "密钥触点已锁定",
      summary: "调用能力前验证权限，凭据隔离保存，不随任务暴露。",
      facts: [
        { label: "凭据", value: "隔离保存" },
        { label: "策略", value: "执行前校验" },
        { label: "状态", value: "已锁定" },
      ],
      flow: ["任务请求", "策略验证", "授权执行"],
    },
  ],
  en: [
    {
      id: "local",
      anchor: "capability-local",
      icon: HardDrive,
      label: "Local",
      eyebrow: "CAPABILITY 01 · LOCAL",
      title: "Local execution",
      signal: "Task switched to local execution",
      summary: "The task finishes on your device, keeping sensitive material local.",
      facts: [
        { label: "Location", value: "On device" },
        { label: "Network", value: "Offline ready" },
        { label: "Data", value: "Stays local" },
      ],
      flow: ["Task data", "Local process", "Device result"],
    },
    {
      id: "online",
      anchor: "capability-online",
      icon: Cloud,
      label: "Online",
      eyebrow: "CAPABILITY 02 · ONLINE",
      title: "Controlled online",
      signal: "Secure online channel established",
      summary: "External services connect only when live information is needed.",
      facts: [
        { label: "Call", value: "On demand" },
        { label: "Channel", value: "Secure" },
        { label: "Fallback", value: "Local" },
      ],
      flow: ["Local task", "Online ability", "Context returned"],
    },
    {
      id: "bilingual",
      anchor: "capability-bilingual",
      icon: Languages,
      label: "Bilingual",
      eyebrow: "CAPABILITY 03 · BILINGUAL",
      title: "Bilingual context",
      signal: "Chinese and English aligned",
      summary: "Chinese and English share one task state without restarting.",
      facts: [
        { label: "Language", value: "ZH / EN" },
        { label: "State", value: "Synchronized" },
        { label: "Terms", value: "Retained" },
      ],
      flow: ["Either language", "Meaning aligned", "One result"],
    },
    {
      id: "tools",
      anchor: "capability-tools",
      icon: Boxes,
      label: "Tools",
      eyebrow: "CAPABILITY 04 · TOOLS",
      title: "Tool orchestration",
      signal: "Tool ecosystem connected",
      summary: "Connected tools run at the right task stage and return results.",
      facts: [
        { label: "Call", value: "On demand" },
        { label: "Policy", value: "Aware" },
        { label: "Result", value: "Returned" },
      ],
      flow: ["Task intent", "Tool action", "Result returned"],
    },
    {
      id: "production",
      anchor: "capability-production",
      icon: Rocket,
      label: "Production",
      eyebrow: "CAPABILITY 05 · PRODUCTION",
      title: "Production delivery",
      signal: "Production rail calibrated",
      summary: "Environment, parameters, and output are checked before delivery.",
      facts: [
        { label: "Environment", value: "Ready" },
        { label: "Check", value: "Calibrated" },
        { label: "Trace", value: "Visible" },
      ],
      flow: ["Task result", "Delivery check", "Production output"],
    },
    {
      id: "key",
      anchor: "capability-secret",
      icon: KeyRound,
      label: "Keys",
      eyebrow: "CAPABILITY 06 · KEYS",
      title: "Keys and policy",
      signal: "Key contacts locked",
      summary: "Permissions are verified before use while credentials stay isolated.",
      facts: [
        { label: "Credentials", value: "Isolated" },
        { label: "Policy", value: "Preflight" },
        { label: "State", value: "Locked" },
      ],
      flow: ["Task request", "Policy check", "Authorized action"],
    },
  ],
};

const releaseUrls: Record<Platform, string | undefined> = {
  mac: process.env.NEXT_PUBLIC_DJL_MAC_DOWNLOAD_URL ?? "/download/mac",
  windows: process.env.NEXT_PUBLIC_DJL_WINDOWS_DOWNLOAD_URL ?? "/download/windows",
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function ContextRailField({ t }: { t: Content }) {
  const locale: Locale = t.htmlLang.startsWith("zh") ? "zh" : "en";
  const isZh = locale === "zh";
  const capabilities = copy[locale];
  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const activeRef = useRef(0);
  const wheelTargetRef = useRef(0);
  const hashSettledRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  const active = capabilities[activeIndex] ?? capabilities[0];

  const updateFromScroll = useCallback(() => {
    if (!hashSettledRef.current) return;
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const viewportHeight = Math.max(1, window.innerHeight);
    // Read all layout metrics before writing the entry CSS variables so the
    // browser can keep this scroll frame in one read phase and one write phase.
    const travel = Math.max(1, root.offsetHeight - viewportHeight);
    const entryProgress = clamp(
      1 - rect.top / viewportHeight,
      0,
      1,
    );
    root.style.setProperty("--crf-entry", entryProgress.toFixed(4));
    root.style.setProperty(
      "--crf-entry-clip",
      `${12 + entryProgress * 140}%`,
    );
    root.style.setProperty(
      "--crf-entry-scale",
      (1.028 - entryProgress * 0.028).toFixed(4),
    );
    root.style.setProperty(
      "--crf-entry-y",
      `${(1 - entryProgress) * 22}px`,
    );
    root.style.setProperty(
      "--crf-entry-blur",
      `${(1 - entryProgress) * 2.4}px`,
    );
    root.style.setProperty(
      "--crf-entry-opacity",
      (0.34 + entryProgress * 0.66).toFixed(4),
    );
    const nextProgress = clamp((-rect.top / travel) * (capabilities.length - 1), 0, capabilities.length - 1);
    const nextIndex = clamp(Math.round(nextProgress), 0, capabilities.length - 1);
    setProgress((current) => Math.abs(current - nextProgress) > 0.002 ? nextProgress : current);
    if (nextIndex !== activeRef.current) {
      activeRef.current = nextIndex;
      setActiveIndex(nextIndex);
      const nextHash = `#${capabilities[nextIndex].anchor}`;
      if (window.location.hash !== nextHash) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}${nextHash}`,
        );
      }
    }
  }, [capabilities]);

  useEffect(() => {
    const schedule = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        updateFromScroll();
      });
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [updateFromScroll]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("djl:capability-active", {
      detail: { id: active.anchor },
    }));
  }, [active.anchor]);

  const scrollToIndex = useCallback((index: number) => {
    const root = rootRef.current;
    if (!root) return;
    const safeIndex = clamp(index, 0, capabilities.length - 1);
    wheelTargetRef.current = safeIndex;
    const rootTop = window.scrollY + root.getBoundingClientRect().top;
    const travel = Math.max(0, root.offsetHeight - window.innerHeight);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: rootTop + (travel * safeIndex) / (capabilities.length - 1),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [capabilities.length]);

  useEffect(() => {
    wheelTargetRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    const desktopPointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const threshold = 18;
    const idleDelay = 220;
    let accumulated = 0;
    let locked = false;
    let unlockTimer = 0;

    const unlock = () => {
      window.clearTimeout(unlockTimer);
      unlockTimer = 0;
      accumulated = 0;
      locked = false;
    };

    const scheduleUnlock = () => {
      window.clearTimeout(unlockTimer);
      unlockTimer = window.setTimeout(unlock, idleDelay);
    };

    const onWheel = (event: WheelEvent) => {
      if (
        !desktopPointer.matches
        || event.ctrlKey
        || event.metaKey
        || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ) {
        return;
      }

      const gatewayState = document.documentElement.dataset.djlGatewayState ?? "";
      if (gatewayState.startsWith("playing") || gatewayState.startsWith("settling")) {
        event.preventDefault();
        return;
      }

      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const isPinned = rect.top <= 1 && rect.bottom >= window.innerHeight - 1;
      if (!isPinned) return;

      if (event.buttons !== 0) {
        event.preventDefault();
        return;
      }

      if (locked) {
        event.preventDefault();
        scheduleUnlock();
        return;
      }

      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? window.innerHeight
          : 1;
      const delta = event.deltaY * unit;
      if (Math.abs(delta) < 0.1) return;

      const direction = Math.sign(delta);
      const currentTarget = wheelTargetRef.current;
      const lastIndex = capabilities.length - 1;
      const isLeavingStart = currentTarget === 0 && direction < 0;
      const isLeavingEnd = currentTarget === lastIndex && direction > 0;
      if (isLeavingStart || isLeavingEnd) {
        accumulated = 0;
        return;
      }

      event.preventDefault();
      accumulated += delta;
      scheduleUnlock();

      if (Math.abs(accumulated) < threshold) return;

      locked = true;
      const target = clamp(currentTarget + Math.sign(accumulated), 0, lastIndex);
      accumulated = 0;
      scrollToIndex(target);
      scheduleUnlock();
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.clearTimeout(unlockTimer);
    };
  }, [capabilities.length, scrollToIndex]);

  const selectFromScene = useCallback((index: number) => {
    const root = rootRef.current;
    if (!root) return;
    const safeIndex = clamp(index, 0, capabilities.length - 1);
    wheelTargetRef.current = safeIndex;
    const rootTop = window.scrollY + root.getBoundingClientRect().top;
    const travel = Math.max(0, root.offsetHeight - window.innerHeight);

    activeRef.current = safeIndex;
    setActiveIndex(safeIndex);
    setProgress(safeIndex);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#${capabilities[safeIndex].anchor}`,
    );

    // A physical drop must settle immediately. Native smooth scrolling can
    // keep a wheel/pointer gesture alive after release and unexpectedly return
    // the page to the hero, so scene interactions use an atomic jump while
    // header/keyboard navigation retains the cinematic smooth transition.
    window.scrollTo({
      top: rootTop + (travel * safeIndex) / (capabilities.length - 1),
      behavior: "auto",
    });
  }, [capabilities]);

  useEffect(() => {
    const onSelect = (event: Event) => {
      const raw = (event as CustomEvent<{ id?: string }>).detail?.id ?? "";
      const normalized = raw.replace("capability-", "");
      const id = normalized === "secret" ? "key" : normalized;
      const index = capabilityOrder.indexOf(id as CapabilityId);
      if (index >= 0) scrollToIndex(index);
    };
    window.addEventListener("djl:select-capability", onSelect);
    return () => window.removeEventListener("djl:select-capability", onSelect);
  }, [scrollToIndex]);

  useEffect(() => {
    const hash = window.location.hash.replace("#capability-", "");
    if (!hash) {
      hashSettledRef.current = true;
      updateFromScroll();
      return;
    }
    const id = hash === "secret" ? "key" : hash;
    const index = capabilityOrder.indexOf(id as CapabilityId);
    if (index < 0) {
      hashSettledRef.current = true;
      updateFromScroll();
      return;
    }

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      activeRef.current = index;
      setActiveIndex(index);
      setProgress(index);
      secondFrame = window.requestAnimationFrame(() => {
        const root = rootRef.current;
        if (!root) {
          hashSettledRef.current = true;
          return;
        }
        const rootTop = window.scrollY + root.getBoundingClientRect().top;
        const travel = Math.max(0, root.offsetHeight - window.innerHeight);
        hashSettledRef.current = true;
        window.scrollTo({
          top: rootTop + (travel * index) / (capabilities.length - 1),
          behavior: "auto",
        });
        updateFromScroll();
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [capabilities.length, updateFromScroll]);

  useEffect(() => {
    const syncFromHash = () => {
      const hash = window.location.hash.replace("#capability-", "");
      const id = hash === "secret" ? "key" : hash;
      const index = capabilityOrder.indexOf(id as CapabilityId);
      if (index >= 0) selectFromScene(index);
    };
    window.addEventListener("hashchange", syncFromHash);
    window.addEventListener("popstate", syncFromHash);
    return () => {
      window.removeEventListener("hashchange", syncFromHash);
      window.removeEventListener("popstate", syncFromHash);
    };
  }, [selectFromScene]);

  const handleDownload = useCallback((platform: Platform) => {
    const url = releaseUrls[platform];
    if (url) {
      window.location.assign(url);
      return;
    }
    setNotice(
      isZh
        ? `${platform === "mac" ? "macOS" : "Windows"} 下载包正在接入发布通道。`
        : `${platform === "mac" ? "macOS" : "Windows"} release package is being connected.`,
    );
  }, [isZh]);

  const handleStageKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (["ArrowDown", "ArrowRight", "PageDown"].includes(event.key)) {
      event.preventDefault();
      scrollToIndex(activeIndex + 1);
    } else if (["ArrowUp", "ArrowLeft", "PageUp"].includes(event.key)) {
      event.preventDefault();
      scrollToIndex(activeIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      scrollToIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      scrollToIndex(capabilities.length - 1);
    }
  };

  return (
    <section
      id="start"
      ref={rootRef}
      className="context-rail-field"
      data-active={active.id}
      aria-label={isZh ? "DJL 互动式 2.5D 能力轨道" : "DJL interactive 2.5D capability rail"}
    >
      {capabilities.map((capability, index) => (
        <span
          key={capability.id}
          id={capability.anchor}
          className="crf-nav-anchor"
          style={{ top: `calc(${index * 20}% - ${index * 20}svh)` } as CSSProperties}
        />
      ))}

      <div
        ref={stageRef}
        className="crf-stage"
        tabIndex={0}
        onKeyDown={handleStageKeyDown}
        aria-label={isZh ? "滚动或使用方向键切换六项能力" : "Scroll or use arrow keys to move through six capabilities"}
      >
        <div className="crf-studio-light" aria-hidden="true" />

        <div id="crf-downloads" className="crf-scene-frame">
          <ContextRailPbrScene
            locale={locale}
            activeIndex={activeIndex}
            progress={progress}
            onSelect={selectFromScene}
            onTerminal={handleDownload}
          />
        </div>

        <p className="crf-live" aria-live="polite">
          {active.signal} · {isZh ? `第 ${activeIndex + 1} 项能力` : `capability ${activeIndex + 1}`}
        </p>

        {notice && (
          <div className="crf-notice" role="status">
            <span><Download aria-hidden="true" /></span>
            <p>{notice}</p>
            <button type="button" onClick={() => setNotice(null)} aria-label={isZh ? "关闭通知" : "Close notification"}><X /></button>
          </div>
        )}
      </div>
    </section>
  );
}
