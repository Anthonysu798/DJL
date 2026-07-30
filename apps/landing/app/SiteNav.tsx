"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import type { Content } from "./content";

gsap.registerPlugin(ScrollToPlugin);

/* Sticky command bar. Transparent over the hero, condenses to a thin frosted
   hairline bar on scroll. Signature: a soft-blue marker that slides between
   nav items to track the section currently in view (an instrument readout),
   driven by the page's section observer rather than decoration. */
export function SiteNav({ t }: { t: Content }) {
  const isZh = t.htmlLang === "zh-CN";
  const items = useMemo(
    () =>
      isZh
        ? [
        { id: "capability-local", label: "本地" },
        { id: "capability-online", label: "在线" },
        { id: "capability-bilingual", label: "双语处理" },
        { id: "capability-tools", label: "工具生态" },
        { id: "capability-production", label: "生产环境" },
        { id: "capability-secret", label: "密钥" },
          ]
        : [
        { id: "capability-local", label: "Local" },
        { id: "capability-online", label: "Online" },
        { id: "capability-bilingual", label: "Bilingual" },
        { id: "capability-tools", label: "Tools" },
        { id: "capability-production", label: "Production" },
        { id: "capability-secret", label: "Keys" },
          ],
    [isZh],
  );

  const listRef = useRef<HTMLDivElement>(null);
  const linkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string>("");
  const [marker, setMarker] = useState({ left: 0, width: 0 });
  const [revealed, setRevealed] = useState(false);

  // Stay hidden during the hero splash; reveal once the intro signals it's done.
  useEffect(() => {
    const resumesBelowHero =
      window.location.hash === "#start"
      || window.location.hash.startsWith("#capability-")
      || window.scrollY > window.innerHeight * 0.5;
    if (
      (window as unknown as { __djlIntroDone?: boolean }).__djlIntroDone
      || resumesBelowHero
    ) {
      const frame = window.requestAnimationFrame(() => setRevealed(true));
      return () => window.cancelAnimationFrame(frame);
    }
    const onDone = () => setRevealed(true);
    window.addEventListener("djl:intro-done", onDone);
    return () => window.removeEventListener("djl:intro-done", onDone);
  }, []);

  // On scroll: condense the bar past the hero, and pick the active section as
  // the one crossing a reference line just below the nav. Computed directly
  // (a thin-band IntersectionObserver misses tall sections' ratio thresholds).
  useEffect(() => {
    let ticking = false;
    let frame: number | null = null;
    let lastPast: boolean | null = null;
    let gatewayBusy = (
      document.documentElement.dataset.djlGatewayState?.startsWith("playing")
      || document.documentElement.dataset.djlGatewayState?.startsWith("settling")
    ) ?? false;
    const syncScrolledThreshold = () => {
      const past = window.scrollY > window.innerHeight * 0.5;
      if (past !== lastPast) {
        lastPast = past;
        setScrolled(past);
        if (!past) setActive("");
      }
      return past;
    };
    const update = () => {
      const past = syncScrolledThreshold();
      if (!past) {
        return;
      }
      // The gateway already owns the visual state during its match cut. Avoid
      // scanning every capability anchor on each synthetic scroll frame.
      if (gatewayBusy) return;
      const line = window.innerHeight * 0.4;
      const field = document.querySelector<HTMLElement>(".context-rail-field, .magnetic-assembly-field");
      const fieldRect = field?.getBoundingClientRect();
      if (fieldRect && fieldRect.top <= line && fieldRect.bottom >= line) return;
      let current = "";
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= line) {
          current = item.id;
        } else {
          break;
        }
      }
      setActive(current);
    };
    const onScroll = () => {
      // The gateway drives many synthetic scroll events during its match cut.
      // Preserve the exact nav threshold, but avoid scheduling a React/RAF
      // update for every generated scroll frame.
      if (gatewayBusy) {
        syncScrolledThreshold();
        return;
      }
      if (ticking) return;
      ticking = true;
      frame = window.requestAnimationFrame(() => {
        update();
        ticking = false;
        frame = null;
      });
    };
    const onGatewayState = (event: Event) => {
      const next = (event as CustomEvent<{ state?: string }>).detail?.state ?? "";
      gatewayBusy = next.startsWith("playing") || next.startsWith("settling");
      if (gatewayBusy && frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
        ticking = false;
      } else if (!gatewayBusy) {
        onScroll();
      }
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("djl:gateway-state", onGatewayState);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("djl:gateway-state", onGatewayState);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [items]);

  useEffect(() => {
    const onCapabilityActive = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id ?? "";
      setActive(id);
    };
    window.addEventListener("djl:capability-active", onCapabilityActive);
    return () => window.removeEventListener("djl:capability-active", onCapabilityActive);
  }, []);

  // Measure the active link and position the sliding marker over it.
  useLayoutEffect(() => {
    const list = listRef.current;
    const link = active ? linkRefs.current[active] : null;
    if (!list || !link) return;
    setMarker({ left: link.offsetLeft, width: link.offsetWidth });
  }, [active, isZh]);

  useEffect(() => {
    const onResize = () => {
      const link = active ? linkRefs.current[active] : null;
      if (link) setMarker({ left: link.offsetLeft, width: link.offsetWidth });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [active]);

  const scrollTo = (
    event: React.MouseEvent<HTMLAnchorElement>,
    id: string,
  ) => {
    const capability = id.startsWith("capability-")
      ? id.slice("capability-".length)
      : null;
    if (capability) {
      event.preventDefault();
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#${id}`,
      );
      window.dispatchEvent(
        new CustomEvent("djl:select-capability", {
          detail: { id: capability },
        }),
      );
      return;
    }

    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.to(window, {
      duration: reduce ? 0 : 1.2,
      ease: "power3.inOut",
      scrollTo: { y: `#${id}`, offsetY: 0, autoKill: true },
    });
  };

  const markerVisible = scrolled && Boolean(active);

  return (
    <header className="site-nav" data-scrolled={scrolled} data-revealed={revealed}>
      <div className="site-nav-inner">
        <a
          className="site-nav-brand"
          href="#top"
          aria-label="DJL home"
          onClick={(event) => scrollTo(event, "top")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/djl-logo.png" alt="DJL" />
        </a>

        <nav className="site-nav-links" aria-label="Primary">
          <div className="site-nav-list" ref={listRef}>
            <span
              className="site-nav-marker"
              aria-hidden="true"
              data-visible={markerVisible}
              style={{
                transform: `translateX(${marker.left}px)`,
                width: marker.width,
              }}
            />
            {items.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                ref={(el) => {
                  linkRefs.current[item.id] = el;
                }}
                className={active === item.id ? "active" : ""}
                aria-current={active === item.id ? "true" : undefined}
                onClick={(event) => scrollTo(event, item.id)}
              >
                {item.label}
              </a>
            ))}
          </div>
        </nav>

        <div className="site-nav-actions">
          {/* Real routes, so they stay out of `items` — that list drives the GSAP
              scrollTo and the scroll-spy marker, both of which assume an on-page section. */}
          <a className="site-nav-guide" href={isZh ? "/guide" : "/guide?lang=en"}>
            {isZh ? "指南" : "Guide"}
          </a>
          <a className="site-nav-guide" href={isZh ? "/changelog" : "/changelog?lang=en"}>
            {isZh ? "更新日志" : "Changelog"}
          </a>
          <div className="site-nav-lang" role="group" aria-label="Language">
            <a href="?lang=en" className={isZh ? "" : "active"}>
              EN
            </a>
            <a href="?lang=zh" className={isZh ? "active" : ""}>
              中文
            </a>
          </div>
          <a
            className="key"
            data-variant="primary"
            href="#start"
            onClick={(event) => scrollTo(event, "start")}
          >
            {isZh ? "开始使用" : "Get started"}
          </a>
        </div>
      </div>
    </header>
  );
}
