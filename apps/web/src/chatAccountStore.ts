// FILE: chatAccountStore.ts
// Purpose: Which Claude Code / Codex subscription account each chat uses, chosen in the model
//          picker or moved by an automatic switch when an account hit its limit. Chats without
//          an entry use the app-wide account from Settings → Accounts.
// Layer: Web state (persisted locally; the server resolves ids to account folders).

import type { CliAccountProvider } from "@djl/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const MAX_THREADS = 500;

export interface ChatAccountChoice {
  readonly id: string;
  /** When it was chosen (ms), so a newer automatic switch can override an older pick. */
  readonly at: number;
}

interface ChatAccountState {
  byThread: Record<string, Partial<Record<CliAccountProvider, ChatAccountChoice>>>;
  setAccount: (threadId: string, provider: CliAccountProvider, id: string, at?: number) => void;
}

export const useChatAccountStore = create<ChatAccountState>()(
  persist(
    (set) => ({
      byThread: {},
      setAccount: (threadId, provider, id, at = Date.now()) =>
        set((state) => {
          const entries = Object.entries({
            ...state.byThread,
            [threadId]: { ...state.byThread[threadId], [provider]: { id, at } },
          });
          // Keep the newest chats only.
          const kept = entries
            .toSorted(
              ([, a], [, b]) =>
                Math.max(...Object.values(b).map((c) => c?.at ?? 0)) -
                Math.max(...Object.values(a).map((c) => c?.at ?? 0)),
            )
            .slice(0, MAX_THREADS);
          return { byThread: Object.fromEntries(kept) };
        }),
    }),
    { name: "djl:chat-accounts:v1", storage: createJSONStorage(() => localStorage) },
  ),
);
