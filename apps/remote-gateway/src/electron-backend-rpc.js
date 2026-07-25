// FILE: electron-backend-rpc.js
// Purpose: Minimal authenticated client for DJL Electron's Effect RPC WebSocket.
// Layer: CLI helper
// Exports: createElectronBackendRpcClient, normalizeElectronBackendEndpoint
// Depends on: ws

const WebSocket = require("ws");

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const RECONNECT_DELAY_MS = 750;

// Electron exposes its renderer URL at the origin root. The Effect RPC server
// deliberately lives at /ws, while retaining the one-time loopback token in
// the query string. Keeping that conversion here prevents a relay-facing
// caller from ever learning the backend capability URL.
function normalizeElectronBackendEndpoint(endpoint) {
  const url = new URL(endpoint);
  url.pathname = "/ws";
  return url.toString();
}

function createElectronBackendRpcClient({
  endpoint,
  WebSocketImpl = WebSocket,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  reconnectDelayMs = RECONNECT_DELAY_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  diagnostics = process.env.DJL_ELECTRON_BRIDGE_DIAGNOSTICS === "1",
} = {}) {
  if (typeof endpoint !== "string" || endpoint.trim().length === 0) {
    throw new Error("DJL Electron backend endpoint is required.");
  }

  const target = normalizeElectronBackendEndpoint(endpoint.trim());
  const listeners = createListenerBag();
  const pending = new Map();
  const streams = new Map();
  const subscriptions = new Map();
  let socket = null;
  let reconnectTimer = null;
  let intentionalClose = false;
  let requestSequence = 0;

  connect();

  function connect() {
    if (intentionalClose || socket) return;
    const nextSocket = new WebSocketImpl(target);
    socket = nextSocket;
    const openState = WebSocketImpl.OPEN ?? WebSocket.OPEN ?? 1;

    nextSocket.on("open", () => {
      if (socket !== nextSocket) return;
      logDiagnostic(diagnostics, "backend-socket-open");
      for (const [requestId, entry] of pending) {
        sendRequest(entry.tag, entry.payload, requestId);
      }
      for (const entry of subscriptions.values()) {
        startSubscription(entry);
      }
      listeners.emitStarted({
        mode: "djl-electron",
        launchDescription: "DJL Electron embedded backend",
      });
    });
    nextSocket.on("message", (chunk) => {
      if (socket !== nextSocket) return;
      const raw = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      handleInbound(message, nextSocket, openState);
    });
    nextSocket.on("error", (error) => {
      // Electron may start after the embedded gateway. This is a normal
      // startup ordering race, so retry instead of crashing the phone bridge.
      logDiagnostic(diagnostics, "backend-socket-error", error);
    });
    nextSocket.on("close", (code, reason) => {
      if (socket !== nextSocket) return;
      logDiagnostic(
        diagnostics,
        `backend-socket-close code=${String(code)}`,
        reason?.toString("utf8") || null,
      );
      socket = null;
      for (const entry of streams.values()) {
        entry.requestId = null;
      }
      streams.clear();
      listeners.emitClose(code, reason?.toString("utf8") || "closed");
      if (!intentionalClose) scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer || intentionalClose) return;
    reconnectTimer = setTimeoutImpl(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
    reconnectTimer.unref?.();
  }

  function handleInbound(message, activeSocket, openState) {
    if (!message || typeof message !== "object") return;
    if (message._tag === "Pong") return;
    if (message._tag === "Chunk") {
      const entry = streams.get(String(message.requestId));
      if (!entry) return;
      try {
        entry.onChunk(Array.isArray(message.values) ? message.values : [message.values]);
      } catch {
        // A consumer exception must never terminate the encrypted bridge.
      }
      if (activeSocket.readyState === openState) {
        activeSocket.send(
          JSON.stringify({
            _tag: "Ack",
            requestId: String(message.requestId),
          }),
        );
      }
      return;
    }
    if (message._tag !== "Exit") return;
    logDiagnostic(diagnostics, `backend-exit=${String(message.exit?._tag || "unknown")}`);
    const requestId = String(message.requestId);
    const request = pending.get(requestId);
    if (request) {
      pending.delete(requestId);
      clearTimeoutImpl(request.timer);
      if (message.exit?._tag === "Success") {
        request.resolve(message.exit.value);
      } else {
        request.reject(new Error(readFailureMessage(message.exit)));
      }
    }
    const stream = streams.get(requestId);
    if (stream) {
      streams.delete(requestId);
      subscriptions.delete(stream.subscriptionId);
      stream.requestId = null;
      if (message.exit?._tag === "Failure") {
        stream.onError?.(new Error(readFailureMessage(message.exit)));
      } else {
        stream.onEnd?.();
      }
    }
  }

  function nextRequestId() {
    requestSequence += 1;
    return String(requestSequence);
  }

  function sendRequest(tag, payload, requestId) {
    const openState = WebSocketImpl.OPEN ?? WebSocket.OPEN ?? 1;
    if (!socket || socket.readyState !== openState) {
      throw new Error("DJL Electron backend is reconnecting.");
    }
    socket.send(
      JSON.stringify({
        _tag: "Request",
        id: requestId,
        tag,
        payload: payload == null ? {} : payload,
        headers: [],
      }),
    );
  }

  function startSubscription(entry) {
    const requestId = nextRequestId();
    entry.requestId = requestId;
    streams.set(requestId, entry);
    sendRequest(entry.tag, entry.payload, requestId);
  }

  return {
    mode: "djl-electron",
    describe() {
      return "DJL Electron embedded backend";
    },
    request(tag, payload = {}) {
      const requestId = nextRequestId();
      return new Promise((resolve, reject) => {
        const timer = setTimeoutImpl(() => {
          pending.delete(requestId);
          reject(new Error(`DJL Electron request timed out: ${tag}`));
        }, requestTimeoutMs);
        pending.set(requestId, { tag, payload, resolve, reject, timer });
        try {
          sendRequest(tag, payload, requestId);
        } catch (error) {
          // Keep the request pending while the reconnect timer is active. The
          // same Effect-RPC request is resent after open; orchestration writes
          // remain safe because their command IDs are stable and persisted.
          if (!reconnectTimer && !socket) scheduleReconnect();
        }
      });
    },
    subscribe(tag, payload, { onChunk, onEnd, onError } = {}) {
      const subscriptionId = nextRequestId();
      const entry = {
        subscriptionId,
        requestId: null,
        tag,
        payload,
        onChunk: onChunk || (() => {}),
        onEnd,
        onError,
      };
      subscriptions.set(subscriptionId, entry);
      try {
        startSubscription(entry);
      } catch (error) {
        if (entry.requestId) streams.delete(entry.requestId);
        entry.requestId = null;
        if (!reconnectTimer && !socket) scheduleReconnect();
      }
      return () => {
        subscriptions.delete(subscriptionId);
        const requestId = entry.requestId;
        if (requestId) streams.delete(requestId);
        const openState = WebSocketImpl.OPEN ?? WebSocket.OPEN ?? 1;
        if (requestId && socket?.readyState === openState) {
          socket.send(JSON.stringify({ _tag: "Interrupt", requestId }));
        }
        entry.requestId = null;
      };
    },
    onMessage(handler) {
      listeners.onMessage = handler;
    },
    onClose(handler) {
      listeners.onClose = handler;
    },
    onError(handler) {
      listeners.onError = handler;
    },
    onStarted(handler) {
      listeners.onStarted = handler;
    },
    shutdown() {
      intentionalClose = true;
      if (reconnectTimer) {
        clearTimeoutImpl(reconnectTimer);
        reconnectTimer = null;
      }
      subscriptions.clear();
      streams.clear();
      for (const entry of pending.values()) {
        clearTimeoutImpl(entry.timer);
        entry.reject(new Error("DJL Electron backend client stopped."));
      }
      pending.clear();
      const connectingState = WebSocketImpl.CONNECTING ?? WebSocket.CONNECTING ?? 0;
      const openState = WebSocketImpl.OPEN ?? WebSocket.OPEN ?? 1;
      if (socket && (socket.readyState === connectingState || socket.readyState === openState)) {
        socket.close();
      }
    },
  };
}

function readFailureMessage(exit) {
  const causes = Array.isArray(exit?.cause) ? exit.cause : [];
  const first = causes[0];
  if (typeof first?.failure?.message === "string") return first.failure.message;
  if (typeof first?.defect?.message === "string") return first.defect.message;
  if (typeof first?.defect === "string") return first.defect;
  return "DJL Electron backend request failed.";
}

function createListenerBag() {
  return {
    onMessage: null,
    onClose: null,
    onError: null,
    onStarted: null,
    emitMessage(message) {
      this.onMessage?.(message);
    },
    emitClose(...args) {
      this.onClose?.(...args);
    },
    emitError(error) {
      this.onError?.(error);
    },
    emitStarted(info) {
      this.onStarted?.(info);
    },
  };
}

// Emits only socket lifecycle metadata when explicitly enabled for a local
// diagnostic run. The endpoint (which contains the loopback capability) and
// every RPC payload remain deliberately absent.
function logDiagnostic(enabled, event, error = null) {
  if (!enabled) return;
  const reason = error instanceof Error ? error.message : String(error || "");
  const suffix = reason ? ` reason=${reason.slice(0, 180)}` : "";
  console.warn(`[djl-electron-bridge] ${event}${suffix}`);
}

module.exports = {
  createElectronBackendRpcClient,
  normalizeElectronBackendEndpoint,
};
