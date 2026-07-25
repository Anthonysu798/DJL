// FILE: remoteGatewayChild.ts
// Purpose: Isolated Node-mode Electron child that owns the DJL remote gateway runtime.

interface GatewayHandle {
  stop(): void;
}

interface GatewayModule {
  startBridge(options: {
    printPairingQr: boolean;
    onPairingSession(session: unknown): void;
    onBridgeStatus(status: unknown): void;
    onDesktopUpdateRequested(): Promise<unknown>;
  }): GatewayHandle;
  resetBridgePairing(): unknown;
}

interface PairingPayload {
  v: number;
  relay: string;
  sessionId: string;
  macDeviceId: string;
  macIdentityPublicKey: string;
  expiresAt: number;
  displayName: string;
}

const gateway = require("@synara/remote-gateway") as GatewayModule;
const UPDATE_TIMEOUT_MS = 60_000;
let updateSequence = 0;
const updateWaiters = new Map<
  string,
  {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

function send(message: unknown): void {
  if (process.connected) process.send?.(message);
}

function sanitizePairingPayload(value: unknown): PairingPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    typeof source.v !== "number" ||
    typeof source.relay !== "string" ||
    typeof source.sessionId !== "string" ||
    typeof source.macDeviceId !== "string" ||
    typeof source.macIdentityPublicKey !== "string" ||
    typeof source.expiresAt !== "number" ||
    typeof source.displayName !== "string"
  ) {
    return null;
  }
  return {
    v: source.v,
    relay: source.relay,
    sessionId: source.sessionId,
    macDeviceId: source.macDeviceId,
    macIdentityPublicKey: source.macIdentityPublicKey,
    expiresAt: source.expiresAt,
    displayName: source.displayName,
  };
}

function sanitizeStatus(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const active =
    source.activeDevice && typeof source.activeDevice === "object"
      ? (source.activeDevice as Record<string, unknown>)
      : null;
  return {
    state: typeof source.state === "string" ? source.state : "running",
    connectionStatus:
      typeof source.connectionStatus === "string" ? source.connectionStatus : "disconnected",
    codexLaunchState:
      typeof source.codexLaunchState === "string" ? source.codexLaunchState : "starting",
    lastError: typeof source.lastError === "string" ? source.lastError : "",
    activeDevice: active
      ? {
          connected: active.connected === true,
          phoneFingerprint:
            typeof active.phoneFingerprint === "string" ? active.phoneFingerprint : null,
          deviceKind: typeof active.deviceKind === "string" ? active.deviceKind : null,
        }
      : null,
  };
}

function requestDesktopUpdate(): Promise<unknown> {
  const requestId = `remote-update-${process.pid}-${++updateSequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      updateWaiters.delete(requestId);
      reject(new Error("DJL Desktop did not answer the remote update request in time."));
    }, UPDATE_TIMEOUT_MS);
    timer.unref();
    updateWaiters.set(requestId, { resolve, reject, timer });
    send({ type: "desktop-update-request", requestId });
  });
}

const bridge = gateway.startBridge({
  printPairingQr: false,
  onPairingSession(session: unknown) {
    const source =
      session && typeof session === "object" ? (session as Record<string, unknown>) : null;
    const pairingPayload = sanitizePairingPayload(source?.pairingPayload);
    if (!pairingPayload) return;
    send({
      type: "pairing",
      pairingPayload,
      pairingCode: typeof source?.pairingCode === "string" ? source.pairingCode : null,
    });
  },
  onBridgeStatus(status: unknown) {
    const sanitized = sanitizeStatus(status);
    if (sanitized) send({ type: "status", status: sanitized });
  },
  onDesktopUpdateRequested: requestDesktopUpdate,
});

process.on("message", (rawMessage: unknown) => {
  if (!rawMessage || typeof rawMessage !== "object") return;
  const message = rawMessage as Record<string, unknown>;
  if (message.type === "desktop-update-result" && typeof message.requestId === "string") {
    const waiter = updateWaiters.get(message.requestId);
    if (!waiter) return;
    updateWaiters.delete(message.requestId);
    clearTimeout(waiter.timer);
    if (typeof message.error === "string" && message.error) {
      waiter.reject(new Error(message.error));
    } else {
      waiter.resolve(message.result);
    }
    return;
  }
  if (message.type !== "reset-pairing") return;
  try {
    gateway.resetBridgePairing();
    send({ type: "reset-complete" });
  } catch (error) {
    send({
      type: "reset-error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    bridge.stop();
    setTimeout(() => process.exit(0), 150).unref();
  }
});
