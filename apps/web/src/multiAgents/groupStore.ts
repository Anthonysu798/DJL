// FILE: groupStore.ts
// Purpose: Live Multi agents state for the renderer: groups, reply records, member states and
//          the text each busy member is writing, kept current from the server's group event
//          stream.
// Layer: UI state store
// Exports: useGroupStore, useGroupEvents, batchDrafts

import type {
  Group,
  GroupEvent,
  GroupId,
  GroupMemberActivity,
  GroupMemberState,
  GroupMission,
  GroupReaction,
  GroupReply,
  GroupRoundProgress,
} from "@djl/contracts";
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
  /** Hand-offs used and quiet members of each group's running round. */
  rounds: Record<string, GroupRoundProgress>;
  /** What each busy member is doing now, for the live stage. */
  activities: Record<string, GroupMemberActivity>;
  /** The guests whose visiting agent is connected right now. */
  guestAgents: Record<string, true>;
  /** Reactions by the message or reply they are on. */
  reactions: Record<string, GroupReaction[]>;
  missions: Record<string, GroupMission>;
  applyEvent: (event: GroupEvent) => void;
  reset: () => void;
}

const empty = {
  loaded: false,
  groups: {},
  replies: {},
  memberStates: {},
  drafts: {},
  rounds: {},
  activities: {},
  guestAgents: {},
  reactions: {},
  missions: {},
};

const reactionKey = (reaction: Pick<GroupReaction, "actor" | "kind">) =>
  // A member keeps one status reaction per message; the user one per kind.
  reaction.actor === "user" ? `user:${reaction.kind}` : `member:${reaction.actor}`;

const byTarget = (reactions: readonly GroupReaction[]) => {
  const grouped: Record<string, GroupReaction[]> = {};
  for (const reaction of reactions) (grouped[reaction.targetId] ??= []).push(reaction);
  return grouped;
};

const without = <T>(values: Record<string, T>, key: string) => {
  const { [key]: _removed, ...rest } = values;
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
              ? {
                  memberStates: event.live.memberStates,
                  drafts: event.live.drafts,
                  rounds: event.live.rounds ?? {},
                  activities: event.live.activities ?? {},
                  guestAgents: Object.fromEntries(
                    (event.live.guestAgents ?? []).map((guestId) => [guestId, true as const]),
                  ),
                }
              : {}),
            ...(event.reactions ? { reactions: byTarget(event.reactions) } : {}),
            ...(event.missions
              ? {
                  missions: Object.fromEntries(
                    event.missions.map((mission) => [mission.id, mission]),
                  ),
                }
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
        case "guestAgent.presence":
          return {
            guestAgents: event.online
              ? { ...state.guestAgents, [event.guestId]: true as const }
              : without(state.guestAgents, event.guestId),
          };
        case "round.progress":
          return {
            rounds: event.progress
              ? { ...state.rounds, [event.groupId]: event.progress }
              : without(state.rounds, event.groupId),
          };
        case "member.activity":
          return {
            activities: event.activity
              ? { ...state.activities, [event.memberId]: event.activity }
              : without(state.activities, event.memberId),
          };
        case "reaction.set": {
          const key = reactionKey(event.reaction);
          const others = (state.reactions[event.reaction.targetId] ?? []).filter(
            (reaction) => reactionKey(reaction) !== key,
          );
          return {
            reactions: {
              ...state.reactions,
              [event.reaction.targetId]: [...others, event.reaction],
            },
          };
        }
        case "reaction.removed": {
          const key = reactionKey(event);
          return {
            reactions: {
              ...state.reactions,
              [event.targetId]: (state.reactions[event.targetId] ?? []).filter(
                (reaction) => reactionKey(reaction) !== key,
              ),
            },
          };
        }
        case "mission.upserted":
          return { missions: { ...state.missions, [event.mission.id]: event.mission } };
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
