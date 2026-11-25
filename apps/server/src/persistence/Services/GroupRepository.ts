import type {
  Group,
  GroupContextUsage,
  GroupGuest,
  GroupMission,
  GroupMissionId,
  GroupReaction,
  GroupHandoff,
  GroupId,
  GroupMember,
  GroupMemberId,
  GroupReply,
  ThreadId,
} from "@djl/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { PersistenceDecodeError, PersistenceSqlError } from "../Errors.ts";

export type GroupRepositoryError = PersistenceSqlError | PersistenceDecodeError;
type Op<A> = Effect.Effect<A, GroupRepositoryError>;

export type GroupRow = Omit<Group, "members">;
export interface GroupLogEntry {
  readonly seq: number;
  readonly author: string;
  readonly text: string;
}
export interface GroupMemberRuntime {
  readonly nativeSessionId: string | null;
  readonly readSeq: number;
  /** The group brief revision this member last received. */
  readonly setupRevSeen: number;
}
export interface GroupMemberRuntimePatch {
  readonly nativeSessionId?: string | null;
  readonly readSeq?: number;
  readonly setupRevSeen?: number;
  readonly contextUsage?: GroupContextUsage | null;
}
export interface GroupRoundState {
  readonly lastSpeakers: readonly GroupMemberId[];
  readonly lastRoundAll: boolean;
}

export interface GroupRepositoryShape {
  readonly listGroups: () => Op<ReadonlyArray<Group>>;
  readonly getById: (groupId: GroupId) => Op<Group | null>;
  readonly getByThreadId: (threadId: ThreadId) => Op<Group | null>;
  readonly upsertGroup: (row: GroupRow) => Op<void>;
  readonly deleteGroup: (groupId: GroupId) => Op<void>;
  readonly upsertMember: (member: GroupMember) => Op<void>;
  readonly deleteMember: (memberId: GroupMemberId) => Op<void>;
  readonly getMemberRuntime: (memberId: GroupMemberId) => Op<GroupMemberRuntime>;
  readonly saveMemberRuntime: (memberId: GroupMemberId, patch: GroupMemberRuntimePatch) => Op<void>;
  /** Forgets every member's CLI session (and context usage) in the group. */
  readonly resetMemberSessions: (groupId: GroupId) => Op<void>;
  /** Forgets one member's CLI session and context usage, so its next wake starts fresh. */
  readonly resetMemberSession: (memberId: GroupMemberId) => Op<void>;
  readonly appendLog: (
    groupId: GroupId,
    author: "user" | GroupMemberId,
    text: string,
  ) => Op<number>;
  readonly logAfter: (groupId: GroupId, seq: number) => Op<ReadonlyArray<GroupLogEntry>>;
  readonly logTail: (groupId: GroupId, count: number) => Op<ReadonlyArray<GroupLogEntry>>;
  readonly setRoundState: (groupId: GroupId, state: GroupRoundState) => Op<void>;
  readonly getRoundState: (groupId: GroupId) => Op<GroupRoundState>;
  readonly setPause: (
    groupId: GroupId,
    handoffs: ReadonlyArray<GroupHandoff>,
    resumeRequested: boolean,
  ) => Op<void>;
  readonly isResumeRequested: (groupId: GroupId) => Op<boolean>;
  readonly recordReply: (reply: GroupReply) => Op<void>;
  /** `slot` is "status" for a member's reaction and the kind for the user's. */
  readonly setReaction: (reaction: GroupReaction, slot: string) => Op<void>;
  readonly removeReaction: (
    groupId: GroupId,
    targetId: string,
    actor: string,
    slot: string,
  ) => Op<void>;
  readonly getReaction: (
    groupId: GroupId,
    targetId: string,
    actor: string,
    slot: string,
  ) => Op<GroupReaction | null>;
  readonly listReactions: (groupId?: GroupId) => Op<ReadonlyArray<GroupReaction>>;
  readonly upsertMission: (mission: GroupMission) => Op<void>;
  readonly setGuests: (groupId: GroupId, guests: ReadonlyArray<GroupGuest>) => Op<void>;
  readonly getMission: (missionId: GroupMissionId) => Op<GroupMission | null>;
  readonly listMissions: (groupId?: GroupId) => Op<ReadonlyArray<GroupMission>>;
  readonly listReplies: (groupId?: GroupId) => Op<ReadonlyArray<GroupReply>>;
}

export class GroupRepository extends ServiceMap.Service<GroupRepository, GroupRepositoryShape>()(
  "djl/persistence/GroupRepository",
) {}
