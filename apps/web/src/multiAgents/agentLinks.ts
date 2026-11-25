// FILE: agentLinks.ts
// Purpose: The agents this computer lends to other people's groups: their live state from the
//          desktop app, and the calls to join a group with an invite code or leave one.
// Layer: Web logic + hooks

import type { DesktopAgentLink, GroupMemberProvider } from "@djl/contracts";
import { useEffect, useSyncExternalStore } from "react";

let links: readonly DesktopAgentLink[] = [];
const listeners = new Set<() => void>();
const setLinks = (next: readonly DesktopAgentLink[]) => {
  links = next;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** True in the desktop app, which is the only place a lent agent can run. */
export const canLendAgents = () => Boolean(window.desktopBridge?.remote.joinGroupAsAgent);

/** Every agent this computer lends, newest last. Follows the desktop app while mounted. */
export function useAgentLinks(): readonly DesktopAgentLink[] {
  useEffect(() => {
    const bridge = window.desktopBridge?.remote;
    if (!bridge?.listAgentLinks) return;
    let active = true;
    void bridge.listAgentLinks().then(
      (next) => {
        if (active) setLinks(next);
      },
      () => undefined,
    );
    const off = bridge.onAgentLinks?.((next) => setLinks(next));
    return () => {
      active = false;
      off?.();
    };
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => links,
    () => links,
  );
}

/** Lends an agent to the group the code belongs to. Rejects with a message to show. */
export async function joinGroupAsAgent(input: {
  code: string;
  provider: GroupMemberProvider;
  model: string | null;
}): Promise<void> {
  const join = window.desktopBridge?.remote.joinGroupAsAgent;
  if (!join) throw new Error("");
  setLinks(await join(input));
}

export async function leaveAgentLink(id: string): Promise<void> {
  const next = await window.desktopBridge?.remote.leaveAgentLink?.(id);
  if (next) setLinks(next);
}

/** Electron prefixes a rejected call's message; this is the part written for the user. */
export function joinErrorText(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "";
  const marker = "Error: ";
  const cut = message.lastIndexOf(marker);
  return (cut >= 0 ? message.slice(cut + marker.length) : message).trim();
}
