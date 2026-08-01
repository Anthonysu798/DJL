"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { Content, Locale } from "./content";
import { GITHUB_REPOSITORY_URL } from "./lib/githubDesktopDownloads";
import { localeHref } from "./localeHref";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import "./faq-section.css";

gsap.registerPlugin(ScrollTrigger);

export function FaqSection({ t, locale }: { t: Content; locale: Locale }) {
  const faq = t.landing.faq;
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      gsap.from(".lp-faq-intro", {
        y: 24,
        autoAlpha: 0,
        duration: 0.6,
        ease: "power3.out",
        scrollTrigger: { trigger: ".lp-faq-intro", start: "top 80%", once: true },
      });

      gsap.from(".lp-faq-item", {
        y: 20,
        autoAlpha: 0,
        duration: 0.5,
        ease: "power3.out",
        stagger: 0.08,
        scrollTrigger: { trigger: ".lp-faq-list", start: "top 80%", once: true },
      });
    },
    { scope: root },
  );

  return (
    <section id="faq" className="lp-section lp-faq" ref={root}>
      <div className="lp-container lp-faq-grid">
        <div className="lp-faq-intro">
          <p className="lp-eyebrow">{faq.eyebrow}</p>
          <h2 className="lp-faq-title">{faq.title}</h2>
          <p className="lp-faq-support">
            {faq.moreQuestions}{" "}
            <a href={localeHref("/docs", locale)}>{faq.guideLink}</a>
            {" · "}
            <a href={`${GITHUB_REPOSITORY_URL}/issues`} target="_blank" rel="noreferrer">
              {faq.githubLink}
            </a>
          </p>
        </div>

        <Accordion type="single" collapsible className="lp-faq-list">
          {faq.items.map((item, index) => (
            <AccordionItem key={item.q} value={`item-${index}`} className="lp-faq-item">
              <AccordionTrigger className="lp-faq-q">{item.q}</AccordionTrigger>
              <AccordionContent className="lp-faq-a">
                <p>{item.a}</p>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
