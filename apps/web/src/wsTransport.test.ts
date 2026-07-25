// FILE: wsTransport.test.ts
// Purpose: Verifies browser WebSocket construction around the Effect RPC transport.
// Layer: Web transport tests
// Depends on: the global WebSocket constructor shim and desktop bridge URL contract.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS_CHANNELS, WS_METHODS } from "@synara/contracts";
import { Effect, Stream } from "effect";

import { shouldKeepServerLifecycleStream, WsTransport } from "./wsTransport";

type WsEventType = "open" | "message" | "close" | "error";
type WsListener = (event?: { data?: unknown }) => void;

const sockets: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<WsEventType, Set<WsListener>>();

  constructor(readonly url: string) {
    sockets.push(this);
  }

  addEventListener(type: WsEventType, listener: WsListener) {
    const listeners = this.listeners.get(type) ?? new Set<WsListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: WsEventType, listener: WsListener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: unknown) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }

  private emit(type: WsEventType, event?: { data?: unknown }) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(event);
    }
  }
}

const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  sockets.length = 0;
  vi.stubEnv("VITE_WS_URL", "");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { protocol: "http:", hostname: "localhost", port: "3020" },
      desktopBridge: undefined,
      setTimeout,
      clearTimeout,
    },
  });

  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("WsTransport", () => {
  it("keeps the shared lifecycle stream while either lifecycle channel is active", () => {
    expect(shouldKeepServerLifecycleStream(new Set([WS_CHANNELS.serverWelcome]))).toBe(true);
    expect(shouldKeepServerLifecycleStream(new Set([WS_CHANNELS.serverMaintenanceUpdated]))).toBe(
      true,
    );
    expect(
      shouldKeepServerLifecycleStream(
        new Set([WS_CHANNELS.serverWelcome, WS_CHANNELS.serverMaintenanceUpdated]),
      ),
    ).toBe(true);
    expect(shouldKeepServerLifecycleStream(new Set([WS_CHANNELS.serverConfigUpdated]))).toBe(false);
  });

  it("normalizes explicit websocket URLs to the RPC endpoint", () => {
    const transport = new WsTransport("ws://localhost:3020");

    expect(sockets[0]?.url).toBe("ws://localhost:3020/ws");
    expect(transport.getState()).toBe("connecting");

    transport.dispose();
  });

  it("uses the desktop bridge URL before falling back to the browser location", () => {
    const getWsUrl = vi.fn().mockReturnValue("ws://127.0.0.1:53036/?token=old");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: { protocol: "http:", hostname: "localhost", port: "3020" },
        desktopBridge: { getWsUrl },
      },
    });

    const transport = new WsTransport();

    expect(getWsUrl).toHaveBeenCalledTimes(1);
    expect(sockets[0]?.url).toBe("ws://127.0.0.1:53036/ws?token=old");

    transport.dispose();
  });

  it("falls back to the current browser host when no desktop bridge URL exists", () => {
    const transport = new WsTransport();

    expect(sockets[0]?.url).toBe("ws://localhost:3020/ws");

    transport.dispose();
  });

  it("notifies state listeners and replays the current state on demand", () => {
    const transport = new WsTransport();
    const listener = vi.fn();

    const unsubscribe = transport.onStateChange(listener, { replayCurrent: true });

    expect(listener).toHaveBeenCalledWith("connecting");

    listener.mockClear();
    transport.dispose();

    expect(listener).toHaveBeenCalledWith("disposed");

    listener.mockClear();
    unsubscribe();
    transport.dispose();

    expect(listener).not.toHaveBeenCalled();
  });

  it("shares one awaitable disposal while the managed runtime shuts down", async () => {
    const transport = new WsTransport();

    const disposal = transport.dispose();

    expect(transport.dispose()).toBe(disposal);
    await expect(disposal).resolves.toBeUndefined();
    expect(transport.getState()).toBe("disposed");
  });

  it("starts and stops the AI detector event stream with its first and last listener", async () => {
    const transport = new WsTransport();
    const internal = transport as unknown as {
      getClient: () => Promise<Record<string, (input: unknown) => unknown>>;
      startStream: (...input: readonly unknown[]) => void;
      stopStream: (key: string) => void;
    };
    const stream = Symbol("ai-detector-stream");
    const subscribe = vi.fn(() => stream);
    vi.spyOn(internal, "getClient").mockResolvedValue({
      [WS_METHODS.subscribeAiDetectorEvents]: subscribe,
    });
    const startStream = vi.spyOn(internal, "startStream").mockImplementation(() => undefined);
    const stopStream = vi.spyOn(internal, "stopStream").mockImplementation(() => undefined);

    const unsubscribe = transport.subscribe(WS_CHANNELS.aiDetectorEvent, vi.fn());
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledWith({}));
    expect(startStream).toHaveBeenCalledWith(
      "aiDetector.events",
      stream,
      expect.any(Function),
      expect.any(Function),
    );

    unsubscribe();
    expect(stopStream).toHaveBeenCalledWith("aiDetector.events");
    await transport.dispose();
  });

  it("reconnects once when a subscribed RPC stream ends cleanly", async () => {
    const transport = new WsTransport();
    const internal = transport as unknown as {
      reconnect: () => Promise<unknown>;
      startStream: (
        key: string,
        stream: unknown,
        listener: (event: unknown) => void,
        restart: () => void,
      ) => void;
    };
    const reconnect = vi.spyOn(internal, "reconnect").mockResolvedValue({});
    const restart = vi.fn();

    internal.startStream("test.clean-end", Stream.empty, vi.fn(), restart);

    await vi.waitFor(() => expect(reconnect).toHaveBeenCalledOnce(), { timeout: 2_000 });
    expect(restart).not.toHaveBeenCalled();
    await transport.dispose();
  });

  it("ignores stream exits from a superseded websocket generation", async () => {
    const transport = new WsTransport();
    const internal = transport as unknown as {
      sessionVersion: number;
      reconnect: () => Promise<unknown>;
      startStream: (
        key: string,
        stream: unknown,
        listener: (event: unknown) => void,
        restart: () => void,
      ) => void;
    };
    const reconnect = vi.spyOn(internal, "reconnect").mockResolvedValue({});

    internal.startStream(
      "test.stale-generation",
      Stream.fromEffect(Effect.sleep("20 millis")),
      vi.fn(),
      vi.fn(),
    );
    internal.sessionVersion += 1;

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(reconnect).not.toHaveBeenCalled();
    await transport.dispose();
  });

  it("does not reconnect when a thread subscription is intentionally replaced", async () => {
    const transport = new WsTransport();
    const internal = transport as unknown as {
      reconnect: () => Promise<unknown>;
      startThreadStream: (
        client: Record<string, (input: unknown) => Stream.Stream<never>>,
        threadId: string,
        input: unknown,
      ) => void;
    };
    const reconnect = vi.spyOn(internal, "reconnect").mockResolvedValue({});
    const subscribeThread = vi.fn(() => Stream.fromEffect(Effect.never));
    const client = {
      "orchestration.subscribeThread": subscribeThread,
    };
    const input = { threadId: "thread-1" };

    internal.startThreadStream(client, input.threadId, input);
    internal.startThreadStream(client, input.threadId, input);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(subscribeThread).toHaveBeenCalledTimes(2);
    expect(reconnect).not.toHaveBeenCalled();
    await transport.dispose();
  });

  it("does not reconnect when a draft thread subscription ends before the thread exists", async () => {
    const transport = new WsTransport();
    const internal = transport as unknown as {
      reconnect: () => Promise<unknown>;
      startThreadStream: (
        client: Record<string, (input: unknown) => Stream.Stream<never>>,
        threadId: string,
        input: unknown,
      ) => void;
    };
    const reconnect = vi.spyOn(internal, "reconnect").mockResolvedValue({});
    const client = {
      "orchestration.subscribeThread": () => Stream.empty,
    };

    internal.startThreadStream(client, "draft-thread", { threadId: "draft-thread" });

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(reconnect).not.toHaveBeenCalled();
    await transport.dispose();
  });

  it("honors per-request timeouts without reconnecting the transport", async () => {
    const transport = new WsTransport();
    const internal = transport as unknown as {
      getClient: () => Promise<Record<string, () => Effect.Effect<never>>>;
      reconnect: () => Promise<unknown>;
      runtime: { runPromise: typeof Effect.runPromise };
    };
    const originalRuntime = internal.runtime;
    vi.spyOn(internal, "getClient").mockResolvedValue({
      "test.timeout": () => Effect.never,
    });
    const reconnect = vi.spyOn(internal, "reconnect").mockResolvedValue({});
    internal.runtime = { runPromise: Effect.runPromise };

    await expect(transport.request("test.timeout", {}, { timeoutMs: 20 })).rejects.toThrow(
      "RPC request timed out after 20ms",
    );
    expect(reconnect).not.toHaveBeenCalled();

    internal.runtime = originalRuntime;
    await transport.dispose();
  });

  it("keeps reconnecting when the backend is still unavailable on the first retry", async () => {
    vi.useFakeTimers();
    const transport = new WsTransport();
    const failedRuntime = {
      runPromise: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const successfulRuntime = {
      runPromise: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const client = {};
    const internal = transport as unknown as {
      sessionVersion: number;
      createSession: (sessionVersion: number) => {
        runtime: typeof failedRuntime;
        clientScope: object;
        clientPromise: Promise<object>;
      };
      openReconnectSession: (sessionVersion: number) => Promise<object>;
    };
    const createSession = vi
      .spyOn(internal, "createSession")
      .mockImplementationOnce(() => ({
        runtime: failedRuntime,
        clientScope: {},
        clientPromise: Promise.reject(new Error("backend starting")),
      }))
      .mockReturnValueOnce({
        runtime: successfulRuntime,
        clientScope: {},
        clientPromise: Promise.resolve(client),
      });

    const reconnect = internal.openReconnectSession(internal.sessionVersion);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(reconnect).resolves.toBe(client);
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(failedRuntime.dispose).toHaveBeenCalledOnce();

    vi.useRealTimers();
    await transport.dispose();
  });
});
