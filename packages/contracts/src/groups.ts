// FILE: groups.ts
// Purpose: Schemas for Multi agents groups (several native agents in one chat) and their RPC.
// Layer: Contracts

import { Schema } from "effect";

import {
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";

export const GroupId = TrimmedNonEmptyString.pipe(Schema.brand("GroupId"));
export type GroupId = typeof GroupId.Type;
export const GroupMemberId = TrimmedNonEmptyString.pipe(Schema.brand("GroupMemberId"));
export type GroupMemberId = typeof GroupMemberId.Type;

export const GROUP_MEMBER_PROVIDERS = [
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "kimi",
  "iflow",
  "qwen",
  "codebuddy",
  "pi",
  "gemini",
] as const;
export const GroupMemberProvider = Schema.Literals(GROUP_MEMBER_PROVIDERS);
export type GroupMemberProvider = typeof GroupMemberProvider.Type;

export const GROUP_ROLE_PRESETS = [
  "planner",
  "builder",
  "reviewer",
  "researcher",
  "writer",
] as const;
export const GROUP_DEFAULT_HOP_LIMIT = 6;
export const GROUP_CATCH_UP_LIMIT = 40;
export const GROUP_ALL_WARNING_MIN_MEMBERS = 4;
export const GROUP_LARGE_WARNING_MEMBERS = 8;
export const GROUP_MODEL_SELECTION = { provider: "group", model: "group" } as const;

const GroupName = TrimmedNonEmptyString.check(Schema.isMaxLength(80));
const GroupRole = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const HopLimit = PositiveInt.check(Schema.isLessThanOrEqualTo(100));

export const GroupMember = Schema.Struct({
  id: GroupMemberId,
  groupId: GroupId,
  provider: GroupMemberProvider,
  handle: TrimmedNonEmptyString,
  role: Schema.NullOr(GroupRole),
  model: Schema.NullOr(TrimmedNonEmptyString),
  position: NonNegativeInt,
});
export type GroupMember = typeof GroupMember.Type;

export const GroupHandoff = Schema.Struct({
  fromMemberId: GroupMemberId,
  toMemberId: GroupMemberId,
  text: Schema.String,
});
export type GroupHandoff = typeof GroupHandoff.Type;

export const Group = Schema.Struct({
  id: GroupId,
  threadId: ThreadId,
  projectId: ProjectId,
  name: GroupName,
  folder: TrimmedNonEmptyString,
  folderIsAuto: Schema.Boolean,
  hopLimit: HopLimit,
  skipAllWarning: Schema.Boolean,
  pendingHandoffs: Schema.Array(GroupHandoff),
  members: Schema.Array(GroupMember),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type Group = typeof Group.Type;

export const GroupReplyStatus = Schema.Literals(["ok", "empty", "failed"]);
export type GroupReplyStatus = typeof GroupReplyStatus.Type;
export const GroupReply = Schema.Struct({
  groupId: GroupId,
  replyId: TrimmedNonEmptyString,
  memberId: GroupMemberId,
  status: GroupReplyStatus,
  error: Schema.NullOr(Schema.String),
  files: Schema.Array(Schema.String),
  commands: Schema.Array(Schema.String),
});
export type GroupReply = typeof GroupReply.Type;

export const GroupMemberState = Schema.Literals(["idle", "working", "waiting", "failed"]);
export type GroupMemberState = typeof GroupMemberState.Type;

export const GroupEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    groups: Schema.Array(Group),
    replies: Schema.Array(GroupReply),
  }),
  Schema.Struct({ type: Schema.Literal("group.upserted"), group: Group }),
  Schema.Struct({
    type: Schema.Literal("group.deleted"),
    groupId: GroupId,
    folder: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("member.state"),
    groupId: GroupId,
    memberId: GroupMemberId,
    state: GroupMemberState,
  }),
  Schema.Struct({ type: Schema.Literal("reply.recorded"), reply: GroupReply }),
]);
export type GroupEvent = typeof GroupEvent.Type;

const NewGroupMember = Schema.Struct({
  provider: GroupMemberProvider,
  role: Schema.optional(GroupRole),
});

export const GroupCreateInput = Schema.Struct({
  name: GroupName,
  members: Schema.Array(NewGroupMember).check(Schema.isMinLength(1)),
});
export type GroupCreateInput = typeof GroupCreateInput.Type;

export const GroupUpdateInput = Schema.Struct({
  groupId: GroupId,
  name: Schema.optional(GroupName),
  hopLimit: Schema.optional(HopLimit),
  skipAllWarning: Schema.optional(Schema.Boolean),
  folder: Schema.optional(TrimmedNonEmptyString),
});
export type GroupUpdateInput = typeof GroupUpdateInput.Type;

export const GroupAddMemberInput = Schema.Struct({
  groupId: GroupId,
  provider: GroupMemberProvider,
  role: Schema.optional(GroupRole),
});
export type GroupAddMemberInput = typeof GroupAddMemberInput.Type;

export const GroupUpdateMemberInput = Schema.Struct({
  groupId: GroupId,
  memberId: GroupMemberId,
  role: Schema.optional(Schema.NullOr(GroupRole)),
  model: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type GroupUpdateMemberInput = typeof GroupUpdateMemberInput.Type;

export const GroupRef = Schema.Struct({ groupId: GroupId });
export type GroupRef = typeof GroupRef.Type;
export const GroupMemberRef = Schema.Struct({ groupId: GroupId, memberId: GroupMemberId });
export type GroupMemberRef = typeof GroupMemberRef.Type;

export const GroupResolvePauseInput = Schema.Struct({
  groupId: GroupId,
  action: Schema.Literals(["continue", "stop"]),
  continueText: TrimmedNonEmptyString,
});
export type GroupResolvePauseInput = typeof GroupResolvePauseInput.Type;

export const GroupDeleteResult = Schema.Struct({ folder: Schema.String });
export type GroupDeleteResult = typeof GroupDeleteResult.Type;
