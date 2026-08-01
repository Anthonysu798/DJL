"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ChevronDown } from "lucide-react";
import type { Content } from "./content";
import { GITHUB_REPOSITORY_URL } from "./lib/githubDesktopDownloads";
import { GithubMark } from "./ui/github-mark";
import { useDownloadTarget } from "./useDownloadTarget";
import "./glass-nav.css";

gsap.registerPlugin(ScrollToPlugin, ScrollTrigger);

const SPY_IDS = ["product", "capabilities", "local-ai"] as const;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The liquid-glass floating pill — the one sanctioned exception to the flat
// design.md system. Visible from first paint; no intro-event gating.
export function GlassNav({ t }: { t: Content }) {
  const nav = t.landing.nav;
  const isZh = t.htmlLang === "zh-CN";
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const download = useDownloadTarget({ mac: nav.download, windows: nav.download });

  // Scroll-spy: the link whose section fills the viewport middle reads as active.
  // Effects run after the whole tree commits, so the section elements exist.
  useGSAP(() => {
    SPY_IDS.forEach((id) => {
      ScrollTrigger.create({
        trigger: `#${id}`,
        start: "top 45%",
        end: "bottom 45%",
        onToggle: (self) => {
          if (self.isActive) setActiveId(id);
        },
      });
    });
    ScrollTrigger.create({
      trigger: `#${SPY_IDS[0]}`,
      start: "top 45%",
      onLeaveBack: () => setActiveId(null),
    });
  });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Open menu: lock the page scroll, close on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!langOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!langRef.current?.contains(event.target as Node)) setLangOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLangOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [langOpen]);

  const scrollToAnchor = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    event.preventDefault();
    setMenuOpen(false);
    gsap.to(window, {
      duration: reducedMotion() ? 0 : 1,
      ease: "power3.inOut",
      scrollTo: { y: `#${id}`, offsetY: 84 },
    });
  };

  const anchors = [
    { id: "product", label: nav.product },
    { id: "capabilities", label: nav.capabilities },
    { id: "local-ai", label: nav.localAi },
  ];
  const docsHref = isZh ? "/docs" : "/en/docs";

  return (
    <header className="glass-nav" data-scrolled={scrolled || undefined}>
      <div className="glass-nav-pill">
        <a className="glass-nav-brand" href={isZh ? "/" : "/en"}>
          <img src="/djl-logo.png" alt="DJL" />
        </a>

        <nav className="glass-nav-links" aria-label={isZh ? "主导航" : "Primary"}>
          {anchors.map((anchor) => (
            <a
              key={anchor.id}
              href={`#${anchor.id}`}
              data-active={anchor.id === activeId || undefined}
              onClick={(event) => scrollToAnchor(event, anchor.id)}
            >
              {anchor.label}
            </a>
          ))}
          <a href={docsHref}>{nav.docs}</a>
        </nav>

        <div className="glass-nav-actions">
          <div className="glass-nav-lang" ref={langRef}>
            <button
              type="button"
              aria-haspopup="true"
              aria-expanded={langOpen}
              onClick={() => setLangOpen((open) => !open)}
            >
              {nav.languageLabel}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {langOpen ? (
              <div className="glass-nav-lang-menu">
                <a href="/" className={isZh ? "active" : undefined}>
                  中文
                </a>
                <a href="/en" className={isZh ? undefined : "active"}>
                  English
                </a>
              </div>
            ) : null}
          </div>

          <a
            className="glass-nav-github"
            href={GITHUB_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            aria-label={nav.githubLabel}
          >
            <GithubMark size={18} />
          </a>

          <a className="lp-btn glass-nav-download" href={download.href}>
            {download.label}
          </a>

          <button
            type="button"
            className="glass-nav-burger"
            aria-label={nav.menuLabel}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span
              className="glass-nav-burger-lines"
              data-open={menuOpen || undefined}
              aria-hidden="true"
            >
              <span />
              <span />
            </span>
          </button>
        </div>
      </div>

      <div
        className="glass-nav-scrim"
        data-open={menuOpen || undefined}
        aria-hidden="true"
        onClick={() => setMenuOpen(false)}
      />

      {/* Kept mounted so open/close can animate; data-open drives the transitions. */}
      <div className="glass-nav-sheet" data-open={menuOpen || undefined} aria-hidden={!menuOpen}>
        {anchors.map((anchor) => (
          <a
            key={anchor.id}
            href={`#${anchor.id}`}
            tabIndex={menuOpen ? undefined : -1}
            onClick={(event) => scrollToAnchor(event, anchor.id)}
          >
            {anchor.label}
          </a>
        ))}
        <a href={docsHref} tabIndex={menuOpen ? undefined : -1}>
          {nav.docs}
        </a>
        <a
          href={GITHUB_REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
          tabIndex={menuOpen ? undefined : -1}
        >
          GitHub
        </a>
        <div className="glass-nav-sheet-lang">
          <a href="/" className={isZh ? "active" : undefined} tabIndex={menuOpen ? undefined : -1}>
            中文
          </a>
          <a
            href="/en"
            className={isZh ? undefined : "active"}
            tabIndex={menuOpen ? undefined : -1}
          >
            English
          </a>
        </div>
      </div>
    </header>
  );
}
