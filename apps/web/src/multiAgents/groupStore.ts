// FILE: groupStore.ts
// Purpose: Live Multi agents state for the renderer: groups, reply records, member states and
//          the text each busy member is writing, kept current from the server's group event
//          stream.
// Layer: UI state store
// Exports: useGroupStore, useGroupEvents, batchDrafts

import type { Group, GroupEvent, GroupId, GroupMemberState, GroupReply } from "@djl/contracts";
import { useEffect } from "react";
import { create } from "zustand";

import { ensureNativeApi } from "~/nativeApi";

interface GroupStoreState {
  loaded: boolean;
  groups: Record<string, Group>;
  replies: Record<string, GroupReply>;
  memberStates: Record<string, GroupMemberState>;
  /** The text each busy member has written so far in its current reply. */
  drafts: Record<string, string>;
  applyEvent: (event: GroupEvent) => void;
  reset: () => void;
}

const empty = { loaded: false, groups: {}, replies: {}, memberStates: {}, drafts: {} };

const without = (drafts: Record<string, string>, memberId: string) => {
  const { [memberId]: _removed, ...rest } = drafts;
  return rest;
};

export const useGroupStore = create<GroupStoreState>()((set) => ({
  ...empty,
  applyEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case "snapshot":
          return {
            loaded: true,
            groups: Object.fromEntries(event.groups.map((group) => [group.id, group])),
            replies: Object.fromEntries(event.replies.map((reply) => [reply.replyId, reply])),
            ...(event.live
              ? { memberStates: event.live.memberStates, drafts: event.live.drafts }
              : {}),
          };
        case "group.upserted":
          return { groups: { ...state.groups, [event.group.id]: event.group } };
        case "group.deleted": {
          const { [event.groupId]: _removed, ...groups } = state.groups;
          return { groups };
        }
        case "member.state":
          return {
            memberStates: { ...state.memberStates, [event.memberId]: event.state },
            ...(event.state === "working" || event.state === "waiting"
              ? {}
              : { drafts: without(state.drafts, event.memberId) }),
          };
        case "reply.recorded":
          return {
            replies: { ...state.replies, [event.reply.replyId]: event.reply },
            drafts: without(state.drafts, event.reply.memberId),
          };
        case "reply.draft":
          return {
            drafts: {
              ...state.drafts,
              [event.memberId]: event.restart
                ? event.delta
                : (state.drafts[event.memberId] ?? "") + event.delta,
            },
          };
      }
    }),
  reset: () => set(empty),
}));

/**
 * Passes events on in order, holding draft pieces back so a burst of them becomes one update
 * per member per animation frame.
 */
export function batchDrafts(apply: (event: GroupEvent) => void): (event: GroupEvent) => void {
  const pending = new Map<string, Extract<GroupEvent, { type: "reply.draft" }>>();
  let frame: number | null = null;
  const flush = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    for (const draft of pending.values()) apply(draft);
    pending.clear();
  };
  return (event) => {
    if (event.type !== "reply.draft") {
      flush();
      apply(event);
      return;
    }
    const earlier = pending.get(event.memberId);
    pending.set(
      event.memberId,
      earlier && !event.restart ? { ...earlier, delta: earlier.delta + event.delta } : event,
    );
    frame ??= requestAnimationFrame(flush);
  };
}

/** Keeps the store subscribed to group events while a Multi agents screen is mounted. */
export function useGroupEvents(): void {
  useEffect(() => {
    const api = ensureNativeApi();
    const applyEvent = batchDrafts(useGroupStore.getState().applyEvent);
    const unsubscribe = api.groups.onEvent(applyEvent);
    // The stream's own snapshot arrives when the app starts, usually before this screen
    // subscribes, so load the current state explicitly; later events keep it current.
    let active = true;
    void api.groups
      .list()
      .then((result) => {
        if (active) applyEvent({ type: "snapshot", ...result });
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
}

export function selectGroup(groupId: GroupId | null | undefined) {
  return (state: GroupStoreState) => (groupId ? state.groups[groupId] : undefined);
}
