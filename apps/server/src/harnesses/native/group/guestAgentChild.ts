// FILE: guestAgentChild.ts
// Purpose: A group member that is answered from a guest's own computer. It looks like any other
//          member's session to the round, but its prompt travels to the guest's DJL app and
//          only text comes back: it has no files, no commands and no approval prompts here.
// Layer: Native harness (group)

import type { GuestAgentHub, GuestAgentTurn } from "../../../groups/guestAgentHub";
import { GUEST_AGENT_OFFLINE } from "../../../groups/guestAgentHub";
import type { ChildReply, ChildSession } from "./childSession";

const NO_WORK = () => ({ files: [], commands: [] });

/**
 * Opens the visiting agent's session. Throws when the agent is not connected, or when `resume`
 * names a session the agent no longer has (it started over), so the round briefs it afresh.
 */
export function openGuestAgentChild(
  hub: GuestAgentHub,
  guestId: string,
  resume: string | null,
): ChildSession {
  const sessionId = hub.session(guestId);
  if (!sessionId) throw new Error(GUEST_AGENT_OFFLINE);
  if (resume && resume !== sessionId) throw new Error("The visiting agent started a new session.");
  let turn: GuestAgentTurn | null = null;
  let lastActivity = Date.now();
  const stop = () => {
    turn?.cancel();
    turn = null;
  };
  return {
    nativeSessionId: sessionId,
    contextUsage: () => null,
    lastActivityAt: () => lastActivity,
    ask: async (prompt, _onRequest, onDraft, onActivity): Promise<ChildReply> => {
      lastActivity = Date.now();
      const current = hub.ask(guestId, prompt, (delta, restart) => {
        lastActivity = Date.now();
        onDraft?.(delta, restart);
        onActivity?.("writing", null);
      });
      turn = current;
      const answer = await current.reply;
      const stopped = turn !== current;
      if (!stopped) turn = null;
      if (stopped) return { status: "stopped", work: NO_WORK() };
      if (answer.status === "failed")
        return { status: "failed", error: answer.error, work: NO_WORK() };
      const text = answer.text.trim();
      return text ? { status: "ok", text, work: NO_WORK() } : { status: "empty", work: NO_WORK() };
    },
    stop: async () => stop(),
    close: stop,
  };
}
