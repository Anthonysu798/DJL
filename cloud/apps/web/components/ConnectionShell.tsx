"use client";

import { ArrowUpRight, CircleAlert, LoaderCircle, LockKeyhole, Monitor, X } from "lucide-react";
import { IconBrandInstagram, IconBrandTiktok } from "@tabler/icons-react";
import Image from "next/image";
import { DJL_NATIVE_OPEN_URI } from "@djl/contracts/cloud";
import type { ReactNode } from "react";

import FadeContent from "@/components/react-bits/FadeContent";
import { DjlLogo } from "@/components/DjlLogo";
import SpotlightCard from "@/components/react-bits/SpotlightCard";
import { ThemeToggle, useTheme } from "@/components/theme";
import { useLocale } from "@/lib/locale-context";

import "./connection.css";

type ConnectionState = "ready" | "working" | "connected" | "failed" | "denied";

/** Decorative only: the adjacent heading/status supplies the actual server state. */
function ConnectionIllustration({
  state,
  provider,
}: {
  state: ConnectionState;
  provider?: "instagram" | "tiktok" | undefined;
}) {
  const PlatformIcon = provider === "instagram" ? IconBrandInstagram : IconBrandTiktok;
  const StatusIcon =
    state === "working"
      ? LoaderCircle
      : state === "failed"
        ? CircleAlert
        : state === "denied"
          ? X
          : null;
  return (
    <div className="connection-illustration" data-state={state} aria-hidden="true">
      <Image
        className="connection-artwork"
        src={
          provider
            ? "/illustrations/connections/social-connection-v2.png"
            : "/illustrations/connections/device-connection-v2.png"
        }
        alt=""
        width={1536}
        height={1024}
        sizes="(max-width: 520px) 290px, 340px"
        loading="eager"
      />
      <div className="connection-brand-pair">
        <DjlLogo className="size-7" />
        <span className="connection-brand-bridge" />
        {provider ? (
          <PlatformIcon className="connection-platform-icon" size={25} stroke={1.6} />
        ) : (
          <Monitor size={25} strokeWidth={1.5} />
        )}
        {StatusIcon && (
          <StatusIcon size={14} className={state === "working" ? "connection-spin" : ""} />
        )}
      </div>
    </div>
  );
}

export function ConnectionShell({
  children,
  title,
  description,
  state = "ready",
  provider,
}: {
  children: ReactNode;
  title: string;
  description?: string | undefined;
  state?: ConnectionState;
  provider?: "instagram" | "tiktok";
}) {
  const { theme } = useTheme();
  const { d } = useLocale();
  return (
    <div className="connection-page">
      <header className="connection-header">
        <a href="https://slcor.com" className="connection-brand" aria-label="DJL">
          DJL
          <span />
        </a>
        <ThemeToggle />
      </header>
      <main className="connection-main">
        <FadeContent trigger="mount" duration={0.55} blur={3} className="connection-reveal">
          <SpotlightCard
            className="connection-card"
            theme={theme}
            spotlightColor="#a79bfa"
            intensity={0.12}
            borderGlow={0.5}
            proximity={40}
            flare={false}
          >
            <ConnectionIllustration state={state} provider={provider} />
            <div className="connection-content">
              <h1>{title}</h1>
              {description && <p className="connection-description">{description}</p>}
              {children}
            </div>
          </SpotlightCard>
        </FadeContent>
        <p className="connection-footer">
          <LockKeyhole size={13} aria-hidden="true" />
          {d.connectionUi.footer}
        </p>
      </main>
      <footer className="connection-page-footer">
        <span>DJL</span>
        <a href="mailto:support@slcor.com">{d.connectionUi.help}</a>
      </footer>
    </div>
  );
}

export function OpenDjl() {
  const { d } = useLocale();
  return (
    <div className="connection-actions">
      <a className="connection-primary" href={DJL_NATIVE_OPEN_URI}>
        {d.connectionUi.open}
        <ArrowUpRight size={17} aria-hidden="true" />
      </a>
      <p className="connection-note">{d.connectionUi.returnHint}</p>
    </div>
  );
}
