import type {
  Group,
  GroupHandoff,
  GroupId,
  GroupMember,
  GroupMemberId,
  GroupReply,
  ThreadId,
} from "@synara/contracts";
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
  readonly saveMemberRuntime: (
    memberId: GroupMemberId,
    patch: { readonly nativeSessionId?: string | null; readonly readSeq?: number },
  ) => Op<void>;
  readonly resetMemberSessions: (groupId: GroupId) => Op<void>;
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
  readonly listReplies: (groupId?: GroupId) => Op<ReadonlyArray<GroupReply>>;
}

export class GroupRepository extends ServiceMap.Service<GroupRepository, GroupRepositoryShape>()(
  "djl/persistence/GroupRepository",
) {}
