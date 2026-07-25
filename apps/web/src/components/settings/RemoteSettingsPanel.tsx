// FILE: RemoteSettingsPanel.tsx
// Purpose: Zero-friction desktop QR pairing and remote access controls.

import type { DesktopRemoteGatewayState } from "@synara/contracts";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";
import { SettingsRow, SettingsSection } from "./SettingsPanelPrimitives";

const STATUS_TONE: Record<DesktopRemoteGatewayState["status"], string> = {
  disabled: "bg-muted-foreground/50",
  unavailable: "bg-amber-500",
  starting: "bg-amber-500",
  ready: "bg-emerald-500",
  connected: "bg-emerald-500",
  offline: "bg-amber-500",
  error: "bg-destructive",
};

// Mirrors the QR payload in DJL iOS's paste-friendly format. It keeps the relay
// and one-time session together, so a first-time Simulator pairing never needs
// to guess a relay from a short code.
export function encodeManualPairingPayload(payloadJson: string): string {
  const bytes = new TextEncoder().encode(payloadJson);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `RMX1:${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

export function RemoteSettingsPanel() {
  const { t } = useTranslation("settings");
  const bridge = window.desktopBridge?.remote;
  const [state, setState] = useState<DesktopRemoteGatewayState | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [isManualPayloadVisible, setIsManualPayloadVisible] = useState(false);
  const [busyAction, setBusyAction] = useState<"toggle" | "refresh" | "reset" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    void bridge.getState().then((nextState) => {
      if (active) setState(nextState);
    });
    const unsubscribe = bridge.onState((nextState) => {
      if (active) setState(nextState);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const payload = state?.pairingPayloadJson;
    if (!payload) {
      setQrDataUrl(null);
      return;
    }
    void QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: "#0a0a0a", light: "#ffffff" },
    }).then(
      (url) => {
        if (active) setQrDataUrl(url);
      },
      () => {
        if (active) setQrDataUrl(null);
      },
    );
    return () => {
      active = false;
    };
  }, [state?.pairingPayloadJson]);

  // A refreshed session invalidates the prior payload, so never leave it expanded
  // while the user is looking at a newly generated QR.
  useEffect(() => {
    setIsManualPayloadVisible(false);
  }, [state?.pairingPayloadJson]);

  const expired = Boolean(state?.pairingExpiresAt && state.pairingExpiresAt <= clock);
  const manualPairingPayload = useMemo(
    () => (state?.pairingPayloadJson ? encodeManualPairingPayload(state.pairingPayloadJson) : ""),
    [state?.pairingPayloadJson],
  );
  const statusLabel = useMemo(
    () => (state ? t(`remote.status.${state.status}`) : t("remote.status.starting")),
    [state, t],
  );
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

  const resetPairing = async () => {
    if (!bridge) return;
    const confirmed = await window.desktopBridge?.confirm(t("remote.reset.confirm"));
    if (!confirmed) return;
    await runAction("reset", () => bridge.resetPairing());
  };

  if (!bridge) return null;

  return (
    <div>
      <SettingsSection title={t("remote.access.sectionTitle")}>
        <SettingsRow
          settingId="remote-access"
          title={t("remote.access.title")}
          description={t("remote.access.description")}
          status={
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn("size-2 rounded-full", STATUS_TONE[state?.status ?? "starting"])}
              />
              {statusLabel}
            </span>
          }
          control={
            <Switch
              aria-label={t("remote.access.toggleAriaLabel")}
              checked={remoteIsConfigured && (state?.enabled ?? false)}
              // A desktop without a relay cannot honor this switch. Keep the
              // unavailable state truthful instead of showing an enabled blue
              // toggle that appears actionable.
              disabled={!remoteIsConfigured || busyAction !== null}
              onCheckedChange={(enabled) =>
                void runAction("toggle", () => bridge.setEnabled(enabled))
              }
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={t("remote.pairing.sectionTitle")}>
        <SettingsRow
          title={
            state?.status === "connected"
              ? t("remote.pairing.connectedTitle")
              : t("remote.pairing.title")
          }
          description={
            state?.status === "connected"
              ? t("remote.pairing.connectedDescription")
              : t("remote.pairing.description")
          }
        >
          <div className="mt-5 flex flex-col items-center gap-4 pb-1">
            {!state?.configured ? (
              <div className="w-full rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm text-muted-foreground">
                {t("remote.unavailable")}
              </div>
            ) : state.status === "connected" ? (
              <div className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/8 px-4 py-4 text-center">
                <div className="text-sm font-medium text-foreground">
                  {t("remote.pairing.phoneConnected")}
                </div>
                {state.phoneFingerprint ? (
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {t("remote.pairing.fingerprint", { fingerprint: state.phoneFingerprint })}
                  </div>
                ) : null}
              </div>
            ) : qrDataUrl && !expired && state.enabled ? (
              <>
                <div className="rounded-[1.25rem] border border-border bg-white p-3">
                  <img
                    src={qrDataUrl}
                    alt={t("remote.pairing.qrAlt")}
                    className="size-64 max-w-full rounded-lg"
                  />
                </div>
                {state.pairingCode ? (
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground">
                      {t("remote.pairing.codeLabel")}
                    </div>
                    <code className="mt-1 block text-base font-semibold tracking-[0.18em] text-foreground">
                      {state.pairingCode}
                    </code>
                  </div>
                ) : null}
                <div className="w-full max-w-md rounded-lg border border-border bg-muted/20 p-3 text-left">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-expanded={isManualPayloadVisible}
                    onClick={() => setIsManualPayloadVisible((visible) => !visible)}
                  >
                    {isManualPayloadVisible
                      ? t("remote.pairing.manualPayloadHide")
                      : t("remote.pairing.manualPayloadShow")}
                  </Button>
                  {isManualPayloadVisible ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {t("remote.pairing.manualPayloadDescription")}
                      </p>
                      <textarea
                        aria-label={t("remote.pairing.manualPayloadAriaLabel")}
                        readOnly
                        spellCheck={false}
                        value={manualPairingPayload}
                        className="h-28 w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-xs leading-relaxed text-foreground"
                      />
                    </div>
                  ) : null}
                </div>
                <p className="max-w-md text-center text-xs leading-relaxed text-muted-foreground">
                  {t("remote.pairing.securityNote")}
                </p>
              </>
            ) : (
              <div className="w-full rounded-lg border border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
                {expired ? t("remote.pairing.expired") : t("remote.pairing.preparing")}
              </div>
            )}

            {state?.message || actionError ? (
              <p className="w-full text-xs text-destructive">{actionError ?? state?.message}</p>
            ) : null}

            <div className="flex w-full flex-wrap justify-end gap-2">
              {state?.status === "connected" ? (
                <Button
                  size="sm"
                  variant="destructive-outline"
                  disabled={busyAction !== null}
                  onClick={() => void resetPairing()}
                >
                  {busyAction === "reset"
                    ? t("remote.actions.disconnecting")
                    : t("remote.actions.pairAnother")}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={!state?.enabled || !state?.configured || busyAction !== null}
                onClick={() => void runAction("refresh", () => bridge.refreshPairing())}
              >
                {busyAction === "refresh"
                  ? t("remote.actions.refreshing")
                  : t("remote.actions.refresh")}
              </Button>
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
