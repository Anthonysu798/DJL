import type { TerminalEvent } from "@synara/contracts";
import { readNativeApi } from "~/nativeApi";

type TerminalEventListener = (event: TerminalEvent) => void;
type Listeners = { foreground: Set<TerminalEventListener>; metadata: Set<TerminalEventListener> };
const encoder = new TextEncoder();
const ACK_INTERVAL_MS = 64;
const MAX_ACK_BYTES = 8_388_608;

export class TerminalEventDispatcher {
  private listenersByKey = new Map<string, Listeners>();
  private unsubscribeSharedListener: (() => void) | null = null;
  private pendingAcks = new Map<string, { threadId: string; terminalId: string; bytes: number }>();
  private ackTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(threadId: string, terminalId: string, listener: TerminalEventListener): () => void {
    this.flushAck(`${threadId}::${terminalId}`);
    return this.addListener(threadId, terminalId, listener, "foreground");
  }

  subscribeMetadata(
    threadId: string,
    terminalId: string,
    listener: TerminalEventListener,
  ): () => void {
    return this.addListener(threadId, terminalId, listener, "metadata");
  }

  private addListener(
    threadId: string,
    terminalId: string,
    listener: TerminalEventListener,
    kind: keyof Listeners,
  ) {
    const key = `${threadId}::${terminalId}`;
    let listeners = this.listenersByKey.get(key);
    if (!listeners) {
      listeners = { foreground: new Set(), metadata: new Set() };
      this.listenersByKey.set(key, listeners);
    }
    listeners[kind].add(listener);
    this.ensureSharedListener();
    return () => {
      const current = this.listenersByKey.get(key);
      current?.[kind].delete(listener);
      if (current && current.foreground.size === 0 && current.metadata.size === 0) {
        this.flushAck(key);
        this.listenersByKey.delete(key);
      }
      if (this.listenersByKey.size === 0) {
        this.unsubscribeSharedListener?.();
        this.unsubscribeSharedListener = null;
        if (this.ackTimer !== null) clearTimeout(this.ackTimer);
        this.ackTimer = null;
      }
    };
  }

  private flushAck(key: string) {
    const ack = this.pendingAcks.get(key);
    if (!ack) return;
    this.pendingAcks.delete(key);
    const api = readNativeApi();
    for (let remaining = ack.bytes; remaining > 0; remaining -= MAX_ACK_BYTES) {
      void api?.terminal
        .ackOutput({
          threadId: ack.threadId,
          terminalId: ack.terminalId,
          bytes: Math.min(remaining, MAX_ACK_BYTES),
        })
        .catch(() => undefined);
    }
  }

  private acknowledgeBackgroundOutput(event: Extract<TerminalEvent, { type: "output" }>) {
    const key = `${event.threadId}::${event.terminalId}`;
    const ack = this.pendingAcks.get(key) ?? {
      threadId: event.threadId,
      terminalId: event.terminalId,
      bytes: 0,
    };
    ack.bytes += event.byteLength ?? encoder.encode(event.data).length;
    this.pendingAcks.set(key, ack);
    if (ack.bytes >= 131_072) this.flushAck(key);
    if (this.ackTimer === null)
      this.ackTimer = setTimeout(() => {
        this.ackTimer = null;
        for (const pending of this.pendingAcks.keys()) this.flushAck(pending);
      }, ACK_INTERVAL_MS);
  }

  private ensureSharedListener(): void {
    if (this.unsubscribeSharedListener) return;
    const api = readNativeApi();
    if (!api) return;
    this.unsubscribeSharedListener = api.terminal.onEvent((event) => {
      const listeners = this.listenersByKey.get(`${event.threadId}::${event.terminalId}`);
      if (!listeners) return;
      for (const listener of listeners.foreground) listener(event);
      if (event.type === "output") {
        // The server keeps scrollback and the live screen. Hidden panes need no
        // second parser, but must keep ACKing so background commands never stall.
        if (listeners.foreground.size === 0) this.acknowledgeBackgroundOutput(event);
      } else for (const listener of listeners.metadata) listener(event);
    });
  }
}

export const terminalEventDispatcher = new TerminalEventDispatcher();
