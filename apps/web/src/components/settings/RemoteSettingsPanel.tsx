// FILE: RemoteSettingsPanel.tsx
// Purpose: Zero-friction desktop QR pairing and remote access controls.

import type { DesktopRemoteGatewayState } from "@synara/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { CentralIcon } from "~/lib/central-icons";
import { cn } from "~/lib/utils";
import { settingRowAnchorId } from "~/settingsNavigation";
import { RemoteHero } from "./remote/RemoteHero";
import "./remote/remoteSettings.css";

const STATUS_TONE: Record<DesktopRemoteGatewayState["status"], string> = {
  disabled: "bg-muted-foreground/50",
  unavailable: "bg-amber-500",
  starting: "bg-amber-500",
  ready: "bg-emerald-500",
  connected: "bg-emerald-500",
  offline: "bg-amber-500",
  error: "bg-destructive",
};

export function RemoteSettingsPanel() {
  const { t } = useTranslation("settings");
  const bridge = window.desktopBridge?.remote;
  const [state, setState] = useState<DesktopRemoteGatewayState | null>(null);
  const [qrImage, setQrImage] = useState<{ payload: string; url: string } | null>(null);
  const [qrError, setQrError] = useState(false);
  const [copiedPairingCode, setCopiedPairingCode] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"toggle" | "refresh" | "reset" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    let receivedLiveState = false;
    const unsubscribe = bridge.onState((nextState) => {
      receivedLiveState = true;
      if (active) setState(nextState);
    });
    void bridge.getState().then(
      (nextState) => {
        if (active && !receivedLiveState) setState(nextState);
      },
      () => {
        if (active && !receivedLiveState) setActionError(t("remote.setup.loadError"));
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge, t]);

  useEffect(() => {
    setClock(Date.now());
    if (!state?.enabled || state.status === "connected" || !state.pairingExpiresAt) return;
    const delay = state.pairingExpiresAt - Date.now();
    if (delay <= 0) return;
    const timer = window.setTimeout(() => setClock(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [state?.enabled, state?.status, state?.pairingExpiresAt]);

  useEffect(() => {
    let active = true;
    const payload = state?.pairingPayloadJson;
    setQrError(false);
    if (!payload || !state?.enabled || state.status === "connected") {
      setQrImage(null);
      return;
    }
    void import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(payload, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 320,
          color: { dark: "#0a0a0a", light: "#ffffff" },
        }),
      )
      .then(
        (url) => {
          if (active) setQrImage({ payload, url });
        },
        () => {
          if (active) setQrError(true);
        },
      );
    return () => {
      active = false;
    };
  }, [state?.pairingPayloadJson, state?.enabled, state?.status]);

  const qrDataUrl = qrImage?.payload === state?.pairingPayloadJson ? qrImage?.url : null;
  const expired = Boolean(state?.pairingExpiresAt && state.pairingExpiresAt <= clock);
  const statusLabel = t(`remote.status.${state?.status ?? "starting"}`);
  const remoteIsConfigured = state?.configured === true;

  const runAction = async (
    action: "toggle" | "refresh" | "reset",
    operation: () => Promise<DesktopRemoteGatewayState>,
  ) => {
    setBusyAction(action);
    setActionError(null);
    try {
      setState(await operation());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  const copyPairingCode = async () => {
    const code = state?.pairingCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopiedPairingCode(code);
      setActionError(null);
    } catch {
      setActionError(t("remote.actions.copyFailed"));
    }
  };

  const resetPairing = async () => {
    if (!bridge) return;
    const confirmed = await window.desktopBridge?.confirm(t("remote.reset.confirm"));
    if (!confirmed) return;
    await runAction("reset", () => bridge.resetPairing());
  };

  if (!bridge)
    return <p className="text-sm text-muted-foreground">{t("remote.setup.desktopOnly")}</p>;

  const connected = state?.status === "connected" && state.enabled;
  const enabled = remoteIsConfigured && state?.enabled === true;

  return (
    <div className="remote-settings">
      <RemoteHero />
      <section
        className="remote-access-bar"
        id={settingRowAnchorId("remote-access")}
        aria-labelledby="remote-access-heading"
      >
        <div className="remote-access-symbol">
          <CentralIcon name="phone-haptic" className="size-5" />
        </div>
        <div className="remote-access-copy">
          <h2 id="remote-access-heading">{t("remote.access.sectionTitle")}</h2>
          <span role="status" className="remote-status">
            <span
              className={cn("size-1.5 rounded-full", STATUS_TONE[state?.status ?? "starting"])}
            />
            {statusLabel}
          </span>
        </div>
        <Switch
          aria-label={t("remote.access.toggleAriaLabel")}
          checked={enabled}
          disabled={!remoteIsConfigured || busyAction !== null}
          onCheckedChange={(next) => void runAction("toggle", () => bridge.setEnabled(next))}
        />
      </section>

      <section className="remote-pairing" aria-labelledby="remote-pairing-heading">
        <div className="remote-guide">
          <span className="remote-section-label">{t("remote.design.setupLabel")}</span>
          <h2 id="remote-pairing-heading">
            {connected ? t("remote.pairing.connectedTitle") : t("remote.pairing.title")}
          </h2>
          <p className="remote-guide-description">
            {connected ? t("remote.pairing.connectedDescription") : t("remote.pairing.description")}
          </p>
          <ol className="remote-steps">
            {(
              [
                ["remote.design.stepEnable", "remote.setup.enable"],
                ["remote.pairing.title", "remote.setup.scan"],
                ["remote.setup.workTitle", "remote.setup.work"],
              ] as const
            ).map(([title, description], index) => {
              const complete = index === 0 ? enabled : connected;
              const active = !connected && (enabled ? index === 1 : index === 0);
              return (
                <li
                  key={title}
                  data-complete={complete || undefined}
                  data-active={active || undefined}
                >
                  <span className="remote-step-marker" aria-hidden="true">
                    {complete ? (
                      <svg viewBox="0 0 16 16">
                        <path d="m4 8 3 3 5-6" />
                      </svg>
                    ) : (
                      index + 1
                    )}
                  </span>
                  <div>
                    <h3>{t(title)}</h3>
                    <p>{t(description)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="remote-pairing-surface" aria-busy={busyAction !== null}>
          <div className="remote-computer-label">
            <svg
              viewBox="0 0 20 20"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              aria-hidden="true"
            >
              <rect x="4" y="3" width="12" height="10" rx="1.5" />
              <path d="M2 15h16l-1 2H3Z" />
            </svg>
            <span>{state?.computerName ?? t("remote.pairing.sectionTitle")}</span>
          </div>
          <div
            className="remote-qr-stage"
            key={connected ? "connected" : state?.enabled ? "enabled" : "disabled"}
          >
            {!state ? (
              <p className="remote-empty-state">{t("remote.status.starting")}</p>
            ) : !state.configured ? (
              <p className="remote-empty-state">{t("remote.unavailable")}</p>
            ) : !state.enabled ? (
              <div className="remote-empty-state">
                <CentralIcon name="phone-haptic" className="mx-auto mb-4 size-8 opacity-40" />
                <p>{t("remote.setup.disabled")}</p>
              </div>
            ) : connected ? (
              <div className="remote-connected">
                <div className="remote-connected-icon">
                  <svg viewBox="0 0 32 32" aria-hidden="true">
                    <path d="m9 16 5 5 10-12" />
                  </svg>
                </div>
                <h3>{t("remote.pairing.phoneConnected")}</h3>
                {state.phoneFingerprint ? (
                  <p className="remote-fingerprint">
                    {t("remote.pairing.fingerprint", { fingerprint: state.phoneFingerprint })}
                  </p>
                ) : null}
              </div>
            ) : qrDataUrl && !expired ? (
              <div className="remote-qr-frame">
                <img src={qrDataUrl} alt={t("remote.pairing.qrAlt")} width={224} height={224} />
              </div>
            ) : (
              <p className="remote-empty-state">
                {expired
                  ? t("remote.pairing.expired")
                  : qrError
                    ? t("remote.setup.qrError")
                    : state.status === "offline" || state.status === "error"
                      ? statusLabel
                      : t("remote.pairing.preparing")}
              </p>
            )}
          </div>

          {!connected && enabled && qrDataUrl && !expired ? (
            <>
              {state?.pairingCode ? (
                <div className="remote-pairing-code">
                  <span>{t("remote.pairing.codeLabel")}</span>
                  <code>{state.pairingCode}</code>
                </div>
              ) : null}
              <button
                type="button"
                className="remote-copy-trigger"
                disabled={!state?.pairingCode}
                onClick={() => void copyPairingCode()}
              >
                {copiedPairingCode === state?.pairingCode
                  ? t("remote.actions.copiedCode")
                  : t("remote.actions.copyCode")}
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="5" y="5" width="8" height="8" rx="2" />
                  <path d="M10 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
                </svg>
              </button>
            </>
          ) : null}

          {state?.message || actionError ? (
            <p role="alert" className="remote-action-error">
              {actionError ?? state?.message}
            </p>
          ) : null}
          <div className="remote-pairing-actions">
            {connected ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busyAction !== null}
                onClick={() => void resetPairing()}
              >
                {busyAction === "reset"
                  ? t("remote.actions.disconnecting")
                  : t("remote.actions.pairAnother")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={!enabled || busyAction !== null}
                onClick={() => void runAction("refresh", () => bridge.refreshPairing())}
              >
                <svg
                  viewBox="0 0 16 16"
                  className={cn("size-3.5", busyAction === "refresh" && "remote-refreshing")}
                  aria-hidden="true"
                >
                  <path
                    d="M3 6a5 5 0 1 1 0 5M3 2v4h4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {busyAction === "refresh"
                  ? t("remote.actions.refreshing")
                  : t("remote.actions.refresh")}
              </Button>
            )}
          </div>
        </div>
      </section>
      <p className="remote-security">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1.5 13 3v4.5c0 3-5 6.5-5 6.5S3 10.5 3 7.5V3Z" />
          <path d="m5.5 7.5 1.5 1.5 3-3" />
        </svg>
        {t("remote.pairing.securityNote")}
      </p>
    </div>
  );
}
