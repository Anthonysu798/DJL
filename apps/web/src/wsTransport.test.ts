// FILE: wsTransport.test.ts
// Purpose: Verifies browser WebSocket construction around the Effect RPC transport.
// Layer: Web transport tests
// Depends on: the global WebSocket constructor shim and desktop bridge URL contract.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORCHESTRATION_WS_METHODS, WS_CHANNELS, WS_METHODS } from "@synara/contracts";
import { Effect, Stream } from "effect";

import { shouldKeepServerLifecycleStream, WsTransport } from "./wsTransport";

type WsEventType = "open" | "message" | "close" | "error";
type WsListener = (event?: { data?: unknown }) => void;
type RpcRequestFrame = { _tag: "Request"; id: string; tag: string; payload: unknown };

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

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  failOpen() {
    this.emit("error");
  }

  requests(): RpcRequestFrame[] {
    return this.sent
      .filter((data): data is string => typeof data === "string")
      .map((data) => JSON.parse(data) as RpcRequestFrame)
      .filter((frame) => frame._tag === "Request");
  }

  succeed(request: RpcRequestFrame, value: unknown) {
    this.emit("message", {
      data: JSON.stringify({
        _tag: "Exit",
        requestId: request.id,
        exit: { _tag: "Success", value },
      }),
    });
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
  const shellSnapshot = {
    snapshotSequence: 0,
    projects: [],
    threads: [],
    updatedAt: "2026-10-26T00:00:00.000Z",
  };
  const createProject = {
    type: "project.create",
    commandId: "10c55022-b682-4cdc-b607-bcb07febf51e",
    projectId: "924714c7-1356-43f5-bd18-2935cb0ea69d",
    kind: "chat",
    title: "Home",
    workspaceRoot: "C:\\DJL\\home",
    createdAt: "2026-10-26T00:00:00.000Z",
  };

  it("does not report open merely because the RPC client was constructed", async () => {
    const transport = new WsTransport();
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(sockets[0]?.readyState).toBe(MockWebSocket.CONNECTING);
      expect(transport.getState()).toBe("connecting");
      expect(sockets[0]?.requests()).toEqual([]);
    } finally {
      await transport.dispose();
    }
  });

  it("waits for the real read-only shell handshake before sending the first project create", async () => {
    const transport = new WsTransport();
    const result = transport
      .request(ORCHESTRATION_WS_METHODS.dispatchCommand, { command: createProject })
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    try {
      sockets[0]!.open();
      await vi.waitFor(() => expect(sockets[0]!.requests()).toHaveLength(1));
      const handshake = sockets[0]!.requests()[0]!;
      expect(handshake.tag).toBe(ORCHESTRATION_WS_METHODS.getShellSnapshot);
      expect(transport.getState()).toBe("connecting");

      sockets[0]!.succeed(handshake, shellSnapshot);
      await vi.waitFor(() => expect(sockets[0]!.requests()).toHaveLength(2));
      const mutation = sockets[0]!.requests()[1]!;
      expect(mutation.tag).toBe(ORCHESTRATION_WS_METHODS.dispatchCommand);
      expect(mutation.payload).toEqual(createProject);
      sockets[0]!.succeed(mutation, { sequence: 1 });
      expect(await result).toEqual({ value: { sequence: 1 } });
      expect(transport.getState()).toBe("open");
    } finally {
      await transport.dispose();
      await result;
    }
  });

  it("retries only session preparation after a cold socket failure, not the waiting mutation", async () => {
    const transport = new WsTransport();
    let settled = false;
    const result = transport
      .request(ORCHESTRATION_WS_METHODS.dispatchCommand, { command: createProject })
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      )
      .finally(() => {
        settled = true;
      });
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      sockets[0]!.failOpen();
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(settled).toBe(false);
      expect(sockets.flatMap((socket) => socket.requests())).toEqual([]);

      await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(1), { timeout: 2_000 });
      const recovered = sockets.at(-1)!;
      recovered.open();
      await vi.waitFor(() => expect(recovered.requests()).toHaveLength(1));
      expect(recovered.requests()[0]!.tag).toBe(ORCHESTRATION_WS_METHODS.getShellSnapshot);
      recovered.succeed(recovered.requests()[0]!, shellSnapshot);
      await vi.waitFor(() => expect(recovered.requests()).toHaveLength(2));
      const mutations = sockets
        .flatMap((socket) => socket.requests())
        .filter((frame) => frame.tag === ORCHESTRATION_WS_METHODS.dispatchCommand);
      expect(mutations).toHaveLength(1);
      recovered.succeed(mutations[0]!, { sequence: 1 });
      expect(await result).toEqual({ value: { sequence: 1 } });
    } finally {
      await transport.dispose();
      await result;
    }
  });

  it("does not replay a project create whose socket fails after it was sent", async () => {
    const transport = new WsTransport();
    const result = transport
      .request(ORCHESTRATION_WS_METHODS.dispatchCommand, { command: createProject })
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    try {
      sockets[0]!.open();
      await vi.waitFor(() => expect(sockets[0]!.requests()).toHaveLength(1));
      const handshake = sockets[0]!.requests()[0]!;
      expect(handshake.tag).toBe(ORCHESTRATION_WS_METHODS.getShellSnapshot);
      sockets[0]!.succeed(handshake, shellSnapshot);
      await vi.waitFor(() => expect(sockets[0]!.requests()).toHaveLength(2));
      sockets[0]!.failOpen();
      expect(await result).toHaveProperty("error");
      await new Promise((resolve) => setTimeout(resolve, 600));
      const mutations = sockets
        .flatMap((socket) => socket.requests())
        .filter((frame) => frame.tag === ORCHESTRATION_WS_METHODS.dispatchCommand);
      expect(mutations).toHaveLength(1);
    } finally {
      await transport.dispose();
      await result;
    }
  });

  it("does not open or send a waiting mutation after disposal during the handshake", async () => {
    const transport = new WsTransport();
    const result = transport
      .request(ORCHESTRATION_WS_METHODS.dispatchCommand, { command: createProject })
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    try {
      sockets[0]!.open();
      await vi.waitFor(() => expect(sockets[0]!.requests()).toHaveLength(1));
      const handshake = sockets[0]!.requests()[0]!;
      expect(handshake.tag).toBe(ORCHESTRATION_WS_METHODS.getShellSnapshot);
      await transport.dispose();
      sockets[0]!.succeed(handshake, shellSnapshot);
      expect(await result).toHaveProperty("error");
      expect(transport.getState()).toBe("disposed");
      expect(
        sockets
          .flatMap((socket) => socket.requests())
          .filter((frame) => frame.tag === ORCHESTRATION_WS_METHODS.dispatchCommand),
      ).toEqual([]);
    } finally {
      await transport.dispose();
      await result;
    }
  });

  it("ignores a late old handshake while the replacement session is preparing", async () => {
    const transport = new WsTransport();
    const states = vi.fn();
    transport.onStateChange(states);
    const internal = transport as unknown as { reconnect: () => Promise<unknown> };
    let reconnected: Promise<unknown> | undefined;
    try {
      sockets[0]!.open();
      await vi.waitFor(() => expect(sockets[0]!.requests()).toHaveLength(1));
      const oldSocket = sockets[0]!;
      const oldHandshake = oldSocket.requests()[0]!;
      oldSocket.succeed(oldHandshake, shellSnapshot);
      reconnected = internal.reconnect();
      await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(1), { timeout: 2_000 });
      expect(states).not.toHaveBeenCalledWith("open");

      const current = sockets.at(-1)!;
      current.open();
      await vi.waitFor(() => expect(current.requests()).toHaveLength(1));
      expect(current.requests()[0]!.tag).toBe(ORCHESTRATION_WS_METHODS.getShellSnapshot);
      current.succeed(current.requests()[0]!, shellSnapshot);
      await reconnected;
      expect(states.mock.calls.filter(([state]) => state === "open")).toHaveLength(1);
      expect(transport.getState()).toBe("open");
    } finally {
      await transport.dispose();
      await reconnected?.catch(() => undefined);
    }
  });

  it("does not run a late old-session request on the replacement runtime", async () => {
    const transport = new WsTransport();
    const internal = transport as unknown as {
      sessionVersion: number;
      clientPromise: Promise<unknown>;
      runtime: { runPromise: typeof Effect.runPromise };
    };
    const originalPromise = internal.clientPromise;
    const originalRuntime = internal.runtime;
    const oldCall = vi.fn(() => Effect.succeed("old session"));
    const currentEffect = Effect.succeed("current session");
    const currentCall = vi.fn(() => currentEffect);
    const replacementRun = vi.fn();
    const replacementRuntime = {
      runPromise<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
        replacementRun(effect);
        return Effect.runPromise(effect);
      },
    };
    let releaseOld!: (client: unknown) => void;
    internal.clientPromise = new Promise((resolve) => {
      releaseOld = resolve;
    });
    const result = transport.request("test.session").then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    try {
      internal.sessionVersion += 1;
      internal.runtime = replacementRuntime;
      internal.clientPromise = Promise.resolve({ "test.session": currentCall });
      releaseOld({ "test.session": oldCall });
      const completed = await result;
      expect(oldCall).not.toHaveBeenCalled();
      expect(completed).toEqual({ value: "current session" });
      expect(currentCall).toHaveBeenCalledOnce();
      expect(replacementRun).toHaveBeenCalledExactlyOnceWith(currentEffect);
    } finally {
      internal.runtime = originalRuntime;
      internal.clientPromise = originalPromise;
      await transport.dispose();
      await result;
    }
  });

  it("does not register a channel returned by a superseded client as the current session", async () => {
    const transport = new WsTransport();
    const internal = transport as unknown as {
      sessionVersion: number;
      clientPromise: Promise<unknown>;
      startStream: (...input: readonly unknown[]) => void;
    };
    const originalPromise = internal.clientPromise;
    const oldStream = Stream.never;
    const currentStream = Stream.empty;
    const oldSubscribe = vi.fn(() => oldStream);
    const currentSubscribe = vi.fn(() => currentStream);
    const startStream = vi.spyOn(internal, "startStream").mockImplementation(() => undefined);
    let releaseOld!: (client: unknown) => void;
    internal.clientPromise = new Promise((resolve) => {
      releaseOld = resolve;
    });
    const unsubscribe = transport.subscribe(WS_CHANNELS.serverConfigUpdated, vi.fn());
    try {
      internal.sessionVersion += 1;
      internal.clientPromise = Promise.resolve({
        [WS_METHODS.subscribeServerConfig]: currentSubscribe,
      });
      releaseOld({ [WS_METHODS.subscribeServerConfig]: oldSubscribe });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(oldSubscribe).not.toHaveBeenCalled();
      expect(startStream.mock.calls.some((call) => call[1] === oldStream)).toBe(false);
      expect(currentSubscribe).toHaveBeenCalledOnce();
      expect(startStream).toHaveBeenCalledExactlyOnceWith(
        "server.config",
        currentStream,
        expect.any(Function),
        expect.any(Function),
        expect.objectContaining({
          session: expect.objectContaining({ version: internal.sessionVersion }),
        }),
      );
    } finally {
      unsubscribe();
      internal.clientPromise = originalPromise;
      await transport.dispose();
    }
  });

  it("does not reconnect the current session when an older preparation rejects late", async () => {
    const transport = new WsTransport();
    const internal = transport as unknown as {
      sessionVersion: number;
      clientPromise: Promise<unknown>;
      runtime: { runPromise: typeof Effect.runPromise };
      reconnect: () => Promise<unknown>;
    };
    const originalPromise = internal.clientPromise;
    const originalRuntime = internal.runtime;
    const currentClient = { "test.session": () => Effect.succeed("current session") };
    const reconnect = vi.spyOn(internal, "reconnect").mockResolvedValue(currentClient);
    let rejectOld!: (error: Error) => void;
    internal.clientPromise = new Promise((_resolve, reject) => {
      rejectOld = reject;
    });
    const result = transport.request("test.session").then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    try {
      internal.sessionVersion += 1;
      internal.runtime = { runPromise: Effect.runPromise };
      internal.clientPromise = Promise.resolve(currentClient);
      rejectOld(new Error("old socket failed"));
      expect(await result).toEqual({ value: "current session" });
      expect(reconnect).not.toHaveBeenCalled();
    } finally {
      internal.runtime = originalRuntime;
      internal.clientPromise = originalPromise;
      await transport.dispose();
      await result;
    }
  });

  it("waits for an in-flight reconnect before opening more terminal RPCs", async () => {
    const transport = new WsTransport();
    const internal = transport as unknown as {
      getClient: () => Promise<unknown>;
      clientPromise: Promise<unknown>;
      reconnectPromise: Promise<unknown> | null;
    };
    const previous = internal.clientPromise;
    internal.clientPromise = Promise.resolve({ stale: true });
    let finish!: (value: unknown) => void;
    internal.reconnectPromise = new Promise((resolve) => {
      finish = resolve;
    });
    const requests = Array.from({ length: 10 }, () => internal.getClient());
    const connected = { connected: true };
    finish(connected);
    expect(await Promise.all(requests)).toEqual(Array(10).fill(connected));
    internal.clientPromise = previous;
    internal.reconnectPromise = null;
    await transport.dispose();
  });
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
      expect.objectContaining({ session: expect.objectContaining({ client: expect.any(Object) }) }),
    );

    unsubscribe();
    expect(stopStream).toHaveBeenCalledWith("aiDetector.events");
    await transport.dispose();
  });

  it("reconnects once without adding a second backoff when a subscribed stream ends", async () => {
    const schedule = vi.spyOn(window, "setTimeout");
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
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 0);
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
      sessionVersion: number;
      runtime: unknown;
      reconnect: () => Promise<unknown>;
      startThreadStream: (
        session: {
          version: number;
          client: Record<string, (input: unknown) => Stream.Stream<never>>;
          runtime: unknown;
        },
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

    const session = { version: internal.sessionVersion, client, runtime: internal.runtime };
    internal.startThreadStream(session, input.threadId, input);
    internal.startThreadStream(session, input.threadId, input);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(subscribeThread).toHaveBeenCalledTimes(2);
    expect(reconnect).not.toHaveBeenCalled();
    await transport.dispose();
  });

  it("does not reconnect when a draft thread subscription ends before the thread exists", async () => {
    const transport = new WsTransport();
    const internal = transport as unknown as {
      sessionVersion: number;
      runtime: unknown;
      reconnect: () => Promise<unknown>;
      startThreadStream: (
        session: {
          version: number;
          client: Record<string, (input: unknown) => Stream.Stream<never>>;
          runtime: unknown;
        },
        threadId: string,
        input: unknown,
      ) => void;
    };
    const reconnect = vi.spyOn(internal, "reconnect").mockResolvedValue({});
    const client = {
      "orchestration.subscribeThread": () => Stream.empty,
    };

    const session = { version: internal.sessionVersion, client, runtime: internal.runtime };
    internal.startThreadStream(session, "draft-thread", { threadId: "draft-thread" });

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
