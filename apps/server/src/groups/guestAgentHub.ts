// FILE: guestAgentHub.ts
// Purpose: Hands a visiting agent's turns to the guest's computer and collects the answers.
//          The owner's group round asks; the guest's gateway listens, and passes back what the
//          guest's own agent wrote. Kept in memory: a turn that is cut off simply fails.
// Layer: Service helper (no Effect, so the group harness can call it directly)

import {
  GROUP_GUEST_AGENT_PROMPT_LIMIT,
  GROUP_GUEST_AGENT_STALE_MS,
  GROUP_GUEST_AGENT_TEXT_LIMIT,
  type GroupGuestAgentTurnEvent,
} from "@djl/contracts";

export type GuestAgentAnswer =
  | { readonly status: "ok"; readonly text: string }
  | { readonly status: "failed"; readonly error: string };

export interface GuestAgentTurn {
  readonly reply: Promise<GuestAgentAnswer>;
  /** Tells the guest's computer to stop; the reply then resolves as failed. */
  cancel(): void;
}

export interface GuestAgentHub {
  /** The guest's computer announced itself, or said it is still there. */
  seen(guestId: string, sessionId: string): void;
  /** The connected agent's session id; null when it has not been heard from lately. */
  session(guestId: string): string | null;
  /** The guest's gateway takes this guest's turns until it calls the returned function. */
  listen(guestId: string, send: (event: GroupGuestAgentTurnEvent) => void): () => void;
  ask(
    guestId: string,
    prompt: string,
    onDraft?: (delta: string, restart: boolean) => void,
  ): GuestAgentTurn;
  reply(guestId: string, turnId: string, status: "ok" | "failed", text: string): void;
  draft(guestId: string, turnId: string, delta: string, restart: boolean): void;
  /** The guest was removed: forget it and fail what it was asked. */
  forget(guestId: string): void;
  /** Fails the turns of agents that went quiet. Runs on a timer; exposed for tests. */
  sweep(): void;
  /** The guests whose agent is connected right now. */
  online(): string[];
}

export const GUEST_AGENT_OFFLINE = "This visiting agent is not connected right now.";
export const GUEST_AGENT_TOO_LONG =
  "This is too much text to send to a visiting agent. Ask it with a shorter message.";
export const GUEST_AGENT_LEFT = "This visiting agent went offline before it answered.";
const SWEEP_MS = 15_000;

interface Pending {
  readonly guestId: string;
  readonly onDraft: ((delta: string, restart: boolean) => void) | undefined;
  readonly settle: (answer: GuestAgentAnswer) => void;
}

export function makeGuestAgentHub(options?: {
  now?: () => number;
  newId?: () => string;
  /** False in tests, which call `sweep` themselves. */
  timer?: boolean;
  /** Called when an agent connects, and when it is no longer heard from. */
  onPresence?: (guestId: string, online: boolean) => void;
}): GuestAgentHub {
  const now = options?.now ?? Date.now;
  const newId = options?.newId ?? (() => crypto.randomUUID().replaceAll("-", ""));
  const sessions = new Map<string, { sessionId: string; seenAt: number }>();
  const listeners = new Map<string, (event: GroupGuestAgentTurnEvent) => void>();
  const pending = new Map<string, Pending>();

  const session: GuestAgentHub["session"] = (guestId) => {
    const entry = sessions.get(guestId);
    if (!entry || !listeners.has(guestId)) return null;
    return now() - entry.seenAt < GROUP_GUEST_AGENT_STALE_MS ? entry.sessionId : null;
  };

  // What was last reported, so a change is reported once.
  const present = new Set<string>();
  const notePresence = (guestId: string) => {
    const online = session(guestId) !== null;
    if (online === present.has(guestId)) return;
    if (online) present.add(guestId);
    else present.delete(guestId);
    options?.onPresence?.(guestId, online);
  };

  const settle = (turnId: string, answer: GuestAgentAnswer) => {
    const turn = pending.get(turnId);
    if (!turn) return;
    pending.delete(turnId);
    turn.settle(answer);
  };

  const failAll = (guestId: string, error: string) => {
    for (const [turnId, turn] of pending)
      if (turn.guestId === guestId) settle(turnId, { status: "failed", error });
  };

  const sweep = () => {
    for (const guestId of Array.from(present)) notePresence(guestId);
    for (const [turnId, turn] of pending)
      if (session(turn.guestId) === null)
        settle(turnId, { status: "failed", error: GUEST_AGENT_LEFT });
  };
  if (options?.timer !== false) setInterval(sweep, SWEEP_MS).unref();

  return {
    session,
    sweep,
    online: () => [...present].filter((guestId) => session(guestId) !== null),
    seen: (guestId, sessionId) => {
      sessions.set(guestId, { sessionId, seenAt: now() });
      notePresence(guestId);
    },
    listen: (guestId, send) => {
      listeners.set(guestId, send);
      notePresence(guestId);
      return () => {
        if (listeners.get(guestId) !== send) return;
        listeners.delete(guestId);
        notePresence(guestId);
        failAll(guestId, GUEST_AGENT_LEFT);
      };
    },
    ask: (guestId, prompt, onDraft) => {
      const send = listeners.get(guestId);
      if (!send || session(guestId) === null)
        return {
          reply: Promise.resolve({ status: "failed", error: GUEST_AGENT_OFFLINE }),
          cancel: () => {},
        };
      if (prompt.length > GROUP_GUEST_AGENT_PROMPT_LIMIT)
        return {
          reply: Promise.resolve({ status: "failed", error: GUEST_AGENT_TOO_LONG }),
          cancel: () => {},
        };
      const turnId = newId();
      const reply = new Promise<GuestAgentAnswer>((resolve) => {
        pending.set(turnId, { guestId, onDraft, settle: resolve });
      });
      send({ type: "turn", turnId, prompt });
      return {
        reply,
        cancel: () => {
          if (!pending.has(turnId)) return;
          listeners.get(guestId)?.({ type: "cancel", turnId });
          settle(turnId, { status: "failed", error: "Stopped." });
        },
      };
    },
    reply: (guestId, turnId, status, text) => {
      if (pending.get(turnId)?.guestId !== guestId) return;
      const body = text.slice(0, GROUP_GUEST_AGENT_TEXT_LIMIT);
      settle(
        turnId,
        status === "ok"
          ? { status: "ok", text: body }
          : { status: "failed", error: body.trim() || "The visiting agent could not answer." },
      );
    },
    draft: (guestId, turnId, delta, restart) => {
      const turn = pending.get(turnId);
      if (turn?.guestId === guestId) turn.onDraft?.(delta, restart);
    },
    forget: (guestId) => {
      // Best effort: the guest's gateway is closed moments later, and without this their
      // computer could not tell "removed" from "the owner's computer is asleep".
      listeners.get(guestId)?.({ type: "removed" });
      sessions.delete(guestId);
      listeners.delete(guestId);
      notePresence(guestId);
      failAll(guestId, GUEST_AGENT_OFFLINE);
    },
  };
}
