"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { ChatClient } from "./client";
import { type ChatState, ChatStore } from "./store";

const Ctx = createContext<{ store: ChatStore; client: ChatClient } | null>(null);

export function ChatProvider({ client, children }: { client: ChatClient; children: ReactNode }) {
  const [value] = useState(() => ({ store: new ChatStore(client), client }));
  useEffect(() => {
    void value.store.init();
    return () => value.store.dispose();
  }, [value]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useCtx() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("ChatProvider is missing");
  return ctx;
}

export const useChatStore = () => useCtx().store;
export const useChatClient = () => useCtx().client;

/** Subscribes to a slice of chat state. Keep selectors returning stable references. */
export function useChat<T>(selector: (state: ChatState) => T): T {
  const store = useChatStore();
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}
