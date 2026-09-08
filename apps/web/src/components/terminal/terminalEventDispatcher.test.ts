import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalEvent } from "@synara/contracts";
const api = vi.hoisted(() => ({
  listener: null as ((e: TerminalEvent) => void) | null,
  ack: vi.fn(async () => {}),
}));
vi.mock("~/nativeApi", () => ({
  readNativeApi: () => ({
    terminal: {
      onEvent: (listener: (e: TerminalEvent) => void) => {
        api.listener = listener;
        return () => {
          api.listener = null;
        };
      },
      ackOutput: api.ack,
    },
  }),
}));
import { TerminalEventDispatcher } from "./terminalEventDispatcher";
const output: TerminalEvent = {
  type: "output",
  threadId: "w",
  terminalId: "t",
  data: "hello",
  byteLength: 5,
  createdAt: "now",
};
beforeEach(() => {
  vi.clearAllMocks();
});
describe("background terminal output", () => {
  it("batches acknowledgements without sending hidden output into a renderer", async () => {
    vi.useFakeTimers();
    const dispatcher = new TerminalEventDispatcher();
    const metadata = vi.fn();
    const release = dispatcher.subscribeMetadata("w", "t", metadata);
    for (let i = 0; i < 100; i++) api.listener!(output);
    expect(metadata).not.toHaveBeenCalled();
    expect(api.ack).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(64);
    expect(api.ack).toHaveBeenCalledExactlyOnceWith({ threadId: "w", terminalId: "t", bytes: 500 });
    release();
    vi.useRealTimers();
  });
  it("leaves foreground ACK ownership to xterm and forwards exit/activity metadata", () => {
    const dispatcher = new TerminalEventDispatcher();
    const foreground = vi.fn(),
      metadata = vi.fn();
    const a = dispatcher.subscribeMetadata("w", "t", metadata),
      b = dispatcher.subscribe("w", "t", foreground);
    api.listener!(output);
    expect(foreground).toHaveBeenCalledWith(output);
    expect(api.ack).not.toHaveBeenCalled();
    const exited: TerminalEvent = {
      type: "exited",
      threadId: "w",
      terminalId: "t",
      createdAt: "now",
      exitCode: 0,
      exitSignal: null,
    };
    api.listener!(exited);
    expect(metadata).toHaveBeenCalledWith(exited);
    b();
    a();
    expect(api.listener).toBeNull();
  });
});
