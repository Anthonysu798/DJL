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
export const GroupMissionId = TrimmedNonEmptyString.pipe(Schema.brand("GroupMissionId"));
export type GroupMissionId = typeof GroupMissionId.Type;
/** Letters and digits only, so it can sit inside a message id (see `groupGuestMessageId`). */
export const GroupGuestId = Schema.String.check(Schema.isPattern(/^[a-z0-9]{8,32}$/)).pipe(
  Schema.brand("GroupGuestId"),
);
export type GroupGuestId = typeof GroupGuestId.Type;

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
/** A working member with no activity for this long is reported as quiet. */
export const GROUP_QUIET_AFTER_MS = 3 * 60_000;
export const GROUP_BRIEF_MAX_LENGTH = 4000;
/** What a member replies when it has nothing to add; such replies stay out of the chat. */
export const GROUP_PASS_TOKEN = "[PASS]";
export const GROUP_LARGE_WARNING_MEMBERS = 8;
export const GROUP_MODEL_SELECTION = { provider: "group", model: "group" } as const;
/** How many people can be invited into one group. Each one holds a relay connection open. */
export const GROUP_GUEST_LIMIT = 8;
/**
 * A message a guest sent has an id that starts with this, then the guest's id, then "-". Only
 * DJL's own guest gateway on the owner's computer writes such ids; the guest's device cannot.
 */
export const GROUP_GUEST_MESSAGE_PREFIX = "group-guest-";

export const groupGuestMessageId = (guestId: string, unique: string): string =>
  `${GROUP_GUEST_MESSAGE_PREFIX}${guestId}-${unique}`;

/** The guest id inside a guest's message id, or null for anyone else's message. */
export function parseGroupGuestMessageId(messageId: string): string | null {
  if (!messageId.startsWith(GROUP_GUEST_MESSAGE_PREFIX)) return null;
  const rest = messageId.slice(GROUP_GUEST_MESSAGE_PREFIX.length);
  const end = rest.indexOf("-");
  return end > 0 ? rest.slice(0, end) : null;
}

const GroupName = TrimmedNonEmptyString.check(Schema.isMaxLength(80));
const GroupRole = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const HopLimit = PositiveInt.check(Schema.isLessThanOrEqualTo(100));
const GroupBrief = Schema.String.check(Schema.isMaxLength(GROUP_BRIEF_MAX_LENGTH));

/** How full a member's context window was after its last reply. */
export const GroupContextUsage = Schema.Struct({
  usedTokens: NonNegativeInt,
  maxTokens: Schema.NullOr(PositiveInt),
});
export type GroupContextUsage = typeof GroupContextUsage.Type;

/**
 * Who gets a message without any `@`: whoever answered last, everyone (propose-only, like
 * `@all`), or one member acting as the group's lead.
 */
export const GroupDefaultRecipient = Schema.Union([
  Schema.Literals(["last", "all"]),
  GroupMemberId,
]);
export type GroupDefaultRecipient = typeof GroupDefaultRecipient.Type;

export const GroupMember = Schema.Struct({
  id: GroupMemberId,
  groupId: GroupId,
  provider: GroupMemberProvider,
  handle: TrimmedNonEmptyString,
  role: Schema.NullOr(GroupRole),
  model: Schema.NullOr(TrimmedNonEmptyString),
  position: NonNegativeInt,
  /** Wakes only when the user names it; skipped by @all, hand-offs and automatic review. */
  muted: Schema.Boolean,
  contextUsage: Schema.NullOr(GroupContextUsage),
  /**
   * Set for a visiting agent: this guest's own computer answers for the member, with the guest's
   * subscription. It reads the conversation and writes text; it never touches the group's folder.
   */
  guestId: Schema.optional(GroupGuestId),
});
export type GroupMember = typeof GroupMember.Type;

export const GroupHandoff = Schema.Struct({
  fromMemberId: GroupMemberId,
  toMemberId: GroupMemberId,
  text: Schema.String,
  /** The hand-off came from an @all round, so it stays read-only when continued. */
  proposeOnly: Schema.optional(Schema.Boolean),
  /** The hand-off is an automatic review of these changed files. */
  reviewFiles: Schema.optional(Schema.Array(Schema.String)),
  /** The hand-off belongs to this step of a mission. */
  mission: Schema.optional(Schema.Struct({ missionId: GroupMissionId, step: NonNegativeInt })),
  /** The reply that handed off, which the woken member reacts to. */
  targetId: Schema.optional(Schema.String),
});
export type GroupHandoff = typeof GroupHandoff.Type;

/**
 * What an invited person may do. "viewer" reads the chat. "chat" also writes, and the agents
 * answer a guest with proposals only: they change no files until the owner approves. "agent"
 * lends one of the guest's own agents to the group; it joins from the guest's DJL desktop app.
 */
export const GROUP_GUEST_ROLES = ["viewer", "chat", "agent"] as const;
/**
 * The agents a user can lend to someone else's group. A lent agent is driven by another person's
 * chat, so it must run with no tools at all: only agents whose CLI can switch every tool off are
 * listed. Codex runs read-only shell commands without asking, so it is not.
 */
export const GROUP_LENDABLE_PROVIDERS = [
  "claudeAgent",
] as const satisfies readonly (typeof GROUP_MEMBER_PROVIDERS)[number][];
export const isGroupLendableProvider = (provider: string): boolean =>
  (GROUP_LENDABLE_PROVIDERS as readonly string[]).includes(provider);
/** A visiting agent that has not been heard from for this long counts as offline. */
export const GROUP_GUEST_AGENT_STALE_MS = 75_000;
/** How often a visiting agent's computer says it is still there. */
export const GROUP_GUEST_AGENT_HEARTBEAT_MS = 30_000;
export const GroupGuestRole = Schema.Literals(GROUP_GUEST_ROLES);
export type GroupGuestRole = typeof GroupGuestRole.Type;
const GroupGuestName = TrimmedNonEmptyString.check(Schema.isMaxLength(40));

/** A person the owner invited into one group. They connect through the relay, not an account. */
export const GroupGuest = Schema.Struct({
  id: GroupGuestId,
  name: GroupGuestName,
  role: GroupGuestRole,
  createdAt: Schema.Number,
});
export type GroupGuest = typeof GroupGuest.Type;

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
  /** Shared instructions every member reads. */
  brief: GroupBrief,
  /**
   * Bumped whenever what members are told about the group changes (brief, lead, reviewer, mutes,
   * roles, members), so members that were briefed on an older setup are briefed again.
   */
  setupRev: NonNegativeInt,
  defaultRecipient: GroupDefaultRecipient,
  /** The member that checks other members' file changes automatically; null when off. */
  reviewerMemberId: Schema.NullOr(GroupMemberId),
  members: Schema.Array(GroupMember),
  /** People invited into this group. */
  guests: Schema.optional(Schema.Array(GroupGuest)),
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
  /** The reply answered a round that went to everyone, so it is a proposal. */
  proposeOnly: Schema.optional(Schema.Boolean),
  /** The member replied that it had nothing to add. */
  passed: Schema.optional(Schema.Boolean),
});
export type GroupReply = typeof GroupReply.Type;

/** What the user can tap under an answer. */
export const GROUP_USER_REACTIONS = ["like", "dislike", "doIt", "simpler"] as const;
export const GroupUserReaction = Schema.Literals(GROUP_USER_REACTIONS);
export type GroupUserReaction = typeof GroupUserReaction.Type;
/** What a member shows on a message it picked up: seen while working, then how it ended. */
export const GROUP_MEMBER_REACTIONS = ["seen", "done", "passed", "failed"] as const;
export const GroupMemberReaction = Schema.Literals(GROUP_MEMBER_REACTIONS);
export type GroupMemberReaction = typeof GroupMemberReaction.Type;

export const GroupReaction = Schema.Struct({
  groupId: GroupId,
  /** A user message id, or a member reply id. */
  targetId: TrimmedNonEmptyString,
  /** "user", or the id of the member that reacted. */
  actor: TrimmedNonEmptyString,
  kind: Schema.Union([GroupUserReaction, GroupMemberReaction]),
  createdAt: Schema.Number,
});
export type GroupReaction = typeof GroupReaction.Type;

/** What a busy member is doing right now, for the live stage. */
export const GROUP_ACTIVITY_KINDS = [
  "thinking",
  "planning",
  "reviewing",
  "reading",
  "editing",
  "running",
  "writing",
  "waiting",
] as const;
export const GroupActivityKind = Schema.Literals(GROUP_ACTIVITY_KINDS);
export type GroupActivityKind = typeof GroupActivityKind.Type;
export const GroupMemberActivity = Schema.Struct({
  kind: GroupActivityKind,
  /** The file or command, when there is one. */
  detail: Schema.NullOr(Schema.String),
  /** The member whose hand-off started this work. */
  from: Schema.NullOr(GroupMemberId),
});
export type GroupMemberActivity = typeof GroupMemberActivity.Type;

export const GROUP_MISSION_MAX_STEPS = 7;
export const GroupMissionStatus = Schema.Literals([
  "planning",
  "ready",
  "running",
  "paused",
  "done",
  "stopped",
  "failed",
]);
export type GroupMissionStatus = typeof GroupMissionStatus.Type;
export const GroupMissionStepStatus = Schema.Literals([
  "pending",
  "running",
  "done",
  "failed",
  "skipped",
]);
export type GroupMissionStepStatus = typeof GroupMissionStepStatus.Type;
export const GroupMissionStep = Schema.Struct({
  text: Schema.String,
  memberId: GroupMemberId,
  status: GroupMissionStepStatus,
});
export type GroupMissionStep = typeof GroupMissionStep.Type;
export const GroupMissionStats = Schema.Struct({
  files: Schema.Array(Schema.String),
  commands: NonNegativeInt,
  reviews: NonNegativeInt,
  replies: NonNegativeInt,
});
export type GroupMissionStats = typeof GroupMissionStats.Type;
export const GroupMission = Schema.Struct({
  id: GroupMissionId,
  groupId: GroupId,
  goal: Schema.String,
  status: GroupMissionStatus,
  plannerMemberId: Schema.NullOr(GroupMemberId),
  /** The planner's reply that holds the plan. */
  planReplyId: Schema.NullOr(Schema.String),
  steps: Schema.Array(GroupMissionStep),
  currentStep: NonNegativeInt,
  stats: GroupMissionStats,
  createdAt: Schema.Number,
  startedAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number),
});
export type GroupMission = typeof GroupMission.Type;

export const GroupMemberState = Schema.Literals(["idle", "working", "waiting", "failed"]);
export type GroupMemberState = typeof GroupMemberState.Type;

/** A running round: hand-offs used so far and members working with no recent activity. */
export const GroupRoundProgress = Schema.Struct({
  hops: NonNegativeInt,
  hopLimit: HopLimit,
  quiet: Schema.Array(GroupMemberId),
});
export type GroupRoundProgress = typeof GroupRoundProgress.Type;

/** What is happening right now: busy members and the text each has written so far. */
export const GroupLive = Schema.Struct({
  memberStates: Schema.Record(GroupMemberId, GroupMemberState),
  drafts: Schema.Record(GroupMemberId, Schema.String),
  rounds: Schema.optional(Schema.Record(GroupId, GroupRoundProgress)),
  activities: Schema.optional(Schema.Record(GroupMemberId, GroupMemberActivity)),
  /** The guests whose visiting agent is connected right now. */
  guestAgents: Schema.optional(Schema.Array(GroupGuestId)),
});
export type GroupLive = typeof GroupLive.Type;

export const GroupEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("snapshot"),
    groups: Schema.Array(Group),
    replies: Schema.Array(GroupReply),
    live: Schema.optional(GroupLive),
    reactions: Schema.optional(Schema.Array(GroupReaction)),
    missions: Schema.optional(Schema.Array(GroupMission)),
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
  Schema.Struct({
    type: Schema.Literal("reply.draft"),
    groupId: GroupId,
    memberId: GroupMemberId,
    delta: Schema.String,
    /** The member began a new message: replace the draft with `delta` instead of appending. */
    restart: Schema.Boolean,
  }),
  Schema.Struct({ type: Schema.Literal("reaction.set"), reaction: GroupReaction }),
  Schema.Struct({
    type: Schema.Literal("reaction.removed"),
    groupId: GroupId,
    targetId: Schema.String,
    actor: Schema.String,
    kind: Schema.Union([GroupUserReaction, GroupMemberReaction]),
  }),
  Schema.Struct({
    type: Schema.Literal("member.activity"),
    groupId: GroupId,
    memberId: GroupMemberId,
    /** Null when the member is no longer working. */
    activity: Schema.NullOr(GroupMemberActivity),
  }),
  Schema.Struct({ type: Schema.Literal("mission.upserted"), mission: GroupMission }),
  /** A guest's visiting agent connected, or was not heard from any more. */
  Schema.Struct({
    type: Schema.Literal("guestAgent.presence"),
    groupId: GroupId,
    guestId: GroupGuestId,
    online: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("round.progress"),
    groupId: GroupId,
    /** Null when the round has ended. */
    progress: Schema.NullOr(GroupRoundProgress),
  }),
]);
export type GroupEvent = typeof GroupEvent.Type;

const NewGroupMember = Schema.Struct({
  provider: GroupMemberProvider,
  role: Schema.optional(GroupRole),
  /** Messages without `@` go to this member. */
  lead: Schema.optional(Schema.Boolean),
  /** This member checks the others' file changes automatically. */
  reviewer: Schema.optional(Schema.Boolean),
});

export const GroupCreateInput = Schema.Struct({
  name: GroupName,
  members: Schema.Array(NewGroupMember).check(Schema.isMinLength(1)),
  brief: Schema.optional(GroupBrief),
  /** Overrides "last"; a member marked `lead` wins over this. */
  defaultRecipient: Schema.optional(Schema.Literals(["last", "all"])),
});
export type GroupCreateInput = typeof GroupCreateInput.Type;

export const GroupUpdateInput = Schema.Struct({
  groupId: GroupId,
  name: Schema.optional(GroupName),
  hopLimit: Schema.optional(HopLimit),
  skipAllWarning: Schema.optional(Schema.Boolean),
  folder: Schema.optional(TrimmedNonEmptyString),
  brief: Schema.optional(GroupBrief),
  defaultRecipient: Schema.optional(GroupDefaultRecipient),
  reviewerMemberId: Schema.optional(Schema.NullOr(GroupMemberId)),
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
  muted: Schema.optional(Schema.Boolean),
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

/** Reverts the file changes of the group's latest round that changed files, and tells members. */
export const GroupUndoRoundInput = Schema.Struct({
  groupId: GroupId,
  /** The checkpoint turn count of that round (DJL checkpoints one turn per round). */
  turnCount: PositiveInt,
});
export type GroupUndoRoundInput = typeof GroupUndoRoundInput.Type;

export const GroupReactInput = Schema.Struct({
  groupId: GroupId,
  replyId: TrimmedNonEmptyString,
  kind: GroupUserReaction,
  /** For reactions that wake the member: the message to post, starting with its @handle. */
  message: Schema.optional(TrimmedNonEmptyString),
});
export type GroupReactInput = typeof GroupReactInput.Type;

export const GroupMissionPlanInput = Schema.Struct({
  groupId: GroupId,
  goal: TrimmedNonEmptyString.check(Schema.isMaxLength(2000)),
  /** The request posted to the planner after its @handle, in the user's language. */
  message: TrimmedNonEmptyString,
});
export type GroupMissionPlanInput = typeof GroupMissionPlanInput.Type;
export const GroupMissionStartInput = Schema.Struct({
  groupId: GroupId,
  missionId: GroupMissionId,
  /** Skip the step the mission stopped at instead of trying it again. */
  skipCurrent: Schema.optional(Schema.Boolean),
  /** Logged as the user's message, in the user's language. */
  message: TrimmedNonEmptyString,
});
export type GroupMissionStartInput = typeof GroupMissionStartInput.Type;
export const GroupMissionRef = Schema.Struct({ groupId: GroupId, missionId: GroupMissionId });
export type GroupMissionRef = typeof GroupMissionRef.Type;
export const GroupMissionRemoveStepInput = Schema.Struct({
  groupId: GroupId,
  missionId: GroupMissionId,
  index: NonNegativeInt,
});
export type GroupMissionRemoveStepInput = typeof GroupMissionRemoveStepInput.Type;

export const GroupInviteGuestInput = Schema.Struct({
  groupId: GroupId,
  name: GroupGuestName,
  role: GroupGuestRole,
});
export type GroupInviteGuestInput = typeof GroupInviteGuestInput.Type;
export const GroupGuestRef = Schema.Struct({ groupId: GroupId, guestId: GroupGuestId });
export type GroupGuestRef = typeof GroupGuestRef.Type;
export const GroupUpdateGuestInput = Schema.Struct({
  groupId: GroupId,
  guestId: GroupGuestId,
  role: GroupGuestRole,
});
export type GroupUpdateGuestInput = typeof GroupUpdateGuestInput.Type;

/** A visiting agent's computer announces itself, and repeats this while it stays connected. */
export const GroupGuestAgentJoinInput = Schema.Struct({
  groupId: GroupId,
  guestId: GroupGuestId,
  provider: GroupMemberProvider,
  /** Shown to the group's owner; it comes from the guest's computer, so it is kept short. */
  model: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(120))),
  /** Changes whenever the agent starts over with an empty memory, so the group briefs it again. */
  sessionId: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
});
export type GroupGuestAgentJoinInput = typeof GroupGuestAgentJoinInput.Type;

const GuestAgentTurnId = TrimmedNonEmptyString.check(Schema.isMaxLength(80));
export const GROUP_GUEST_AGENT_TEXT_LIMIT = 200_000;
/** The relay carries at most 1 MiB per message; a longer prompt could never arrive. */
export const GROUP_GUEST_AGENT_PROMPT_LIMIT = 600_000;
const GuestAgentText = Schema.String.check(Schema.isMaxLength(GROUP_GUEST_AGENT_TEXT_LIMIT));

/** What the owner's computer sends to a visiting agent's computer. */
export const GroupGuestAgentTurnEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("turn"), turnId: GuestAgentTurnId, prompt: Schema.String }),
  Schema.Struct({ type: Schema.Literal("cancel"), turnId: GuestAgentTurnId }),
  /** The owner removed the invite: the agent is no longer welcome and should stop retrying. */
  Schema.Struct({ type: Schema.Literal("removed") }),
]);
export type GroupGuestAgentTurnEvent = typeof GroupGuestAgentTurnEvent.Type;

export const GroupGuestAgentReplyInput = Schema.Struct({
  groupId: GroupId,
  guestId: GroupGuestId,
  turnId: GuestAgentTurnId,
  status: Schema.Literals(["ok", "failed"]),
  /** The answer, or what went wrong. */
  text: GuestAgentText,
});
export type GroupGuestAgentReplyInput = typeof GroupGuestAgentReplyInput.Type;

export const GroupGuestAgentDraftInput = Schema.Struct({
  groupId: GroupId,
  guestId: GroupGuestId,
  turnId: GuestAgentTurnId,
  delta: GuestAgentText,
  restart: Schema.Boolean,
});
export type GroupGuestAgentDraftInput = typeof GroupGuestAgentDraftInput.Type;

/** One agent this computer lends to someone else's group. The id is made by the desktop app. */
export const LentAgentLinkId = Schema.String.check(Schema.isPattern(/^[a-z0-9]{8,32}$/));
export const LentAgentRef = Schema.Struct({ linkId: LentAgentLinkId });
export type LentAgentRef = typeof LentAgentRef.Type;
export const LentAgentSession = Schema.Struct({ sessionId: TrimmedNonEmptyString });
export type LentAgentSession = typeof LentAgentSession.Type;
export const LentAgentAskInput = Schema.Struct({
  linkId: LentAgentLinkId,
  sessionId: TrimmedNonEmptyString,
  provider: GroupMemberProvider,
  model: Schema.NullOr(TrimmedNonEmptyString),
  /** The other person's group message, as their computer wrote it. Never trusted. */
  prompt: Schema.String.check(Schema.isMaxLength(2_000_000)),
});
export type LentAgentAskInput = typeof LentAgentAskInput.Type;
export const LentAgentAskEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("draft"), delta: Schema.String, restart: Schema.Boolean }),
  Schema.Struct({
    type: Schema.Literal("done"),
    status: Schema.Literals(["ok", "failed"]),
    text: Schema.String,
  }),
]);
export type LentAgentAskEvent = typeof LentAgentAskEvent.Type;

export const GroupDeleteResult = Schema.Struct({ folder: Schema.String });
export const GroupListResult = Schema.Struct({
  groups: Schema.Array(Group),
  replies: Schema.Array(GroupReply),
  live: Schema.optional(GroupLive),
  reactions: Schema.optional(Schema.Array(GroupReaction)),
  missions: Schema.optional(Schema.Array(GroupMission)),
});
export type GroupListResult = typeof GroupListResult.Type;
export type GroupDeleteResult = typeof GroupDeleteResult.Type;
