import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { RemoteDevices } from "./RemoteDevices";

const MotionPlayer = lazy(() => import("./RemoteMotionPlayer"));

function Poster() {
  return (
    <svg viewBox="0 0 840 350" width="100%" aria-hidden="true">
      <RemoteDevices />
      <image href="/djl-logo.png" x="290" y="130" width="80" height="80" />
    </svg>
  );
}

export function RemoteHero() {
  const { t } = useTranslation("settings");
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const stage = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        const onScreen = entry?.isIntersecting ?? false;
        setVisible(onScreen);
        if (onScreen) setSeen(true);
      },
      { threshold: 0.1 },
    );
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  return (
    <header className="remote-hero">
      <div className="remote-eyebrow">
        <span className="remote-eyebrow-dot" />
        DJL <span className="remote-eyebrow-divider" />
        {t("navigation.items.remote.label")}
      </div>
      <div ref={stage} className="remote-stage" data-testid="remote-motion-stage">
        <div className="remote-stage-grid" />
        {seen && !reduced ? (
          <Suspense fallback={<Poster />}>
            <MotionPlayer visible={visible} />
          </Suspense>
        ) : (
          <Poster />
        )}
        <div className="remote-stage-caption">
          <span>{t("remote.design.phoneDevice")}</span>
          <span>{t("remote.design.desktopDevice")}</span>
        </div>
      </div>
      <h1>{t("remote.design.title")}</h1>
      <p className="remote-hero-description">{t("remote.design.description")}</p>
    </header>
  );
}
