// FILE: groupStore.ts
// Purpose: Live Multi agents state for the renderer: groups, reply records and member states,
//          kept current from the server's group event stream.
// Layer: UI state store
// Exports: useGroupStore, useGroupEvents

import type { Group, GroupEvent, GroupId, GroupMemberState, GroupReply } from "@synara/contracts";
import { useEffect } from "react";
import { create } from "zustand";

import { ensureNativeApi } from "~/nativeApi";

interface GroupStoreState {
  loaded: boolean;
  groups: Record<string, Group>;
  replies: Record<string, GroupReply>;
  memberStates: Record<string, GroupMemberState>;
  applyEvent: (event: GroupEvent) => void;
  reset: () => void;
}

const empty = { loaded: false, groups: {}, replies: {}, memberStates: {} };

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
          };
        case "group.upserted":
          return { groups: { ...state.groups, [event.group.id]: event.group } };
        case "group.deleted": {
          const { [event.groupId]: _removed, ...groups } = state.groups;
          return { groups };
        }
        case "member.state":
          return { memberStates: { ...state.memberStates, [event.memberId]: event.state } };
        case "reply.recorded":
          return { replies: { ...state.replies, [event.reply.replyId]: event.reply } };
      }
    }),
  reset: () => set(empty),
}));

/** Keeps the store subscribed to group events while a Multi agents screen is mounted. */
export function useGroupEvents(): void {
  useEffect(() => {
    const api = ensureNativeApi();
    const { applyEvent } = useGroupStore.getState();
    const unsubscribe = api.groups.onEvent(applyEvent);
    // The stream's own snapshot arrives when the app starts, usually before this screen
    // subscribes, so load the current state explicitly; later events keep it current.
    let active = true;
    void api.groups
      .list()
      .then(({ groups, replies }) => {
        if (active) applyEvent({ type: "snapshot", groups, replies });
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
