"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const items = t.nav;

  const listRef = useRef<HTMLDivElement>(null);
  const linkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string>("");
  const [marker, setMarker] = useState({ left: 0, width: 0 });
  const [revealed, setRevealed] = useState(false);

  // Stay hidden during the hero splash; reveal once the intro signals it's done.
  useEffect(() => {
    if ((window as unknown as { __djlIntroDone?: boolean }).__djlIntroDone) {
      setRevealed(true);
      return;
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
    const update = () => {
      const past = window.scrollY > window.innerHeight * 0.5;
      setScrolled(past);
      if (!past) {
        setActive("");
        return;
      }
      const line = window.innerHeight * 0.4;
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
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        update();
        ticking = false;
      });
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [items]);

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

  const scrollTo = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
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
          <div className="site-nav-lang" role="group" aria-label="Language">
            <a href="?lang=en" className={isZh ? "" : "active"}>
              EN
            </a>
            <a href="?lang=zh" className={isZh ? "active" : ""}>
              中文
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
