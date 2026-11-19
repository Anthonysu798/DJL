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
  GroupMemberId,
  GroupMemberRef,
  GroupRef,
  GroupReply,
  GroupResolvePauseInput,
  GroupUpdateInput,
  GroupUpdateMemberInput,
  ThreadId,
} from "@synara/contracts";
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
}

type Op<A> = Effect.Effect<A, GroupServiceError>;

export interface GroupServiceShape {
  readonly list: () => Op<ReadonlyArray<Group>>;
  readonly listReplies: () => Op<ReadonlyArray<GroupReply>>;
  readonly create: (input: GroupCreateInput) => Op<Group>;
  readonly update: (input: GroupUpdateInput) => Op<Group>;
  readonly delete: (ref: GroupRef) => Op<GroupDeleteResult>;
  readonly addMember: (input: GroupAddMemberInput) => Op<Group>;
  readonly updateMember: (input: GroupUpdateMemberInput) => Op<Group>;
  readonly removeMember: (ref: GroupMemberRef) => Op<Group>;
  readonly stopMember: (ref: GroupMemberRef) => Op<void>;
  readonly resolvePause: (input: GroupResolvePauseInput) => Op<void>;
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
