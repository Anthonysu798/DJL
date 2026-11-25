// FILE: GroupService.ts
// Purpose: Service tag for Multi agents groups: CRUD, members, pauses and live events.
// Layer: Service

import type {
  Group,
  GroupAddMemberInput,
  GroupCreateInput,
  GroupDeleteResult,
  GroupEvent,
  GroupHandoff,
  GroupId,
  GroupLive,
  GroupMemberId,
  GroupMemberRef,
  GroupMission,
  GroupMissionPlanInput,
  GroupMissionRef,
  GroupGuestRef,
  GroupGuestAgentDraftInput,
  GroupGuestAgentJoinInput,
  GroupGuestAgentReplyInput,
  GroupGuestAgentTurnEvent,
  GroupInviteGuestInput,
  LentAgentAskEvent,
  LentAgentAskInput,
  LentAgentRef,
  LentAgentSession,
  GroupMissionRemoveStepInput,
  GroupUpdateGuestInput,
  GroupMissionStartInput,
  GroupReactInput,
  GroupReaction,
  GroupRef,
  GroupReply,
  GroupResolvePauseInput,
  GroupUndoRoundInput,
  GroupUpdateInput,
  GroupUpdateMemberInput,
  ThreadId,
} from "@djl/contracts";
import { Data, ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

export class GroupServiceError extends Data.TaggedError("GroupServiceError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Controls the running group driver registers so the service can reach live members. */
export interface GroupLiveControls {
  readonly stopMember: (memberId: GroupMemberId) => Promise<void>;
  readonly removeMember: (memberId: GroupMemberId) => Promise<void>;
  readonly resetSessions: () => Promise<void>;
  /** Stops one member and closes its CLI, so its next wake starts a fresh session. */
  readonly resetMember: (memberId: GroupMemberId) => Promise<void>;
  /** Adds a message to the running round; false when no round is running. */
  readonly post: (text: string, messageId: string) => Promise<boolean>;
}

type Op<A> = Effect.Effect<A, GroupServiceError>;

export interface GroupServiceShape {
  readonly list: () => Op<ReadonlyArray<Group>>;
  readonly listReplies: () => Op<ReadonlyArray<GroupReply>>;
  /** Busy members and the text each has written so far; kept in memory only. */
  readonly live: () => GroupLive;
  readonly create: (input: GroupCreateInput) => Op<Group>;
  readonly update: (input: GroupUpdateInput) => Op<Group>;
  readonly delete: (ref: GroupRef) => Op<GroupDeleteResult>;
  readonly addMember: (input: GroupAddMemberInput) => Op<Group>;
  readonly updateMember: (input: GroupUpdateMemberInput) => Op<Group>;
  readonly removeMember: (ref: GroupMemberRef) => Op<Group>;
  readonly stopMember: (ref: GroupMemberRef) => Op<void>;
  readonly resolvePause: (input: GroupResolvePauseInput) => Op<void>;
  readonly resetMember: (ref: GroupMemberRef) => Op<Group>;
  readonly undoRound: (input: GroupUndoRoundInput) => Op<void>;
  readonly listReactions: () => Op<ReadonlyArray<GroupReaction>>;
  readonly listMissions: () => Op<ReadonlyArray<GroupMission>>;
  readonly react: (input: GroupReactInput) => Op<void>;
  readonly missionPlan: (input: GroupMissionPlanInput) => Op<GroupMission>;
  readonly missionStart: (input: GroupMissionStartInput) => Op<GroupMission>;
  readonly missionStop: (input: GroupMissionRef) => Op<GroupMission>;
  readonly missionRemoveStep: (input: GroupMissionRemoveStepInput) => Op<GroupMission>;
  /** Adds a person to the group's guest list. Their connection is opened by the desktop app. */
  readonly inviteGuest: (input: GroupInviteGuestInput) => Op<Group>;
  readonly updateGuest: (input: GroupUpdateGuestInput) => Op<Group>;
  readonly removeGuest: (input: GroupGuestRef) => Op<Group>;
  /**
   * A guest's computer brings its agent into the group, and repeats this while it stays
   * connected. The first call adds the visiting member.
   */
  readonly guestAgentJoin: (input: GroupGuestAgentJoinInput) => Op<Group>;
  readonly guestAgentReply: (input: GroupGuestAgentReplyInput) => Op<void>;
  readonly guestAgentDraft: (input: GroupGuestAgentDraftInput) => Op<void>;
  /** The turns a visiting agent is asked to answer, for the guest's gateway to pass on. */
  readonly guestAgentTurns: (ref: GroupGuestRef) => Stream.Stream<GroupGuestAgentTurnEvent>;
  /** The other side: an agent this computer lends to someone else's group. */
  readonly lentAgentOpen: (ref: LentAgentRef) => Op<LentAgentSession>;
  readonly lentAgentClose: (ref: LentAgentRef) => Op<void>;
  readonly lentAgentAsk: (input: LentAgentAskInput) => Stream.Stream<LentAgentAskEvent>;
  /** Stores hand-offs that were not delivered because the round hit its hop limit. */
  readonly savePause: (groupId: GroupId, handoffs: ReadonlyArray<GroupHandoff>) => Op<void>;
  /** Pending hand-offs to deliver if the user chose Continue; always clears the pause. */
  readonly takeResume: (groupId: GroupId) => Op<ReadonlyArray<GroupHandoff>>;
  readonly publish: (event: GroupEvent) => Op<void>;
  readonly registerLive: (threadId: ThreadId, controls: GroupLiveControls) => () => void;
  readonly streamEvents: Stream.Stream<GroupEvent>;
}

export class GroupService extends ServiceMap.Service<GroupService, GroupServiceShape>()(
  "djl/groups/GroupService",
) {}
