"use client";

import Image from "next/image";
import {
  Apple,
  Check,
  ChevronRight,
  ChevronsDown,
  Command,
  Copy,
  Cpu,
  Download,
  MonitorDown,
  ShieldCheck,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { Content } from "./content";
import { GITHUB_LATEST_RELEASE_CHECKSUMS_URL } from "./lib/githubDesktopDownloads";
import { AnimatedBeam } from "./ui/animated-beam";
import "./desktop-launch-gate.css";

type Platform = "mac" | "windows";
type Detail = "requirements" | "verify" | "checksum";

const releaseUrls: Record<Platform, string | undefined> = {
  mac: undefined,
  windows: "/download/windows",
};

const PUBLIC_RELEASES_URL = GITHUB_LATEST_RELEASE_CHECKSUMS_URL;

const launchCopy = {
  zh: {
    eyebrow: "DJL DESKTOP · {version} ·",
    stable: "STABLE",
    title: "选择你的运行环境",
    subtitle: "上下文完整抵达你的设备。现在，",
    subtitleAccent: "启动 DJL。",
    local: "本地",
    localValue: "100% 私密执行",
    online: "在线",
    onlineValue: "安全同步",
    mac: {
      label: "LOCAL RUNTIME",
      title: "下载 macOS 版",
      meta: "macOS 13+ · Apple Silicon / Intel · Apple 已公证",
      aria: "选择 DJL macOS 下载版本",
    },
    windows: {
      label: "ONLINE READY",
      title: "下载 Windows 版",
      meta: "Windows 10 / 11 · x64 · Anthony Su 签名",
      aria: "下载 DJL Windows 版",
    },
    macChoiceTitle: "选择 Mac 芯片",
    macChoiceBody: "“关于本机”中的芯片或处理器信息可以帮助你确认版本。",
    appleSilicon: "Apple Silicon",
    appleSiliconMeta: "M1、M2、M3、M4 或更新芯片",
    intel: "Intel Mac",
    intelMeta: "Intel Core 处理器",
    recommended: "推荐",
    downloadFallback: "如果自动下载暂时不可用，请从 DJL 官方下载存档重试。",
    releaseLink: "查看校验值",
    close: "关闭提示",
    requirements: "查看系统要求",
    verify: "安装包安全说明",
    checksum: "校验值与发布页",
    requirementsTitle: "系统要求",
    requirementsBody:
      "macOS 13+（Apple Silicon / Intel）或 Windows 10 / 11 x64；建议 8 GB 内存与 2 GB 可用空间。",
    verifyTitle: "安装包安全说明",
    verifyBody:
      "DJL macOS 安装包已使用 Developer ID 签名并通过 Apple 公证。Windows 安装包已通过 Microsoft Artifact Signing 进行 Authenticode 签名并添加时间戳，发布者为 Anthony Su。请只从 downloads.slcor.com 下载。",
    checksumTitle: "校验值与备用下载",
    checksumBody:
      "每个版本的下载存档都附带 SHA256SUMS。若自动下载暂时不可用，请从 DJL 官方下载存档重试。",
    copyStatus: "说明已复制",
  },
  en: {
    eyebrow: "DJL DESKTOP · {version} ·",
    stable: "STABLE",
    title: "Choose your runtime",
    subtitle: "Your context arrives intact. Now, ",
    subtitleAccent: "launch DJL.",
    local: "LOCAL",
    localValue: "100% private",
    online: "ONLINE",
    onlineValue: "Secure sync",
    mac: {
      label: "LOCAL RUNTIME",
      title: "Download for macOS",
      meta: "macOS 13+ · Apple Silicon / Intel · Apple notarized",
      aria: "Choose a DJL download for macOS",
    },
    windows: {
      label: "ONLINE READY",
      title: "Download for Windows",
      meta: "Windows 10 / 11 · x64 · Authenticode signed",
      aria: "Download DJL for Windows",
    },
    macChoiceTitle: "Choose your Mac chip",
    macChoiceBody: "Check the Chip or Processor field in About This Mac if you are unsure.",
    appleSilicon: "Apple Silicon",
    appleSiliconMeta: "M1, M2, M3, M4, or newer",
    intel: "Intel Mac",
    intelMeta: "Intel Core processor",
    recommended: "Recommended",
    downloadFallback: "If an automatic download is temporarily unavailable, retry from DJL’s official download archive.",
    releaseLink: "View checksums",
    close: "Close notification",
    requirements: "System requirements",
    verify: "Package security",
    checksum: "Checksums & releases",
    requirementsTitle: "System requirements",
    requirementsBody:
      "macOS 13+ (Apple Silicon / Intel) or Windows 10 / 11 x64; 8 GB memory and 2 GB free space recommended.",
    verifyTitle: "Package security",
    verifyBody:
      "DJL for macOS is Developer ID signed and Apple notarized. The Windows installer is Authenticode signed and timestamped by Anthony Su through Microsoft Artifact Signing. Download only from downloads.slcor.com.",
    checksumTitle: "Checksums and fallback downloads",
    checksumBody:
      "Every version archive includes SHA256SUMS. If the automatic download is temporarily unavailable, retry from DJL’s official download archive.",
    copyStatus: "Details copied",
  },
} as const;

export function DesktopLaunchGate({ t }: { t: Content }) {
  const isZh = t.htmlLang === "zh-CN";
  const copy = isZh ? launchCopy.zh : launchCopy.en;
  const scrollCopy = isZh
    ? { hint: "继续滑动", entry: "进入", sync: "同步", download: "下载" }
    : { hint: "KEEP SCROLLING", entry: "ENTRY", sync: "SYNC", download: "DOWNLOAD" };
  const reducedMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const coreRef = useRef<HTMLDivElement | null>(null);
  const macRef = useRef<HTMLDivElement | null>(null);
  const windowsRef = useRef<HTMLDivElement | null>(null);
  const macTriggerRef = useRef<HTMLButtonElement | null>(null);
  const macChoiceRef = useRef<HTMLAnchorElement | null>(null);
  const [activePlatform, setActivePlatform] = useState<Platform | null>(null);
  const [macChooserOpen, setMacChooserOpen] = useState(false);
  // Read the advertised version from the same release the download buttons serve, so the label can
  // never claim a version that was never shipped. Null until it resolves, and null forever if the
  // lookup fails — the eyebrow then omits the version rather than showing a stale guess.
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/desktop-version", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { version?: unknown } | null) => {
        if (typeof payload?.version === "string") {
          setDesktopVersion(payload.version);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [copied, setCopied] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);

  const animationActive = inView && pageVisible && !reducedMotion;

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: "18% 0px", threshold: 0.02 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    const scene = sceneRef.current;
    if (!section || !scene) return;

    let frame = 0;
    const updateScrollScene = () => {
      frame = 0;
      const rect = section.getBoundingClientRect();
      const isPinned = window.getComputedStyle(scene).position === "sticky";
      const sceneHeight = Math.max(1, scene.offsetHeight);
      const scrollDistance = Math.max(1, section.offsetHeight - sceneHeight);
      const naturalEntryTop = window.innerHeight * 0.72;
      const naturalExitTop = window.innerHeight - section.offsetHeight;
      const naturalTravel = Math.max(1, naturalEntryTop - naturalExitTop);
      const rawProgress = isPinned
        ? (64 - rect.top) / scrollDistance
        : (naturalEntryTop - rect.top) / naturalTravel;
      const progress = reducedMotion ? 1 : Math.min(1, Math.max(0, rawProgress));
      const eased = 1 - Math.pow(1 - progress, 2.2);
      const phase = progress < 0.34 ? "entry" : progress < 0.72 ? "sync" : "download";

      section.dataset.scrollPhase = phase;
      section.style.setProperty("--dl-scroll", progress.toFixed(4));
      section.style.setProperty("--dl-scroll-percent", `${(progress * 100).toFixed(2)}%`);
      const utilityProgress = Math.min(1, Math.max(0, (progress - 0.42) / 0.42));
      section.style.setProperty("--dl-scroll-heading-y", `${((1 - eased) * 24).toFixed(2)}px`);
      section.style.setProperty("--dl-scroll-heading-opacity", `${(0.78 + eased * 0.22).toFixed(3)}`);
      section.style.setProperty("--dl-scroll-heading-scale", `${(0.965 + eased * 0.035).toFixed(4)}`);
      section.style.setProperty("--dl-scroll-environment-y", `${(38 - eased * 56).toFixed(2)}px`);
      section.style.setProperty("--dl-scroll-environment-scale", `${(1.065 - eased * 0.035).toFixed(4)}`);
      section.style.setProperty("--dl-scroll-machine-y", `${((1 - eased) * 30).toFixed(2)}px`);
      section.style.setProperty("--dl-scroll-machine-scale", `${(0.94 + eased * 0.14).toFixed(4)}`);
      section.style.setProperty("--dl-scroll-machine-rotate", `${(-7 + eased * 16).toFixed(2)}deg`);
      section.style.setProperty("--dl-scroll-core-y", `${((1 - eased) * 12).toFixed(2)}px`);
      section.style.setProperty("--dl-scroll-core-scale", `${(0.96 + eased * 0.12).toFixed(4)}`);
      section.style.setProperty("--dl-scroll-portal-y", `${((1 - eased) * 20).toFixed(2)}px`);
      section.style.setProperty("--dl-scroll-mac-x", `${((1 - eased) * 16).toFixed(2)}px`);
      section.style.setProperty("--dl-scroll-windows-x", `${((1 - eased) * -16).toFixed(2)}px`);
      section.style.setProperty("--dl-scroll-portal-opacity", `${(0.82 + eased * 0.18).toFixed(3)}`);
      section.style.setProperty("--dl-scroll-beam-opacity", `${(0.34 + eased * 0.66).toFixed(3)}`);
      section.style.setProperty("--dl-scroll-utility-y", `${((1 - utilityProgress) * 12).toFixed(2)}px`);
      section.style.setProperty("--dl-scroll-utility-opacity", `${(0.55 + utilityProgress * 0.45).toFixed(3)}`);
      section.style.setProperty("--dl-scroll-hint-opacity", `${Math.max(0, 1 - progress * 4.5).toFixed(3)}`);
    };

    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateScrollScene);
    };

    updateScrollScene();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (macChooserOpen) macChoiceRef.current?.focus();
  }, [macChooserOpen]);

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (reducedMotion || !window.matchMedia("(pointer: fine)").matches) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      const node = event.currentTarget;
      node.style.setProperty("--dl-far-x", `${x * -10}px`);
      node.style.setProperty("--dl-far-y", `${y * -8}px`);
      node.style.setProperty("--dl-mid-x", `${x * 16}px`);
      node.style.setProperty("--dl-mid-y", `${y * 12}px`);
      node.style.setProperty("--dl-near-x", `${x * 24}px`);
      node.style.setProperty("--dl-near-y", `${y * 18}px`);
      node.style.setProperty("--dl-tilt-x", `${y * -1.2}deg`);
      node.style.setProperty("--dl-tilt-y", `${x * 1.5}deg`);
    },
    [reducedMotion],
  );

  const resetPointer = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const node = event.currentTarget;
    node.style.setProperty("--dl-far-x", "0px");
    node.style.setProperty("--dl-far-y", "0px");
    node.style.setProperty("--dl-mid-x", "0px");
    node.style.setProperty("--dl-mid-y", "0px");
    node.style.setProperty("--dl-near-x", "0px");
    node.style.setProperty("--dl-near-y", "0px");
    node.style.setProperty("--dl-tilt-x", "0deg");
    node.style.setProperty("--dl-tilt-y", "0deg");
  }, []);

  const requestDownload = (platform: Platform) => {
    setDetail(null);
    if (platform === "mac") setMacChooserOpen((open) => !open);
  };

  const closeMacChooser = (restoreFocus = false) => {
    setMacChooserOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => macTriggerRef.current?.focus());
  };

  const openDetail = async (next: Detail) => {
    setMacChooserOpen(false);
    setDetail((current) => (current === next ? null : next));
    setCopied(false);
    if (next !== "checksum") return;
    try {
      await navigator.clipboard.writeText(copy.checksumBody);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const detailCopy = detail
    ? {
        requirements: {
          title: copy.requirementsTitle,
          body: copy.requirementsBody,
        },
        verify: { title: copy.verifyTitle, body: copy.verifyBody },
        checksum: { title: copy.checksumTitle, body: copy.checksumBody },
      }[detail]
    : null;

  return (
    <section
      ref={sectionRef}
      id="start"
      className="desktop-launch-gate"
      data-active={animationActive}
      data-platform={activePlatform ?? "idle"}
      data-scroll-phase="entry"
      aria-labelledby="desktop-launch-title"
    >
      <div
        ref={sceneRef}
        className="dl-scroll-sticky"
        onPointerMove={handlePointerMove}
        onPointerLeave={resetPointer}
      >
      <div className="dl-environment-depth" aria-hidden="true">
        <div className="dl-environment-motion">
          <Image
            src="/generated/djl-desktop-launch-bg-v1.png"
            alt=""
            fill
            priority={false}
            sizes="100vw"
          />
        </div>
      </div>

      <div className="dl-atmosphere" aria-hidden="true">
        <span className="dl-scan dl-scan-one" />
        <span className="dl-scan dl-scan-two" />
        <span className="dl-scan dl-scan-three" />
        <span className="dl-axis-beam" />
      </div>

      <div className="dl-frame">
        <header className="dl-heading">
          <p className="dl-eyebrow">
            <Sparkles aria-hidden="true" />
            <span>
              {desktopVersion
                ? copy.eyebrow.replace("{version}", `V${desktopVersion}`)
                : copy.eyebrow.replace(" {version} ", " ")}
            </span>
            <strong>{copy.stable}</strong>
          </p>
          <h2 id="desktop-launch-title">{copy.title}</h2>
          <p className="dl-subtitle">
            {copy.subtitle}
            <strong>{copy.subtitleAccent}</strong>
          </p>
        </header>

        <div className="dl-machine" aria-hidden="true">
          <div className="dl-orbit dl-orbit-back">
            <Image
              src="/generated/djl-context-orbits.png"
              alt=""
              width={1254}
              height={1254}
              sizes="(max-width: 760px) 360px, 720px"
            />
          </div>
          <div className="dl-orbit dl-orbit-front">
            <Image
              src="/generated/djl-context-orbits.png"
              alt=""
              width={1254}
              height={1254}
              sizes="(max-width: 760px) 320px, 610px"
            />
          </div>
        </div>

        <div ref={coreRef} className="dl-core-anchor">
          <div className="dl-core-depth">
            <div className="dl-core-aura" aria-hidden="true" />
            <Image
              className="dl-core-image"
              src="/generated/djl-context-core.png"
              alt={isZh ? "DJL 上下文核心" : "DJL context core"}
              width={1254}
              height={1254}
              sizes="(max-width: 760px) 190px, 300px"
            />
          </div>
          <span className="dl-core-state dl-core-state-local" aria-hidden="true">
            <i />
            <b>{copy.local}</b>
            <small>{copy.localValue}</small>
          </span>
          <span className="dl-core-state dl-core-state-online" aria-hidden="true">
            <i />
            <b>{copy.online}</b>
            <small>{copy.onlineValue}</small>
          </span>
        </div>

        {animationActive && (
          <>
            <AnimatedBeam
              containerRef={sceneRef}
              fromRef={coreRef}
              toRef={macRef}
              curvature={-96}
              duration={activePlatform === "mac" ? 1.05 : 2.35}
              pathColor="rgba(247, 232, 207, 0.18)"
              pathWidth={2}
              gradientStartColor="#fff8e9"
              gradientStopColor="#b7b7ba"
              startYOffset={42}
              endYOffset={-24}
              className="dl-energy-beam dl-energy-beam-mac"
            />
            <AnimatedBeam
              containerRef={sceneRef}
              fromRef={coreRef}
              toRef={windowsRef}
              curvature={-96}
              duration={activePlatform === "windows" ? 0.95 : 2.15}
              delay={0.22}
              pathColor="rgba(45, 130, 255, 0.22)"
              pathWidth={2.2}
              gradientStartColor="#d9f2ff"
              gradientStopColor="#0878ff"
              startYOffset={42}
              endYOffset={-24}
              className="dl-energy-beam dl-energy-beam-windows"
            />
          </>
        )}

        <PlatformPortal
          platform="mac"
          anchorRef={macRef}
          icon={Apple}
          commandIcon={Command}
          copy={copy.mac}
          href={releaseUrls.mac}
          buttonRef={macTriggerRef}
          expanded={macChooserOpen}
          controls="dl-mac-chooser"
          active={activePlatform === "mac"}
          onActive={setActivePlatform}
          onRequest={requestDownload}
        />

        {macChooserOpen && (
          <aside
            id="dl-mac-chooser"
            className="dl-mac-chooser"
            role="dialog"
            aria-modal="false"
            aria-labelledby="dl-mac-chooser-title"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              closeMacChooser(true);
            }}
          >
            <header>
              <span><Apple aria-hidden="true" /></span>
              <div>
                <strong id="dl-mac-chooser-title">{copy.macChoiceTitle}</strong>
                <p>{copy.macChoiceBody}</p>
              </div>
              <button type="button" aria-label={copy.close} onClick={() => closeMacChooser(true)}>
                <X aria-hidden="true" />
              </button>
            </header>
            <div className="dl-mac-options">
              <a ref={macChoiceRef} href="/download/mac/arm64">
                <Cpu aria-hidden="true" />
                <span>
                  <strong>{copy.appleSilicon}</strong>
                  <small>{copy.appleSiliconMeta}</small>
                </span>
                <em>{copy.recommended}</em>
                <ChevronRight aria-hidden="true" />
              </a>
              <a href="/download/mac/x64">
                <Command aria-hidden="true" />
                <span>
                  <strong>{copy.intel}</strong>
                  <small>{copy.intelMeta}</small>
                </span>
                <ChevronRight aria-hidden="true" />
              </a>
            </div>
            <p className="dl-mac-fallback">{copy.downloadFallback}</p>
          </aside>
        )}
        <PlatformPortal
          platform="windows"
          anchorRef={windowsRef}
          icon={MonitorDown}
          commandIcon={Cpu}
          copy={copy.windows}
          href={releaseUrls.windows}
          active={activePlatform === "windows"}
          onActive={setActivePlatform}
          onRequest={requestDownload}
        />

        <nav className="dl-utility-links" aria-label={isZh ? "下载信息" : "Download information"}>
          <button type="button" onClick={() => openDetail("requirements")} aria-expanded={detail === "requirements"}>
            <Cpu aria-hidden="true" />
            {copy.requirements}
          </button>
          <i aria-hidden="true" />
          <button type="button" onClick={() => openDetail("verify")} aria-expanded={detail === "verify"}>
            <ShieldCheck aria-hidden="true" />
            {copy.verify}
          </button>
          <i aria-hidden="true" />
          <button type="button" onClick={() => openDetail("checksum")} aria-expanded={detail === "checksum"}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? copy.copyStatus : copy.checksum}
          </button>
        </nav>

        <aside className="dl-detail-panel" data-open={Boolean(detailCopy)} aria-live="polite">
          {detailCopy && (
            <>
              <ShieldCheck aria-hidden="true" />
              <div>
                <strong>{detailCopy.title}</strong>
                <p>{detailCopy.body}</p>
                {detail !== "requirements" && (
                  <a href={PUBLIC_RELEASES_URL} target="_blank" rel="noreferrer">
                    {copy.releaseLink}
                    <ChevronRight aria-hidden="true" />
                  </a>
                )}
              </div>
              <button type="button" aria-label={copy.close} onClick={() => setDetail(null)}>
                <X aria-hidden="true" />
              </button>
            </>
          )}
        </aside>

      </div>

      <aside className="dl-scroll-telemetry" aria-hidden="true">
        <span className="dl-scroll-track"><i /></span>
        <ol>
          <li data-phase="entry"><b>01</b><span>{scrollCopy.entry}</span></li>
          <li data-phase="sync"><b>02</b><span>{scrollCopy.sync}</span></li>
          <li data-phase="download"><b>03</b><span>{scrollCopy.download}</span></li>
        </ol>
        <small><ChevronsDown />{scrollCopy.hint}</small>
      </aside>
      </div>
    </section>
  );
}
function PlatformPortal({
  platform,
  anchorRef,
  icon: PlatformIcon,
  commandIcon: CommandIcon,
  copy,
  href,
  buttonRef,
  expanded,
  controls,
  active,
  onActive,
  onRequest,
}: {
  platform: Platform;
  anchorRef: RefObject<HTMLDivElement | null>;
  icon: LucideIcon;
  commandIcon: LucideIcon;
  copy: { readonly label: string; readonly title: string; readonly meta: string; readonly aria: string };
  href?: string;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  expanded?: boolean;
  controls?: string;
  active: boolean;
  onActive: (platform: Platform | null) => void;
  onRequest: (platform: Platform) => void;
}) {
  const content = (
    <>
      <span className="dl-portal-icon"><PlatformIcon aria-hidden="true" /></span>
      <span className="dl-portal-copy">
        <small>{copy.label}</small>
        <strong>{copy.title}</strong>
        <em>{copy.meta}</em>
      </span>
      <span className="dl-portal-download">
        <Download aria-hidden="true" />
        <ChevronRight aria-hidden="true" />
      </span>
    </>
  );

  return (
    <div
      ref={anchorRef}
      className={`dl-portal-anchor dl-portal-anchor-${platform}`}
      data-active={active}
      onPointerEnter={() => onActive(platform)}
      onPointerLeave={() => onActive(null)}
      onFocusCapture={() => onActive(platform)}
      onBlurCapture={() => onActive(null)}
    >
      <div className="dl-portal-motion">
        <div className="dl-platform-disc" aria-hidden="true">
          <i /><i /><i />
        </div>
        <span className="dl-portal-signal" aria-hidden="true"><CommandIcon /></span>
        {href ? (
          <a className="dl-portal" href={href} aria-label={copy.aria}>
            {content}
          </a>
        ) : (
          <button
            ref={buttonRef}
            className="dl-portal"
            type="button"
            aria-label={copy.aria}
            aria-haspopup={controls ? "dialog" : undefined}
            aria-expanded={controls ? expanded : undefined}
            aria-controls={controls}
            onClick={() => onRequest(platform)}
          >
            {content}
          </button>
        )}
      </div>
    </div>
  );
}
